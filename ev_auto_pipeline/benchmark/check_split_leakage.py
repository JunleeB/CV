"""
train/val이 "클립(영상) 단위"가 아니라 "프레임 단위"로 잘못 분할됐는지 확인.

CCTV처럼 연속 프레임을 추출해 만든 데이터셋은 인접 프레임끼리 사실상
동일한 장면이라, 무작위 프레임 분할을 하면 val에 있는 장면이 train에서
이미 (거의) 학습된 상태가 되어 mAP가 부풀려진다.

파일명이 `{클립ID}_{프레임번호}.jpg` 형태라고 가정한다 (필요시 CLIP_ID_RE 수정).

Usage: python check_split_leakage.py --train-dir dataset/images/train --val-dir dataset/images/val
"""
import argparse
import re
from pathlib import Path

CLIP_ID_RE = re.compile(r"\[[0-9]+\]")  # 예: GX010085[1]_001_0020.jpg 의 [1] 제거
FRAME_SUFFIX_RE = re.compile(r"_[0-9]+\.(jpg|jpeg|png)$")


def clip_id(filename: str) -> str:
    name = CLIP_ID_RE.sub("", filename)
    name = FRAME_SUFFIX_RE.sub("", name)
    return name


def collect_clip_ids(img_dir: Path) -> set[str]:
    return {clip_id(f.name) for f in img_dir.iterdir() if f.is_file()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-dir", required=True, type=Path)
    ap.add_argument("--val-dir", required=True, type=Path)
    args = ap.parse_args()

    train_clips = collect_clip_ids(args.train_dir)
    val_clips = collect_clip_ids(args.val_dir)
    overlap = train_clips & val_clips

    print(f"train 고유 클립 수: {len(train_clips)}")
    print(f"val 고유 클립 수:   {len(val_clips)}")
    print(f"양쪽에 다 있는 클립 수: {len(overlap)}")
    if val_clips:
        pct = len(overlap) / len(val_clips) * 100
        print(f"val 클립 중 train에도 있는 비율: {pct:.1f}%")
        if pct > 0:
            print("\n⚠ 데이터 누수 의심 — 클립 단위 GroupShuffleSplit으로 재분할 권장")


if __name__ == "__main__":
    main()
