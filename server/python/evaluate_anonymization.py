#!/usr/bin/env python3
"""Evaluate fail-closed masking against a local YOLO-labelled image set."""

import argparse
import json
import random
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, help="Directory containing images/ and labels/")
    parser.add_argument("--anonymizer", required=True)
    parser.add_argument("--face-model", required=True)
    parser.add_argument("--text-model", required=True)
    parser.add_argument("--plate-model", required=True)
    parser.add_argument("--plate-yolo-model", required=True)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--seed", type=int, default=20260831)
    parser.add_argument("--box-mask-threshold", type=float, default=0.85)
    parser.add_argument("--mask-color-tolerance", type=int, default=18)
    parser.add_argument("--minimum-recall", type=float, default=0.98)
    parser.add_argument("--timeout", type=int, default=35)
    parser.add_argument("--report")
    return parser.parse_args()


def pairs(dataset):
    image_dir = dataset / "images"
    label_dir = dataset / "labels"
    result = []
    for label in sorted(label_dir.glob("*.txt")):
        image = next((candidate for suffix in (".jpg", ".jpeg", ".png", ".bmp", ".webp")
                      if (candidate := image_dir / f"{label.stem}{suffix}").exists()), None)
        if image:
            result.append((image, label))
    return result


def yolo_boxes(label_path, width, height):
    boxes = []
    for line in label_path.read_text(encoding="utf-8").splitlines():
        values = line.split()
        if len(values) < 5:
            continue
        _, center_x, center_y, box_width, box_height = map(float, values[:5])
        left = max(0, int((center_x - box_width / 2) * width))
        top = max(0, int((center_y - box_height / 2) * height))
        right = min(width, int((center_x + box_width / 2) * width))
        bottom = min(height, int((center_y + box_height / 2) * height))
        if right > left and bottom > top:
            boxes.append((left, top, right, bottom))
    return boxes


def run_anonymizer(args, image_bytes):
    command = [
        sys.executable, args.anonymizer,
        "--face-model", args.face_model,
        "--text-model", args.text_model,
        "--plate-model", args.plate_model,
        "--plate-yolo-model", args.plate_yolo_model,
    ]
    completed = subprocess.run(
        command, input=image_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=args.timeout, check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"anonymizer exit {completed.returncode}")
    return completed.stdout


def changed_fraction(original, sanitized, box):
    left, top, right, bottom = box
    before = original[top:bottom, left:right].astype(np.int16)
    after = sanitized[top:bottom, left:right].astype(np.int16)
    if before.size == 0 or before.shape != after.shape:
        return 0.0
    difference = np.mean(np.abs(before - after), axis=2)
    return float(np.mean(difference >= 20.0))


def mask_fraction(sanitized, box, tolerance):
    left, top, right, bottom = box
    region = sanitized[top:bottom, left:right].astype(np.int16)
    if region.size == 0:
        return 0.0
    distance = np.max(np.abs(region - 38), axis=2)
    return float(np.mean(distance <= tolerance))


def main():
    args = arguments()
    dataset = Path(args.dataset)
    available = pairs(dataset)
    if not available:
        raise SystemExit("no paired images and YOLO labels")
    random.Random(args.seed).shuffle(available)
    selected = available[:min(args.limit, len(available))]

    failures = []
    total_boxes = 0
    masked_boxes = 0
    processed_images = 0
    process_errors = 0
    durations = []
    tick_frequency = cv2.getTickFrequency()

    for image_path, label_path in selected:
        original = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if original is None:
            process_errors += 1
            failures.append({"image": image_path.name, "reason": "decode"})
            continue
        height, width = original.shape[:2]
        boxes = yolo_boxes(label_path, width, height)
        if not boxes:
            continue
        started = cv2.getTickCount()
        try:
            sanitized_bytes = run_anonymizer(args, image_path.read_bytes())
            sanitized = cv2.imdecode(np.frombuffer(sanitized_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
            if sanitized is None or sanitized.shape != original.shape:
                raise RuntimeError("invalid sanitized image")
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            process_errors += 1
            failures.append({"image": image_path.name, "reason": type(error).__name__})
            continue
        durations.append((cv2.getTickCount() - started) / tick_frequency)
        processed_images += 1
        for box in boxes:
            total_boxes += 1
            changed = changed_fraction(original, sanitized, box)
            masked = mask_fraction(sanitized, box, args.mask_color_tolerance)
            if masked >= args.box_mask_threshold:
                masked_boxes += 1
            else:
                failures.append({
                    "image": image_path.name, "box": box,
                    "maskFraction": round(masked, 4), "changedFraction": round(changed, 4),
                })

    recall = masked_boxes / total_boxes if total_boxes else 0.0
    durations.sort()
    percentile = lambda fraction: durations[min(len(durations) - 1, int((len(durations) - 1) * fraction))] if durations else None
    report = {
        "dataset": str(dataset),
        "seed": args.seed,
        "selectedImages": len(selected),
        "processedImages": processed_images,
        "processErrors": process_errors,
        "groundTruthBoxes": total_boxes,
        "maskedBoxes": masked_boxes,
        "recall": round(recall, 4),
        "boxMaskThreshold": args.box_mask_threshold,
        "maskColorTolerance": args.mask_color_tolerance,
        "minimumRecall": args.minimum_recall,
        "seconds": {
            "p50": round(percentile(0.50), 3) if durations else None,
            "p95": round(percentile(0.95), 3) if durations else None,
            "max": round(max(durations), 3) if durations else None,
        },
        "failures": failures[:100],
    }
    output = json.dumps(report, ensure_ascii=False, indent=2)
    print(output)
    if args.report:
        Path(args.report).write_text(output + "\n", encoding="utf-8")
    return 0 if process_errors == 0 and total_boxes > 0 and recall >= args.minimum_recall else 1


if __name__ == "__main__":
    raise SystemExit(main())
