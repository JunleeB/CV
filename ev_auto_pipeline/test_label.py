"""
테스트용 시각화 스크립트
사용법:
  venv/bin/python test_label.py                        # 기본 샘플 폴더에서 5장
  venv/bin/python test_label.py /경로/to/images        # 지정 폴더에서 5장
  venv/bin/python test_label.py /경로/to/images 10     # 지정 폴더에서 10장
결과: test_output/ 폴더에 마스크 시각화 이미지 저장
"""

import os, sys, cv2, torch, numpy as np
from pathlib import Path
from ultralytics import YOLO
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

os.environ["CUDA_VISIBLE_DEVICES"] = "2"

YOLO_WEIGHTS   = "runs/yolo11m_ev/weights/best.pt"
SAM2_CKPT      = "checkpoints/sam2.1_hiera_large.pt"
SAM2_CFG       = "configs/sam2.1/sam2.1_hiera_l.yaml"
CONF_THRESHOLD = 0.7
YOLO_CONF_MIN  = 0.3
CLASS_NAMES    = {0: "person", 1: "dog"}
CLASS_COLORS   = {0: (100, 200, 255), 1: (100, 255, 150)}  # BGR

DEFAULT_DIR    = "/nas03/1_EV_LABELING/center/GX010085_001"
OUT_DIR        = Path("test_output")


def draw_result(img_bgr, labels_with_poly, low_conf_list):
    """마스크 + bbox + 텍스트를 이미지에 그려서 반환"""
    vis = img_bgr.copy()
    overlay = img_bgr.copy()
    h, w = vis.shape[:2]

    for cls_id, polygon in labels_with_poly:
        color = CLASS_COLORS.get(cls_id, (200, 200, 200))
        # 정규화 좌표 → 픽셀 좌표
        pts = np.array(polygon, dtype=np.float32).reshape(-1, 2)
        pts[:, 0] *= w
        pts[:, 1] *= h
        pts = pts.astype(np.int32)
        # 마스크 채우기 (반투명)
        cv2.fillPoly(overlay, [pts], color)
        # 외곽선
        cv2.polylines(vis, [pts], isClosed=True, color=color, thickness=2)
        # 라벨
        cx, cy = pts.mean(axis=0).astype(int)
        cv2.putText(vis, CLASS_NAMES.get(cls_id, str(cls_id)),
                    (cx - 20, cy), cv2.FONT_HERSHEY_SIMPLEX,
                    0.7, color, 2, cv2.LINE_AA)

    # 반투명 오버레이 합성
    vis = cv2.addWeighted(overlay, 0.35, vis, 0.65, 0)

    # 검수 필요 항목은 빨간 bbox로 표시
    for item in low_conf_list:
        x1, y1, x2, y2 = [int(v) for v in item["bbox"]]
        cv2.rectangle(vis, (x1, y1), (x2, y2), (0, 0, 255), 2)
        label = f"?{CLASS_NAMES.get(item['class_id'], '')} {item['conf']:.2f}"
        cv2.putText(vis, label, (x1, y1 - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 1, cv2.LINE_AA)

    return vis


def mask_to_polygon(mask, img_w, img_h):
    contours, _ = cv2.findContours(
        mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return None
    largest = max(contours, key=cv2.contourArea)
    eps = 0.002 * cv2.arcLength(largest, True)
    approx = cv2.approxPolyDP(largest, eps, True)
    if len(approx) < 3:
        return None
    pts = approx.reshape(-1, 2)
    return [v for x, y in pts for v in (x / img_w, y / img_h)]


def process_image(img_path, yolo, predictor):
    img_bgr = cv2.imread(str(img_path))
    if img_bgr is None:
        return None, [], []
    img_h, img_w = img_bgr.shape[:2]
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    results = yolo(img_bgr, conf=YOLO_CONF_MIN, verbose=False)
    labels, low_conf = [], []

    for result in results:
        if result.boxes is None or len(result.boxes) == 0:
            continue
        sam_set = False
        for box in result.boxes:
            cls_id = int(box.cls)
            conf   = float(box.conf)
            bbox   = box.xyxy[0].cpu().numpy()
            if conf >= CONF_THRESHOLD:
                if not sam_set:
                    predictor.set_image(img_rgb)
                    sam_set = True
                masks, _, _ = predictor.predict(box=bbox[None], multimask_output=False)
                poly = mask_to_polygon(masks[0], img_w, img_h)
                if poly:
                    labels.append((cls_id, poly))
            else:
                low_conf.append({"class_id": cls_id, "conf": conf, "bbox": bbox.tolist()})

    return img_bgr, labels, low_conf


def main():
    src_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_DIR)
    n_imgs  = int(sys.argv[2]) if len(sys.argv) > 2 else 5

    if not src_dir.exists():
        print(f"경로 없음: {src_dir}")
        sys.exit(1)

    images = sorted(src_dir.glob("*.jpg"))[:n_imgs]
    if not images:
        print(f"jpg 없음: {src_dir}")
        sys.exit(1)

    OUT_DIR.mkdir(exist_ok=True)

    print("모델 로딩 중...")
    yolo = YOLO(YOLO_WEIGHTS)
    sam2 = build_sam2(SAM2_CFG, SAM2_CKPT, device="cuda")
    predictor = SAM2ImagePredictor(sam2)
    print(f"모델 로딩 완료. {len(images)}장 처리 시작\n")

    for img_path in images:
        img_bgr, labels, low_conf = process_image(img_path, yolo, predictor)
        if img_bgr is None:
            continue

        vis = draw_result(img_bgr, labels, low_conf)
        out_path = OUT_DIR / img_path.name
        cv2.imwrite(str(out_path), vis)

        auto_objs   = [f"{CLASS_NAMES.get(c,'?')}(auto)" for c, _ in labels]
        review_objs = [f"{CLASS_NAMES.get(i['class_id'],'?')}(conf={i['conf']:.2f})" for i in low_conf]
        print(f"{img_path.name}")
        if auto_objs:
            print(f"  ✓ 자동마스크: {', '.join(auto_objs)}")
        if review_objs:
            print(f"  ⚠ 검수필요:  {', '.join(review_objs)}")
        if not auto_objs and not review_objs:
            print(f"  - 객체 없음")

    print(f"\n결과 저장됨 → {OUT_DIR.resolve()}/")


if __name__ == "__main__":
    main()
