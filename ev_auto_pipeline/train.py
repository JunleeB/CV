import os
os.environ["CUDA_VISIBLE_DEVICES"] = "2"

from ultralytics import YOLO

model = YOLO("yolo11m-seg.pt")

model.train(
    data="/home1/junlee/ev_auto_pipeline/dataset.yaml",
    epochs=100,
    imgsz=640,
    batch=16,
    workers=4,
    project="/home1/junlee/ev_auto_pipeline/runs",
    name="yolo11m_ev",
    exist_ok=True,
    patience=20,
    save=True,
    val=True,
    plots=True,
)
