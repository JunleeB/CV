"""
거울 영역 좌표 찾기 - 그리드 오버레이 버전 (X11 불필요)
사용법: venv/bin/python3 find_mirror_zone.py
출력:  mirror_preview/ 폴더에 그리드 이미지 저장
"""
import cv2
import os
from pathlib import Path

OUTPUT_DIR = Path("output")
PREVIEW_DIR = Path("mirror_preview")
GRID_STEP = 50  # 그리드 간격 (픽셀)


def draw_grid(img):
    h, w = img.shape[:2]
    out = img.copy()

    for x in range(0, w, GRID_STEP):
        color = (0, 0, 255) if x % 100 == 0 else (100, 100, 100)
        thick = 2 if x % 100 == 0 else 1
        cv2.line(out, (x, 0), (x, h), color, thick)
        if x % 100 == 0:
            cv2.putText(out, str(x), (x + 2, 15),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)

    for y in range(0, h, GRID_STEP):
        color = (0, 0, 255) if y % 100 == 0 else (100, 100, 100)
        thick = 2 if y % 100 == 0 else 1
        cv2.line(out, (0, y), (w, y), color, thick)
        if y % 100 == 0:
            cv2.putText(out, str(y), (2, y + 12),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)

    return out


def main():
    PREVIEW_DIR.mkdir(exist_ok=True)

    cameras = sorted(d for d in OUTPUT_DIR.iterdir() if d.is_dir())

    for cam_dir in cameras:
        images = sorted(cam_dir.rglob("*.jpg"))
        if not images:
            continue

        # 각 카메라에서 3장 샘플
        step = max(1, len(images) // 3)
        samples = [images[i * step] for i in range(min(3, len(images) // step + 1))]

        for i, img_path in enumerate(samples):
            img = cv2.imread(str(img_path))
            if img is None:
                continue

            h, w = img.shape[:2]
            grid_img = draw_grid(img)

            out_name = f"{cam_dir.name}_sample{i+1}_{w}x{h}.jpg"
            out_path = PREVIEW_DIR / out_name
            cv2.imwrite(str(out_path), grid_img)
            print(f"저장: {out_path}  ({w}x{h})")

    print(f"\n완료! mirror_preview/ 폴더의 이미지를 브라우저로 확인하세요.")
    print(f"접속: http://192.168.110.106:8000/mirror_preview/")


if __name__ == "__main__":
    main()
