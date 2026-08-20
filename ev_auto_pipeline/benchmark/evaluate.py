"""
mAP 평가 (.pt / .onnx / .engine 전부 동일 인터페이스로).

주의: ONNX/TensorRT로 변환하면 .pt 체크포인트에 있던 task 메타데이터
(segment/detect)가 유실된다. task를 명시하지 않으면 ultralytics가
'detect'로 잘못 추정해서 세그멘테이션 후처리를 건너뛴 채 평가/속도를
재는 사고가 난다 - 반드시 --task를 명시할 것.

Usage: python evaluate.py --model model.engine --data data.yaml --task segment
"""
import argparse
from ultralytics import YOLO


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--task", choices=["detect", "segment"], required=True)
    ap.add_argument("--split", default="val")
    args = ap.parse_args()

    model = YOLO(args.model, task=args.task)
    r = model.val(data=args.data, split=args.split)

    print(f"mAP50(B): {r.box.map50:.4f}  mAP50-95(B): {r.box.map:.4f}")
    if args.task == "segment":
        print(f"mAP50(M): {r.seg.map50:.4f}  mAP50-95(M): {r.seg.map:.4f}")


if __name__ == "__main__":
    main()
