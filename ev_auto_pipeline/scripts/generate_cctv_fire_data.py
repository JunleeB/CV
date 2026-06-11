"""
CCTV 배경 + Fire/Smoke Copy-Paste 합성 데이터 생성기

동작 원리:
  1. fire_smoke 학습 데이터에서 fire/smoke bbox를 오려냄
  2. EV 주차장 CCTV 이미지를 배경으로 사용
  3. crop을 소형(1~5%)으로 축소해서 자연스럽게 블렌딩
  4. YOLO detect 포맷 라벨 자동 생성

Usage:
  python generate_cctv_fire_data.py
  python generate_cctv_fire_data.py --num-images 3000 --output-dir datasets/cctv_fire_synth
"""

import cv2
import numpy as np
import os
import random
import argparse
import shutil
from pathlib import Path

# ──────────────────────────────────────────
# 경로 설정
# ──────────────────────────────────────────
BASE = Path(__file__).parent
FIRE_TRAIN_IMG = BASE / "datasets/fire_smoke/train/images"
FIRE_TRAIN_LBL = BASE / "datasets/fire_smoke/train/labels"
BG_DIR         = BASE / "dataset/images/train"   # EV 주차장 CCTV 이미지
OUTPUT_DIR     = BASE / "datasets/cctv_fire_synth"

# ──────────────────────────────────────────
# 파라미터
# ──────────────────────────────────────────
SCALE_MIN   = 0.005   # 배경 대비 fire crop 최소 크기 (0.5%)
SCALE_MAX   = 0.08    # 배경 대비 fire crop 최대 크기 (8%)
MAX_PASTES  = 3       # 이미지당 최대 붙이는 개수
EDGE_BLUR   = 3       # 경계 블렌딩 강도 (홀수)
ALPHA_BASE  = 0.75    # fire 불투명도 기본값
VAL_RATIO   = 0.1     # 검증셋 비율


def load_crops(img_dir: Path, lbl_dir: Path):
    """fire_smoke 데이터에서 (crop_img, class_id) 리스트 반환"""
    crops = []
    img_files = list(img_dir.glob("*.jpg")) + list(img_dir.glob("*.png"))
    print(f"  fire_smoke 이미지 {len(img_files)}장 스캔 중...")

    for img_path in img_files:
        lbl_path = lbl_dir / (img_path.stem + ".txt")
        if not lbl_path.exists():
            continue

        img = cv2.imread(str(img_path))
        if img is None:
            continue
        h, w = img.shape[:2]

        with open(lbl_path) as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) < 5:
                    continue
                cls = int(parts[0])
                cx, cy, bw, bh = map(float, parts[1:5])

                # bbox 픽셀 좌표
                x1 = int((cx - bw / 2) * w)
                y1 = int((cy - bh / 2) * h)
                x2 = int((cx + bw / 2) * w)
                y2 = int((cy + bh / 2) * h)
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(w, x2), min(h, y2)

                if x2 - x1 < 8 or y2 - y1 < 8:
                    continue

                crop = img[y1:y2, x1:x2]
                crops.append((crop, cls))

    return crops


