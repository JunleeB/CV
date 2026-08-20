"""
YOLO + SAM2 single-GPU inference. All inference runs sequentially on one GPU;
multiple users queue behind _model_lock. Simple and conflict-free.

Device layout:
  cuda:0  — YOLO + SAM2 inference (INFERENCE_DEVICE env var)
  cuda:1  — Grounding DINO       (GDINO_CUDA_DEVICE env var, falls back to cuda:0)
"""
import logging
import os
import threading
import cv2
import numpy as np
import torch
from collections import OrderedDict
from pathlib import Path

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "1,2,4,7")

_DEVICE: str = os.getenv("INFERENCE_DEVICE", "cuda:0")
_GDINO_DEVICE: str = os.getenv("GDINO_CUDA_DEVICE", "cuda:1")

_default_weights: str = ""
_CACHE_MAX = 20

# ── Global models ─────────────────────────────────────────────────────────────

_yolo_cache: dict = {}       # weights_path → YOLO instance
_sam_predictor = None        # SAM2ImagePredictor
_video_predictor = None      # SAM2VideoPredictor (lazy)
_embedding_cache: OrderedDict = OrderedDict()

# Serializes all YOLO + SAM2 operations so GPU state is never shared
_model_lock = threading.Lock()
_video_init_lock = threading.Lock()


# ── Model loading ─────────────────────────────────────────────────────────────

def load_models(
    yolo_weights: str = "runs/yolo11m_ev/weights/best.pt",
    sam2_ckpt: str = "checkpoints/sam2.1_hiera_large.pt",
    sam2_cfg: str = "configs/sam2.1/sam2.1_hiera_l.yaml",
    device: str = "cuda",
):
    global _sam_predictor, _default_weights
    base = Path(__file__).parent.parent
    from ultralytics import YOLO
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    abs_weights = str(base / yolo_weights)
    _default_weights = abs_weights

    # Warmup: pass torch.device so Ultralytics doesn't overwrite CUDA_VISIBLE_DEVICES
    yolo_model = YOLO(abs_weights)
    yolo_model.predict(
        np.zeros((320, 320, 3), dtype=np.uint8),
        device=torch.device(_DEVICE), verbose=False, imgsz=320,
    )
    _yolo_cache[abs_weights] = yolo_model

    sam2 = build_sam2(sam2_cfg, str(base / sam2_ckpt), device=_DEVICE)
    _sam_predictor = SAM2ImagePredictor(sam2)

    print(f"모델 로딩 완료: YOLO+SAM2 on {_DEVICE}")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cache_key(img_path: str) -> tuple:
    try:
        return (img_path, os.path.getmtime(img_path))
    except OSError:
        return (img_path, 0)


def _get_yolo(weights_path: str | None = None):
    """Return (and warm-up if needed) the YOLO model for the given weights."""
    path = weights_path or _default_weights
    if path not in _yolo_cache:
        from ultralytics import YOLO
        model = YOLO(path)
        model.predict(
            np.zeros((320, 320, 3), dtype=np.uint8),
            device=torch.device(_DEVICE), verbose=False, imgsz=320,
        )
        _yolo_cache[path] = model
    return _yolo_cache[path]


def _get_video_predictor():
    """Lazy-load SAM2 video predictor (first call only)."""
    global _video_predictor
    if _video_predictor is not None:
        return _video_predictor
    with _video_init_lock:
        if _video_predictor is not None:
            return _video_predictor
        base = Path(__file__).parent.parent
        from sam2.build_sam import build_sam2_video_predictor
        _video_predictor = build_sam2_video_predictor(
            "configs/sam2.1/sam2.1_hiera_l.yaml",
            str(base / "checkpoints/sam2.1_hiera_large.pt"),
            device=_DEVICE,
        )
    return _video_predictor


def _set_image_with_cache(img_path: str, img_rgb: np.ndarray) -> bool:
    """Set SAM2 image with LRU embedding cache. Must be called under _model_lock."""
    key = _cache_key(img_path)
    if key in _embedding_cache:
        features, orig_hw = _embedding_cache[key]
        _sam_predictor._features = features
        _sam_predictor._orig_hw = orig_hw
        _sam_predictor._is_image_set = True
        _embedding_cache.move_to_end(key)
        return True
    _sam_predictor.set_image(img_rgb)
    if len(_embedding_cache) >= _CACHE_MAX:
        _embedding_cache.popitem(last=False)
    _embedding_cache[key] = (_sam_predictor._features, _sam_predictor._orig_hw)
    return False


