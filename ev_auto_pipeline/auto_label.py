import os
import cv2
import numpy as np
from pathlib import Path
from tqdm import tqdm
from ultralytics import YOLO
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

# ── 설정 ──────────────────────────────────────────────
YOLO_WEIGHTS     = "runs/yolo11m_ev/weights/best.pt"
SAM2_CKPT        = "checkpoints/sam2.1_hiera_large.pt"
SAM2_CFG         = "configs/sam2.1/sam2.1_hiera_l.yaml"
CONF_THRESHOLD   = 0.7    # 이 이상만 자동 저장
YOLO_CONF_MIN    = 0.3    # YOLO 추론 최소 threshold

# 좌/우 거울 반사체는 실제 객체와 y좌표가 거의 같고 x만 다르게 나타남
Y_DEDUP_THRESHOLD = 100
# 엘리베이터 공간 특성상 클래스별 최대 실제 객체 수
MAX_PER_CLASS    = {0: 6, 1: 3}  # person: 최대 6, dog: 최대 3

SOURCE_DIRS      = [
    "/home1/junlee/ev_auto_pipeline/output",
]
OUT_LABEL_SUBDIR = "auto"           # labels/auto/
REVIEW_OUTPUT    = "low_confidence_list.txt"
CLASS_NAMES      = {0: "person", 1: "dog"}
os.environ["CUDA_VISIBLE_DEVICES"] = "3"
DEVICE           = "cuda"
# ──────────────────────────────────────────────────────


def center_weight(bbox, img_w: int) -> float:
    cx = (bbox[0] + bbox[2]) / 2
    edge_ratio = abs(cx - img_w / 2) / (img_w / 2)  # 0=중앙, 1=끝
    return 1.0 - 0.5 * edge_ratio  # 중앙 1.0, 끝 0.5


def dedup_by_y(boxes, img_w: int):
    boxes = sorted(boxes, key=lambda b: b[1] * center_weight(b[2], img_w), reverse=True)
    kept = []
    for cls_id, conf, bbox in boxes:
        cy = (bbox[1] + bbox[3]) / 2
        duplicate = any(
            k_cls == cls_id and
            abs((k_bbox[1] + k_bbox[3]) / 2 - cy) < Y_DEDUP_THRESHOLD
            for k_cls, _, k_bbox in kept
        )
        if not duplicate:
            kept.append((cls_id, conf, bbox))
    return kept


def cap_by_class(boxes):
    """클래스별 최대 검출 수 초과분 제거 (conf 내림차순 기준 상위 N개 유지)"""
    count = {}
    kept = []
    for cls_id, conf, bbox in boxes:  # 이미 conf 내림차순 정렬된 상태
        count[cls_id] = count.get(cls_id, 0)
        if count[cls_id] < MAX_PER_CLASS.get(cls_id, 999):
            kept.append((cls_id, conf, bbox))
            count[cls_id] += 1
    return kept


def mask_to_polygon(mask: np.ndarray, img_w: int, img_h: int):
    """binary mask → 정규화된 YOLO polygon 좌표 리스트"""
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
    points = approx.reshape(-1, 2)
    coords = []
    for x, y in points:
        coords.extend([x / img_w, y / img_h])
    return coords


def process_image(img_path: Path, yolo: YOLO, sam_predictor: SAM2ImagePredictor, conf_thr: float):
    """
    Returns:
        labels       : list of (cls_id, polygon_coords)
        low_conf_list: list of dict  {file, class_id, class_name, conf}
    """
    img_bgr = cv2.imread(str(img_path))
    if img_bgr is None:
        return [], []
    img_h, img_w = img_bgr.shape[:2]
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    results = yolo(img_bgr, conf=YOLO_CONF_MIN, verbose=False)

    labels = []
    low_conf_list = []

    for result in results:
        if result.boxes is None or len(result.boxes) == 0:
            continue

        raw = [
            (int(b.cls), float(b.conf), b.xyxy[0].cpu().numpy())
            for b in result.boxes
        ]
        boxes = cap_by_class(dedup_by_y(raw, img_w))

        sam_set = False

        for cls_id, conf, bbox in boxes:
            if conf >= conf_thr:
                if not sam_set:
                    sam_predictor.set_image(img_rgb)
                    sam_set = True

                masks, _, _ = sam_predictor.predict(
                    box=bbox[None],          # (1, 4)
                    multimask_output=False,
                )
                polygon = mask_to_polygon(masks[0], img_w, img_h)
                if polygon:
                    labels.append((cls_id, polygon))
            else:
                low_conf_list.append({
                    "file":       str(img_path),
                    "class_id":   cls_id,
                    "class_name": CLASS_NAMES.get(cls_id, str(cls_id)),
                    "conf":       conf,
                })

    return labels, low_conf_list


def save_yolo_labels(labels: list, out_path: Path):
    with open(out_path, "w") as f:
        for cls_id, polygon in labels:
            coords = " ".join(f"{v:.6f}" for v in polygon)
            f.write(f"{cls_id} {coords}\n")


def main():
    print("모델 로딩 중...")
    yolo = YOLO(YOLO_WEIGHTS)

    sam2_model = build_sam2(SAM2_CFG, SAM2_CKPT, device=DEVICE)
    sam_predictor = SAM2ImagePredictor(sam2_model)
    print("모델 로딩 완료\n")

    all_review = []
    total_auto = 0
    total_skip = 0

    for src_dir in SOURCE_DIRS:
        src_path = Path(src_dir)

        # output/ → GX010085[1]/ → 001_안고탑승.../ → *.jpg (3단계 구조)
        camera_dirs = sorted(
            d for d in src_path.iterdir()
            if d.is_dir() and not d.name.startswith("@")
        )

        for camera_dir in camera_dirs:
            clip_dirs = sorted(
                d for d in camera_dir.iterdir()
                if d.is_dir() and not d.name.startswith("@")
            )

            for clip_dir in clip_dirs:
                out_label_dir = clip_dir / "labels" / OUT_LABEL_SUBDIR
                out_label_dir.mkdir(parents=True, exist_ok=True)

                images = sorted(clip_dir.glob("*.jpg"))
                if not images:
                    continue

                auto_count  = 0
                review_count = 0

                for img_path in tqdm(images, desc=f"[{camera_dir.name}] {clip_dir.name}", leave=False):
                    out_txt = out_label_dir / (img_path.stem + ".txt")
                    if out_txt.exists():
                        total_skip += 1
                        continue

                    labels, low_conf = process_image(img_path, yolo, sam_predictor, CONF_THRESHOLD)

                    if labels:
                        save_yolo_labels(labels, out_txt)
                        auto_count += 1
                    else:
                        out_txt.touch()

                    if low_conf:
                        review_count += len(low_conf)
                        all_review.extend(low_conf)

                total_auto += auto_count
                print(
                    f"[{camera_dir.name}] {clip_dir.name}: "
                    f"자동완료 {auto_count}장  검수필요 {review_count}건"
                )

    # 검수 목록 저장
    review_path = Path(REVIEW_OUTPUT)
    with open(review_path, "w") as f:
        for item in all_review:
            f.write(
                f"{item['file']}\t"
                f"class={item['class_id']}({item['class_name']})\t"
                f"conf={item['conf']:.3f}\n"
            )

    print("\n" + "=" * 60)
    print(f"총 자동완료 : {total_auto:,} 장")
    print(f"총 스킵(기존): {total_skip:,} 장")
    print(f"총 검수필요 : {len(all_review):,} 건  →  {review_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
