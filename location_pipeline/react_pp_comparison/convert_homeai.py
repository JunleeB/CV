# -*- coding: utf-8 -*-
"""v4 GT locations + YOLO labels -> SGG coco-format (HomeAI dataset).

Output: datasets/HomeAI/coco_format/{train,val,test}/_annotations.coco.json
        + image symlinks in each split dir.
Predicates: on / in hand / wearing.
"on the floor" objects get no relation (inference: no relation => floor).
"""
import json
import os
import glob
import collections
from PIL import Image

V4 = os.environ.get("V4_DATASET_DIR", "./homeai_yolo_v4/dataset")
OUT_ROOT = os.environ.get("SGG_OUT_DIR", "./SGG-Benchmark/datasets/HomeAI/coco_format")

CLASSES = ["smartphone", "wallet", "eyeglasses", "white remote", "black remote",
           "watch", "sofa", "table", "bed", "chair", "nightstand", "person"]
FURN = {"sofa", "table", "bed", "chair", "nightstand"}
PREDICATES = ["on", "in hand", "wearing"]

# location -> (predicate, target class candidates in priority order)
LOC_MAP = {
    "on the sofa": ("on", ["sofa"]),
    "on the table": ("on", ["table"]),
    "on the bed": ("on", ["bed"]),
    "on the chair": ("on", ["chair"]),
    "on the nightstand": ("on", ["nightstand"]),
    "on the vanity table": ("on", ["table", "nightstand"]),
    "in hand": ("in hand", ["person"]),
    "on the wrist": ("wearing", ["person"]),
    "on the face": ("wearing", ["person"]),
}


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    i = max(0, x2 - x1) * max(0, y2 - y1)
    u = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - i
    return i / u if u > 0 else 0


def pick_furniture(obj_box, cands):
    """지지 가구 선택: 객체 bottom-center 포함 > 교집합/객체면적 > 최근접."""
    cx, by = (obj_box[0] + obj_box[2]) / 2, obj_box[3]
    scored = []
    for j, b in cands:
        contains = b[0] <= cx <= b[2] and b[1] <= by <= b[3]
        ix = max(0, min(obj_box[2], b[2]) - max(obj_box[0], b[0]))
        iy = max(0, min(obj_box[3], b[3]) - max(obj_box[1], b[1]))
        inter_ratio = (ix * iy) / max(1e-6, (obj_box[2]-obj_box[0]) * (obj_box[3]-obj_box[1]))
        bcx, bcy = (b[0]+b[2])/2, (b[1]+b[3])/2
        dist = ((cx-bcx)**2 + (by-bcy)**2) ** 0.5
        scored.append((contains, inter_ratio, -dist, j))
    scored.sort(reverse=True)
    top = scored[0]
    if not top[0] and top[1] < 0.1:
        return None  # 후보가 있어도 기하적으로 안 붙어있으면 포기
    return top[3]


def nearest_person(obj_box, cands):
    cx, cy = (obj_box[0]+obj_box[2])/2, (obj_box[1]+obj_box[3])/2
    best, bj = None, None
    for j, b in cands:
        d = ((cx-(b[0]+b[2])/2)**2 + (cy-(b[1]+b[3])/2)**2) ** 0.5
        if best is None or d < best:
            best, bj = d, j
    return bj


# basename -> (img path, label path)
index = {}
for src in ["airbnb", "etri", "mh"]:
    for p in glob.glob(os.path.join(V4, src, "images", "*.jpg")):
        bn = os.path.basename(p)
        index[bn] = (p, os.path.join(V4, src, "labels", bn[:-4] + ".txt"))