def clear_embedding_cache():
    with _model_lock:
        _embedding_cache.clear()


# ── ROI / geometry helpers ────────────────────────────────────────────────────

def _roi_crop_box(roi: list, img_w: int, img_h: int) -> tuple[int, int, int, int]:
    xs = [roi[i] * img_w for i in range(0, len(roi), 2)]
    ys = [roi[i] * img_h for i in range(1, len(roi), 2)]
    x1 = max(0, int(min(xs)))
    y1 = max(0, int(min(ys)))
    x2 = min(img_w, int(max(xs)) + 1)
    y2 = min(img_h, int(max(ys)) + 1)
    return x1, y1, x2, y2


def _in_roi(bbox_px, img_w: int, img_h: int, roi: list | None, overlap_threshold: float = 0.3) -> bool:
    if roi is None or len(roi) < 6:
        return True
    pts = np.array([[roi[i] * img_w, roi[i + 1] * img_h]
                    for i in range(0, len(roi), 2)], dtype=np.int32)
    roi_mask = np.zeros((img_h, img_w), dtype=np.uint8)
    cv2.fillPoly(roi_mask, [pts], 1)
    x1, y1, x2, y2 = (int(v) for v in bbox_px)
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(img_w, x2), min(img_h, y2)
    if x2 <= x1 or y2 <= y1:
        return False
    bbox_area = (x2 - x1) * (y2 - y1)
    overlap = int(roi_mask[y1:y2, x1:x2].sum())
    return (overlap / bbox_area) >= overlap_threshold


def _iou(a, b) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter == 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter)


def _suppress_cross_class(boxes: list, iou_threshold: float = 0.5) -> list:
    if len(boxes) <= 1:
        return boxes
    boxes = sorted(boxes, key=lambda b: b[1], reverse=True)
    suppressed = set()
    for i in range(len(boxes)):
        if i in suppressed:
            continue
        for j in range(i + 1, len(boxes)):
            if j in suppressed:
                continue
            if boxes[i][0] == boxes[j][0]:
                continue
            if _iou(boxes[i][2], boxes[j][2]) > iou_threshold:
                suppressed.add(j)
    return [b for idx, b in enumerate(boxes) if idx not in suppressed]


def _nms_all(boxes: list, iou_threshold: float = 0.5) -> list:
    """같은 클래스 포함 전체 NMS — multi-scale 결과 합산 시 사용."""
    if len(boxes) <= 1:
        return boxes
    boxes = sorted(boxes, key=lambda b: b[1], reverse=True)
    suppressed = set()
    for i in range(len(boxes)):
        if i in suppressed:
            continue
        for j in range(i + 1, len(boxes)):
            if j in suppressed:
                continue
            if _iou(boxes[i][2], boxes[j][2]) > iou_threshold:
                suppressed.add(j)
    return [b for idx, b in enumerate(boxes) if idx not in suppressed]


