"""
polygraphy --data-loader-script 용 INT8 캘리브레이션 데이터 로더.
실제 배포 도메인 이미지로 캘리브레이션해야 한다 (오픈데이터셋 X) -
캘리브레이션 분포가 실운영 분포와 다르면 관측되는 스케일 자체가 틀어진다.

사용법:
  CALIB_IMG_DIR=/path/to/domain/images CALIB_BATCH=1 \
  polygraphy run model.onnx --trt --int8 --data-loader-script calibration_loader.py ...
"""
import os
import cv2
import numpy as np
from pathlib import Path

IMG_DIR = Path(os.environ.get("CALIB_IMG_DIR", "calib_images"))
IMG_SIZE = int(os.environ.get("CALIB_IMG_SIZE", "640"))
BATCH = int(os.environ.get("CALIB_BATCH", "1"))


def letterbox(img, new_size=640, color=(114, 114, 114)):
    h, w = img.shape[:2]
    r = min(new_size / h, new_size / w)
    nh, nw = int(round(h * r)), int(round(w * r))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    top = (new_size - nh) // 2
    bottom = new_size - nh - top
    left = (new_size - nw) // 2
    right = new_size - nw - left
    return cv2.copyMakeBorder(resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)


def load_data():
    paths = sorted(IMG_DIR.glob("*.jpg"))
    batch = []
    for p in paths:
        img_bgr = cv2.imread(str(p))
        if img_bgr is None:
            continue
        img = letterbox(img_bgr, IMG_SIZE)
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        img = img.transpose(2, 0, 1).astype(np.float32) / 255.0
        batch.append(img)
        if len(batch) == BATCH:
            arr = np.ascontiguousarray(np.stack(batch, axis=0))
            yield {"images": arr}
            batch = []