for split in ["train", "val", "test"]:
    out_dir = os.path.join(OUT_ROOT, split)
    os.makedirs(out_dir, exist_ok=True)
    images, annotations, rels = [], [], []
    skip = collections.Counter()
    img_id = ann_id = rel_id = 0

    for line in open(os.path.join(V4, "gt_locations", f"{split}.jsonl")):
        rec = json.loads(line)
        bn = rec["file_name"]
        if bn not in index:
            skip["no_image"] += 1
            continue
        img_path, lbl_path = index[bn]
        if not os.path.exists(lbl_path):
            skip["no_label"] += 1
            continue
        with Image.open(img_path) as im:
            W, H = im.size

        # YOLO 라벨 -> ann (박스는 xyxy로 들고 있다가 저장 시 xywh)
        frame_anns = []
        for l in open(lbl_path):
            parts = l.split()
            if len(parts) < 5:
                continue
            c = int(parts[0])
            cx, cy, w, h = (float(v) for v in parts[1:5])
            x1, y1 = (cx - w/2) * W, (cy - h/2) * H
            x2, y2 = (cx + w/2) * W, (cy + h/2) * H
            frame_anns.append({"cat": c, "box": [x1, y1, x2, y2]})

        frame_rels = []
        for o in rec["objects"]:
            loc = o["location"]
            if loc == "on the floor":
                skip["floor_no_rel"] += 1
                continue
            if loc not in LOC_MAP:
                skip[f"unknown_loc:{loc}"] += 1
                continue
            gt_box = [float(v) for v in o["bbox_2d"]]
            gt_cat = CLASSES.index(o["object"]) if o["object"] in CLASSES else None
            if gt_cat is None:
                skip[f"unknown_cls:{o['object']}"] += 1
                continue
            # GT 객체 <-> 라벨 박스 매칭
            best, bj = 0.4, None
            for j, a in enumerate(frame_anns):
                if a["cat"] != gt_cat:
                    continue
                ov = iou(gt_box, a["box"])
                if ov >= best:
                    best, bj = ov, j
            if bj is None:
                skip["obj_unmatched"] += 1
                continue
            pred, tgt_classes = LOC_MAP[loc]
            tj = None
            for tc in tgt_classes:
                tci = CLASSES.index(tc)
                cands = [(j, a["box"]) for j, a in enumerate(frame_anns)
                         if a["cat"] == tci and j != bj]
                if not cands:
                    continue
                tj = (nearest_person(frame_anns[bj]["box"], cands) if tc == "person"
                      else pick_furniture(frame_anns[bj]["box"], cands))
                if tj is not None:
                    break
            if tj is None:
                skip[f"no_target:{loc}"] += 1
                continue
            frame_rels.append((bj, tj, PREDICATES.index(pred) + 1))

        if not frame_rels:
            skip["frame_no_rels"] += 1
            continue

        images.append({"id": img_id, "file_name": bn, "width": W, "height": H})
        base = ann_id
        for a in frame_anns:
            x1, y1, x2, y2 = a["box"]
            annotations.append({"id": ann_id, "image_id": img_id,
                                "category_id": a["cat"] + 1,
                                "bbox": [round(x1, 1), round(y1, 1),
                                         round(x2 - x1, 1), round(y2 - y1, 1)],
                                "area": round((x2-x1) * (y2-y1), 1),
                                "iscrowd": 0, "segmentation": []})
            ann_id += 1
        seen = set()
        for s, t, p in frame_rels:
            if (s, t, p) in seen:
                continue
            seen.add((s, t, p))
            rels.append({"id": rel_id, "image_id": img_id,
                         "subject_id": base + s, "object_id": base + t,
                         "predicate_id": p})
            rel_id += 1
        dst = os.path.join(out_dir, bn)
        if not os.path.lexists(dst):
            os.symlink(img_path, dst)
        img_id += 1

    out = {"images": images, "annotations": annotations, "rel_annotations": rels,
           "categories": [{"id": i + 1, "name": n, "supercategory": "none"}
                          for i, n in enumerate(CLASSES)],
           "rel_categories": [{"id": i + 1, "name": n, "supercategory": "none"}
                              for i, n in enumerate(PREDICATES)]}
    with open(os.path.join(out_dir, "_annotations.coco.json"), "w") as f:
        json.dump(out, f)
    print(f"[{split}] images={len(images)} anns={len(annotations)} rels={len(rels)}")
    for k, v in skip.most_common():
        print(f"   skip {k}: {v}")