def blend_paste(bg: np.ndarray, crop: np.ndarray, x: int, y: int, alpha: float) -> np.ndarray:
    """crop을 bg의 (x,y) 위치에 알파 블렌딩으로 붙임"""
    h, w = crop.shape[:2]
    bh, bw = bg.shape[:2]

    # 범위 클리핑
    x2, y2 = min(x + w, bw), min(y + h, bh)
    cw, ch = x2 - x, y2 - y
    if cw <= 0 or ch <= 0:
        return bg

    crop_roi = crop[:ch, :cw]
    bg_roi   = bg[y:y2, x:x2].astype(np.float32)

    # 경계 페더링 마스크
    mask = np.ones((ch, cw), dtype=np.float32) * alpha
    feather = min(EDGE_BLUR, ch // 4, cw // 4)
    if feather > 0:
        for i in range(feather):
            val = alpha * (i + 1) / (feather + 1)
            mask[i, :]  = np.minimum(mask[i, :],  val)
            mask[-i-1, :] = np.minimum(mask[-i-1, :], val)
            mask[:, i]  = np.minimum(mask[:, i],  val)
            mask[:, -i-1] = np.minimum(mask[:, -i-1], val)

    mask3 = mask[:, :, np.newaxis]
    blended = crop_roi.astype(np.float32) * mask3 + bg_roi * (1 - mask3)
    bg = bg.copy()
    bg[y:y2, x:x2] = blended.astype(np.uint8)
    return bg


def synthesize(bg_img: np.ndarray, crops: list, n_paste: int):
    """
    배경에 n_paste개의 fire/smoke를 붙이고
    YOLO 포맷 라벨 [(cls, cx, cy, bw, bh), ...] 반환
    """
    bh, bw = bg_img.shape[:2]
    result  = bg_img.copy()
    labels  = []

    attempts = 0
    placed   = 0
    placed_boxes = []  # 겹침 방지용

    while placed < n_paste and attempts < n_paste * 10:
        attempts += 1
        crop, cls = random.choice(crops)
        ch_orig, cw_orig = crop.shape[:2]

        # 목표 크기: 배경 면적 대비 SCALE_MIN ~ SCALE_MAX
        target_area  = random.uniform(SCALE_MIN, SCALE_MAX) * (bw * bh)
        orig_aspect  = cw_orig / max(ch_orig, 1)
        new_h = int((target_area / orig_aspect) ** 0.5)
        new_w = int(new_h * orig_aspect)
        new_w = max(new_w, 6)
        new_h = max(new_h, 6)

        if new_w >= bw or new_h >= bh:
            continue

        # 랜덤 위치 (이미지 내부에만)
        x = random.randint(0, bw - new_w)
        y = random.randint(0, bh - new_h)

        # 기존 박스와 겹침 체크 (IoU > 0.3 이면 skip)
        overlap = False
        for (px, py, pw, ph) in placed_boxes:
            ix1 = max(x, px); iy1 = max(y, py)
            ix2 = min(x + new_w, px + pw); iy2 = min(y + new_h, py + ph)
            if ix2 > ix1 and iy2 > iy1:
                inter = (ix2 - ix1) * (iy2 - iy1)
                union = new_w * new_h + pw * ph - inter
                if inter / union > 0.3:
                    overlap = True
                    break
        if overlap:
            continue

        # 리사이즈 & 붙이기
        resized = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        alpha   = random.uniform(ALPHA_BASE - 0.15, min(ALPHA_BASE + 0.15, 1.0))
        result  = blend_paste(result, resized, x, y, alpha)

        # YOLO 라벨 (정규화)
        cx_n = (x + new_w / 2) / bw
        cy_n = (y + new_h / 2) / bh
        bw_n = new_w / bw
        bh_n = new_h / bh
        labels.append((cls, cx_n, cy_n, bw_n, bh_n))
        placed_boxes.append((x, y, new_w, new_h))
        placed += 1

    return result, labels


def main(num_images: int, output_dir: Path, seed: int):
    random.seed(seed)
    np.random.seed(seed)

    out_train_img = output_dir / "train/images"
    out_train_lbl = output_dir / "train/labels"
    out_val_img   = output_dir / "valid/images"
    out_val_lbl   = output_dir / "valid/labels"
    for d in [out_train_img, out_train_lbl, out_val_img, out_val_lbl]:
        d.mkdir(parents=True, exist_ok=True)

    # ── 1. fire/smoke crop 수집
    print("[1/3] Fire/Smoke crop 수집 중...")
    crops = load_crops(FIRE_TRAIN_IMG, FIRE_TRAIN_LBL)
    print(f"      → crop {len(crops)}개 수집 완료")

    if len(crops) == 0:
        print("ERROR: crop을 찾지 못했습니다. 경로를 확인하세요.")
        return

    # ── 2. 배경 이미지 목록
    print("[2/3] 배경(CCTV) 이미지 목록 로드 중...")
    bg_files = list(BG_DIR.glob("*.jpg")) + list(BG_DIR.glob("*.png"))
    random.shuffle(bg_files)
    print(f"      → 배경 {len(bg_files)}장 사용 가능")

    if len(bg_files) == 0:
        print(f"ERROR: 배경 이미지가 없습니다. BG_DIR={BG_DIR}")
        return

    # ── 3. 합성
    print(f"[3/3] 합성 이미지 {num_images}장 생성 중...")
    n_val   = int(num_images * VAL_RATIO)
    n_train = num_images - n_val

    generated = 0
    for i in range(num_images):
        bg_path = bg_files[i % len(bg_files)]
        bg = cv2.imread(str(bg_path))
        if bg is None:
            continue

        # 640x640 으로 리사이즈 (학습 해상도 맞춤)
        bg = cv2.resize(bg, (640, 640))

        n_paste = random.randint(1, MAX_PASTES)
        synth, labels = synthesize(bg, crops, n_paste)

        if not labels:
            continue

        # train / val 분리
        is_val  = (generated < n_val)
        img_dir = out_val_img if is_val else out_train_img
        lbl_dir = out_val_lbl if is_val else out_train_lbl

        stem = f"synth_{generated:06d}"
        cv2.imwrite(str(img_dir / f"{stem}.jpg"), synth, [cv2.IMWRITE_JPEG_QUALITY, 92])
        with open(lbl_dir / f"{stem}.txt", "w") as f:
            for (cls, cx, cy, bw, bh) in labels:
                f.write(f"{cls} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}\n")

        generated += 1
        if generated % 500 == 0:
            print(f"      {generated}/{num_images} 완료...")

    # ── data.yaml 생성
    yaml_path = output_dir / "data.yaml"
    yaml_path.write_text(
        f"path: {output_dir.resolve()}\n"
        f"train: train/images\n"
        f"val: valid/images\n"
        f"\n"
        f"nc: 2\n"
        f"names: ['fire', 'smoke']\n"
    )

    print(f"\n완료!")
    print(f"  train: {n_train}장  |  val: {n_val}장")
    print(f"  저장 위치: {output_dir.resolve()}")
    print(f"  data.yaml: {yaml_path.resolve()}")
    print(f"\n다음 학습 명령:")
    print(f"  CUDA_VISIBLE_DEVICES=3 venv/bin/python -m ultralytics train \\")
    print(f"    model=yolo11x.pt \\")
    print(f"    data={yaml_path.resolve()} \\")
    print(f"    epochs=80 imgsz=640 batch=8 optimizer=AdamW lr0=0.001 lrf=0.01 freeze=0")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CCTV 배경 + Fire/Smoke Copy-Paste 합성 데이터 생성기")
    parser.add_argument("--num-images", type=int, default=3000,
                        help="생성할 합성 이미지 수 (기본: 3000)")
    parser.add_argument("--output-dir", type=str, default="datasets/cctv_fire_synth",
                        help="출력 디렉토리 (기본: datasets/cctv_fire_synth)")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    main(
        num_images=args.num_images,
        output_dir=BASE / args.output_dir,
        seed=args.seed,
    )