def mask_to_polygon(mask: np.ndarray, img_w: int, img_h: int):
    contours, _ = cv2.findContours(
        mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return None
    largest = max(contours, key=cv2.contourArea)
    epsilon = 0.002 * cv2.arcLength(largest, True)
    approx = cv2.approxPolyDP(largest, epsilon, True)
    if len(approx) < 3:
        return None
    pts = approx.reshape(-1, 2)
    return [v for x, y in pts for v in (float(x) / img_w, float(y) / img_h)]


# ── Public inference functions ────────────────────────────────────────────────

def run_inference(img_path: str, conf_threshold: float = 0.7, yolo_conf_min: float = 0.15,
                  roi: list | None = None, weights_path: str | None = None,
                  multi_scale: bool = False):
    """YOLO + SAM2 segmentation (serialized via _model_lock).

    multi_scale=True: 640/1280/1920 세 해상도로 탐지 후 NMS 합산.
    얇은 크랙처럼 스케일에 민감한 객체의 recall을 높임.
    """
    with _model_lock:
        yolo = _get_yolo(weights_path)
        img_bgr = cv2.imread(str(img_path))
        if img_bgr is None:
            return [], []
        img_h, img_w = img_bgr.shape[:2]
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        # conf_threshold 절반 이하로 yolo_conf_min 동적 조정 (최소 0.05)
        effective_min_conf = min(yolo_conf_min, max(0.05, conf_threshold * 0.5))

        scales = [640, 1280, 1920] if multi_scale else [None]
        raw_boxes = []
        for scale in scales:
            kw = dict(conf=effective_min_conf, verbose=False)
            if scale:
                kw["imgsz"] = scale
            for result in yolo(img_bgr, **kw):
                if result.boxes is None or len(result.boxes) == 0:
                    continue
                for b in result.boxes:
                    bbox = b.xyxy[0].cpu().numpy()
                    if _in_roi(bbox, img_w, img_h, roi):
                        raw_boxes.append((int(b.cls), float(b.conf), bbox))

        # multi-scale 중복 제거: 같은 클래스 포함 전체 NMS
        if multi_scale:
            raw_boxes = _nms_all(raw_boxes, iou_threshold=0.5)
        else:
            raw_boxes = _suppress_cross_class(raw_boxes, iou_threshold=0.7)

        auto_labels, review_items = [], []
        sam_set = False
        for cls_id, conf, bbox in raw_boxes:
            if conf >= conf_threshold:
                if not sam_set:
                    _set_image_with_cache(img_path, img_rgb)
                    sam_set = True
                masks, _, _ = _sam_predictor.predict(box=bbox[None], multimask_output=False)
                poly = mask_to_polygon(masks[0], img_w, img_h)
                if poly:
                    auto_labels.append({"class_id": cls_id, "polygon": poly, "confidence": conf})
            else:
                review_items.append({
                    "class_id": cls_id,
                    "confidence": conf,
                    "bbox": bbox.tolist(),
                })

        return auto_labels, review_items


def run_inference_yolo_seg(img_path: str, conf_threshold: float = 0.7, yolo_conf_min: float = 0.15,
                           roi: list | None = None, weights_path: str | None = None):
    """YOLO-seg 자체 폴리곤 출력 (SAM2 없음). 크랙 등 얇은 객체에 적합."""
    with _model_lock:
        yolo = _get_yolo(weights_path)
        img_bgr = cv2.imread(str(img_path))
        if img_bgr is None:
            return [], []
        img_h, img_w = img_bgr.shape[:2]

        results = yolo(img_bgr, conf=yolo_conf_min, verbose=False)
        auto_labels, review_items = [], []

        for result in results:
            if result.boxes is None or len(result.boxes) == 0:
                continue
            masks = result.masks
            for i, box in enumerate(result.boxes):
                if not _in_roi(box.xyxy[0].cpu().numpy(), img_w, img_h, roi):
                    continue
                cls_id = int(box.cls)
                conf = float(box.conf)

                if masks is not None and i < len(masks):
                    mask_np = masks[i].data[0].cpu().numpy().astype("uint8")
                    # 마스크가 원본 이미지 크기로 리사이즈 필요한 경우
                    if mask_np.shape != (img_h, img_w):
                        mask_np = cv2.resize(mask_np, (img_w, img_h), interpolation=cv2.INTER_NEAREST)
                    poly = mask_to_polygon(mask_np, img_w, img_h)
                else:
                    # mask 없으면 bbox로 fallback
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    poly = [
                        float(x1 / img_w), float(y1 / img_h),
                        float(x2 / img_w), float(y1 / img_h),
                        float(x2 / img_w), float(y2 / img_h),
                        float(x1 / img_w), float(y2 / img_h),
                    ]

                if not poly:
                    continue

                if conf >= conf_threshold:
                    auto_labels.append({"class_id": cls_id, "polygon": poly, "confidence": conf})
                else:
                    review_items.append({"class_id": cls_id, "confidence": conf,
                                         "bbox": box.xyxy[0].tolist()})

        return auto_labels, review_items


def run_inference_detect(img_path: str, conf_threshold: float = 0.7, yolo_conf_min: float = 0.15,
                         roi: list | None = None, weights_path: str | None = None):
    """YOLO detection only, no SAM2 (serialized via _model_lock)."""
    with _model_lock:
        yolo = _get_yolo(weights_path)
        img_bgr = cv2.imread(str(img_path))
        if img_bgr is None:
            return [], []
        img_h, img_w = img_bgr.shape[:2]

        results = yolo(img_bgr, conf=yolo_conf_min, verbose=False)
        auto_labels, review_items = [], []

        for result in results:
            if result.boxes is None or len(result.boxes) == 0:
                continue
            boxes = [
                (int(b.cls), float(b.conf), b.xyxy[0].cpu().numpy())
                for b in result.boxes
                if _in_roi(b.xyxy[0].cpu().numpy(), img_w, img_h, roi)
            ]
            boxes = _suppress_cross_class(boxes, iou_threshold=0.7)

            for cls_id, conf, bbox in boxes:
                x1, y1, x2, y2 = bbox
                poly = [
                    float(x1 / img_w), float(y1 / img_h),
                    float(x2 / img_w), float(y1 / img_h),
                    float(x2 / img_w), float(y2 / img_h),
                    float(x1 / img_w), float(y2 / img_h),
                ]
                if conf >= conf_threshold:
                    auto_labels.append({"class_id": cls_id, "polygon": poly, "confidence": float(conf)})
                else:
                    review_items.append({
                        "class_id": cls_id,
                        "confidence": float(conf),
                        "bbox": [float(v) for v in bbox.tolist()],
                    })

        return auto_labels, review_items


def run_sam2_video_track(
    image_paths: list[str],
    seed_bboxes_norm: list[list[float]],
    seed_class_ids: list[int],
    bbox_only: bool = False,
    progress_cb=None,
) -> list[dict]:
    """SAM2 video propagation (serialized via _model_lock)."""
    import tempfile
    from PIL import Image as PILImage

    if not image_paths or not seed_bboxes_norm:
        return []

    with PILImage.open(image_paths[0]) as _img:
        iw, ih = _img.size

    seed_bboxes_px = [
        np.array([x1 * iw, y1 * ih, x2 * iw, y2 * ih], dtype=np.float32)
        for x1, y1, x2, y2 in seed_bboxes_norm
    ]

    def _mask_to_poly(m: np.ndarray) -> list | None:
        if bbox_only:
            rows = np.any(m, axis=1)
            cols = np.any(m, axis=0)
            if not rows.any():
                return None
            y_min, y_max = int(np.where(rows)[0][0]), int(np.where(rows)[0][-1])
            x_min, x_max = int(np.where(cols)[0][0]), int(np.where(cols)[0][-1])
            return [x_min/iw, y_min/ih, x_max/iw, y_min/ih,
                    x_max/iw, y_max/ih, x_min/iw, y_max/ih]
        return mask_to_polygon(m, iw, ih)

    # 파일 복사는 lock 밖에서 — I/O 중 다른 추론 요청을 블로킹하지 않음
    tmp_dir_obj = tempfile.TemporaryDirectory()
    tmp_dir = tmp_dir_obj.name
    try:
        for i, path in enumerate(image_paths):
            with PILImage.open(path) as img:
                img.convert("RGB").save(
                    os.path.join(tmp_dir, f"{i:05d}.jpg"), "JPEG", quality=95
                )

        with _model_lock:
            predictor = _get_video_predictor()
            with torch.inference_mode():
                state = predictor.init_state(
                    video_path=tmp_dir, offload_video_to_cpu=True
                )
                for obj_id, bbox_px in enumerate(seed_bboxes_px):
                    predictor.add_new_points_or_box(
                        state, frame_idx=0, obj_id=obj_id, box=bbox_px
                    )

                results = []
                for frame_idx, obj_ids, masks in predictor.propagate_in_video(state):
                    for obj_id_t, mask_t in zip(obj_ids, masks):
                        obj_id = int(obj_id_t)
                        m = (mask_t[0].cpu().numpy() > 0.0).astype(np.uint8)
                        poly = _mask_to_poly(m)
                        if poly:
                            cls_id = seed_class_ids[obj_id] if obj_id < len(seed_class_ids) else 0
                            results.append({
                                "frame_idx": frame_idx,
                                "class_id": cls_id,
                                "polygon": poly,
                            })
                    if progress_cb:
                        progress_cb(frame_idx)

                predictor.reset_state(state)

        return results
    finally:
        tmp_dir_obj.cleanup()


def sam_predict_bbox(img_path: str, bbox_norm: list) -> list | None:
    """Interactive SAM2 bbox → mask (serialized via _model_lock)."""
    img_bgr = cv2.imread(str(img_path))
    if img_bgr is None:
        return None
    img_h, img_w = img_bgr.shape[:2]
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    x1, y1 = bbox_norm[0] * img_w, bbox_norm[1] * img_h
    x2, y2 = bbox_norm[2] * img_w, bbox_norm[3] * img_h
    bbox_px = np.array([[x1, y1, x2, y2]], dtype=np.float32)

    with _model_lock:
        _set_image_with_cache(img_path, img_rgb)
        masks, scores, _ = _sam_predictor.predict(box=bbox_px, multimask_output=True)

    best = int(np.argmax(scores))
    return mask_to_polygon(masks[best], img_w, img_h)


def sam_predict_points(img_path: str, points_norm: list, point_labels: list) -> list | None:
    """Interactive SAM2 point clicks → mask (serialized via _model_lock)."""
    img_bgr = cv2.imread(str(img_path))
    if img_bgr is None:
        return None
    img_h, img_w = img_bgr.shape[:2]
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    pts_px = np.array([[x * img_w, y * img_h] for x, y in points_norm], dtype=np.float32)
    labels = np.array(point_labels, dtype=np.int32)

    with _model_lock:
        _set_image_with_cache(img_path, img_rgb)
        masks, scores, _ = _sam_predictor.predict(
            point_coords=pts_px, point_labels=labels, multimask_output=True
        )

    best = int(np.argmax(scores))
    return mask_to_polygon(masks[best], img_w, img_h)


# ── Grounding DINO ────────────────────────────────────────────────────────────

_GDINO_DEFAULT = "IDEA-Research/grounding-dino-base"
_GDINO_PROMPT  = "fire . smoke"

_gdino_cache: dict = {}
_gdino_lock = threading.Lock()


def _get_gdino(model_id: str = _GDINO_DEFAULT):
    if model_id in _gdino_cache:
        return _gdino_cache[model_id]
    with _gdino_lock:
        if model_id in _gdino_cache:
            return _gdino_cache[model_id]
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        processor = AutoProcessor.from_pretrained(model_id)
        model = AutoModelForZeroShotObjectDetection.from_pretrained(model_id).to(_GDINO_DEVICE)
        model.eval()
        _gdino_cache[model_id] = (model, processor)
    return _gdino_cache[model_id]


def _merge_overlapping(detections: list, iou_threshold: float = 0.3, expand: float = 0.0) -> list:
    if len(detections) <= 1:
        return detections

    def expanded(bbox):
        x1, y1, x2, y2 = bbox
        dx = (x2 - x1) * expand
        dy = (y2 - y1) * expand
        return [x1 - dx, y1 - dy, x2 + dx, y2 + dy]

    by_class: dict[int, list] = {}
    for d in detections:
        by_class.setdefault(d["cls_id"], []).append(d)

    merged = []
    for cls_id, dets in by_class.items():
        n = len(dets)
        parent = list(range(n))

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for i in range(n):
            for j in range(i + 1, n):
                if _iou(expanded(dets[i]["bbox"]), expanded(dets[j]["bbox"])) > iou_threshold:
                    pi, pj = find(i), find(j)
                    if pi != pj:
                        parent[pi] = pj

        groups: dict[int, list] = {}
        for i in range(n):
            groups.setdefault(find(i), []).append(dets[i])

        for group in groups.values():
            x1 = min(d["bbox"][0] for d in group)
            y1 = min(d["bbox"][1] for d in group)
            x2 = max(d["bbox"][2] for d in group)
            y2 = max(d["bbox"][3] for d in group)
            best_conf = max(d["conf"] for d in group)
            merged.append({"cls_id": cls_id, "conf": best_conf, "bbox": [x1, y1, x2, y2]})

    return merged


def _brightness_trim_bbox(img_path: str, x1: float, y1: float, x2: float, y2: float,
                          bright_percentile: float = 70.0) -> list | None:
    try:
        img = cv2.imread(str(img_path))
        if img is None:
            return None
        xi1, yi1, xi2, yi2 = int(x1), int(y1), int(x2), int(y2)
        xi1, yi1 = max(0, xi1), max(0, yi1)
        xi2, yi2 = min(img.shape[1], xi2), min(img.shape[0], yi2)
        crop = img[yi1:yi2, xi1:xi2]
        if crop.size == 0:
            return None
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        threshold = np.percentile(gray, bright_percentile)
        mask = gray >= max(threshold, 80)
        rows = np.any(mask, axis=1)
        cols = np.any(mask, axis=0)
        if not rows.any() or not cols.any():
            return None
        r_min, r_max = int(np.where(rows)[0][0]), int(np.where(rows)[0][-1])
        c_min, c_max = int(np.where(cols)[0][0]), int(np.where(cols)[0][-1])
        return [xi1 + c_min, yi1 + r_min, xi1 + c_max, yi1 + r_max]
    except Exception:
        return None


def _sam_tight_bbox(img_path: str, x1: float, y1: float, x2: float, y2: float,
                    img_w: int, img_h: int) -> list | None:
    """GDINO rough bbox → SAM2 mask → tight bbox."""
    try:
        bbox_norm = [x1 / img_w, y1 / img_h, x2 / img_w, y2 / img_h]
        polygon = sam_predict_bbox(img_path, bbox_norm)
        if not polygon or len(polygon) < 4:
            return None
        xs = [polygon[i] * img_w for i in range(0, len(polygon), 2)]
        ys = [polygon[i] * img_h for i in range(1, len(polygon), 2)]
        return [min(xs), min(ys), max(xs), max(ys)]
    except Exception:
        return None


def run_inference_gdino(img_path: str, conf_threshold: float = 0.3,
                        roi: list | None = None, weights_path: str | None = None):
    """Grounding DINO zero-shot detection (runs on _GDINO_DEVICE, independent of _model_lock)."""
    import logging
    from PIL import Image as PILImage

    _log = logging.getLogger(__name__)
    model_id = weights_path if weights_path else _GDINO_DEFAULT
    model, processor = _get_gdino(model_id)

    image = PILImage.open(str(img_path)).convert("RGB")
    img_w, img_h = image.size

    crop_x, crop_y = 0, 0
    infer_image = image
    infer_w, infer_h = img_w, img_h

    if roi and len(roi) >= 6:
        cx1, cy1, cx2, cy2 = _roi_crop_box(roi, img_w, img_h)
        if (cx2 - cx1) > 32 and (cy2 - cy1) > 32:
            infer_image = image.crop((cx1, cy1, cx2, cy2))
            crop_x, crop_y = cx1, cy1
            infer_w, infer_h = cx2 - cx1, cy2 - cy1

    infer_area = infer_w * infer_h

    inputs = processor(images=infer_image, text=_GDINO_PROMPT, return_tensors="pt").to(_GDINO_DEVICE)
    with torch.no_grad():
        outputs = model(**inputs)

    results = processor.post_process_grounded_object_detection(
        outputs, inputs.input_ids,
        box_threshold=0.15,
        text_threshold=0.15,
        target_sizes=[(infer_h, infer_w)],
    )[0]

    _log.info("[GDINO] %s → %d detections (crop_offset=%d,%d): %s",
              img_path, len(results["boxes"]), crop_x, crop_y,
              [(lbl, round(float(s), 2)) for lbl, s in zip(results["labels"], results["scores"])])

    raw = []
    for box, score, lbl in zip(results["boxes"], results["scores"], results["labels"]):
        conf = float(score)
        x1 = float(box[0]) + crop_x
        y1 = float(box[1]) + crop_y
        x2 = float(box[2]) + crop_x
        y2 = float(box[3]) + crop_y

        if not _in_roi([x1, y1, x2, y2], img_w, img_h, roi):
            continue

        lbl_lower = lbl.lower()
        has_fire  = "fire" in lbl_lower or "flame" in lbl_lower
        has_smoke = "smoke" in lbl_lower or "haze" in lbl_lower
        if has_smoke:
            cls_id = 1
        elif has_fire:
            cls_id = 0
        else:
            cls_id = 1
            _log.warning("[GDINO] unknown label '%s' (conf=%.2f) → smoke fallback", lbl, conf)

        bbox_area = (x2 - x1) * (y2 - y1)
        area_limit = 0.7 if cls_id == 0 else 0.4
        if bbox_area / infer_area > area_limit:
            continue

        raw.append({"cls_id": cls_id, "conf": conf, "bbox": [x1, y1, x2, y2]})

    raw = _merge_overlapping(raw, iou_threshold=0.3, expand=0.15)

    auto_labels, review_items = [], []
    for det in raw:
        cls_id, conf = det["cls_id"], det["conf"]
        x1, y1, x2, y2 = det["bbox"]

        if cls_id == 0:
            trimmed = _brightness_trim_bbox(img_path, x1, y1, x2, y2)
            if trimmed:
                x1, y1, x2, y2 = trimmed
        tight_bbox = _sam_tight_bbox(img_path, x1, y1, x2, y2, img_w, img_h)
        if tight_bbox:
            x1, y1, x2, y2 = tight_bbox

        poly = [
            x1 / img_w, y1 / img_h,
            x2 / img_w, y1 / img_h,
            x2 / img_w, y2 / img_h,
            x1 / img_w, y2 / img_h,
        ]
        if conf >= conf_threshold:
            auto_labels.append({"class_id": cls_id, "polygon": poly, "confidence": conf})
        else:
            review_items.append({
                "class_id": cls_id,
                "confidence": conf,
                "bbox": [x1, y1, x2, y2],
            })

    return auto_labels, review_items
