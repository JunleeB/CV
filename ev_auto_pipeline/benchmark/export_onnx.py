"""
YOLO .pt -> dynamic-batch ONNX export.
Usage: python export_onnx.py --model best.pt [--imgsz 640] [--opset 17]
"""
import argparse
from ultralytics import YOLO


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="path to .pt checkpoint")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()

    model = YOLO(args.model)
    model.export(format="onnx", opset=args.opset, imgsz=args.imgsz,
                 simplify=True, dynamic=True)


if __name__ == "__main__":
    main()
