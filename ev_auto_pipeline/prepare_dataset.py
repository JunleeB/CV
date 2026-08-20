import shutil
from pathlib import Path
from sklearn.model_selection import train_test_split

SRC_CENTER = "/nas03/1_EV_LABELING/center"
SRC_CORNER = "/nas03/1_EV_LABELING/corner"
DST = "/home1/junlee/ev_auto_pipeline/dataset"


def collect_data(src_root):
    images = []
    labels = []
    for clip_dir in sorted(Path(src_root).iterdir()):
        if not clip_dir.is_dir():
            continue
        label_dir = clip_dir / "labels" / "train"
        if not label_dir.exists():
            continue
        for img_file in sorted(clip_dir.glob("*.jpg")):
            label_file = label_dir / (img_file.stem + ".txt")
            if label_file.exists():
                images.append(img_file)
                labels.append(label_file)
    return images, labels


def build_split(images, labels, split):
    img_dst = Path(DST) / "images" / split
    lbl_dst = Path(DST) / "labels" / split
    img_dst.mkdir(parents=True, exist_ok=True)
    lbl_dst.mkdir(parents=True, exist_ok=True)
    for img, lbl in zip(images, labels):
        shutil.copy2(img, img_dst / img.name)
        shutil.copy2(lbl, lbl_dst / lbl.name)


print("center 데이터 수집 중...")
c_imgs, c_lbls = collect_data(SRC_CENTER)
print(f"  center: {len(c_imgs)}장")

print("corner 데이터 수집 중...")
r_imgs, r_lbls = collect_data(SRC_CORNER)
print(f"  corner: {len(r_imgs)}장")

all_imgs = c_imgs + r_imgs
all_lbls = c_lbls + r_lbls
print(f"  전체: {len(all_imgs)}장")

tr_imgs, val_imgs, tr_lbls, val_lbls = train_test_split(
    all_imgs, all_lbls, test_size=0.2, random_state=42
)

print("train 복사 중...")
build_split(tr_imgs, tr_lbls, "train")
print("val 복사 중...")
build_split(val_imgs, val_lbls, "val")

print(f"\n완료 — train: {len(tr_imgs)}장 / val: {len(val_imgs)}장")
