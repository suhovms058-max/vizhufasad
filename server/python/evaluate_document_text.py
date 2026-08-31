#!/usr/bin/env python3
"""Evaluate masking of word boxes in a local FUNSD-compatible document set."""

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
    parser.add_argument("--dataset", required=True, help="FUNSD split with images/ and annotations/")
    parser.add_argument("--anonymizer", required=True)
    parser.add_argument("--face-model", required=True)
    parser.add_argument("--text-model", required=True)
    parser.add_argument("--plate-model", required=True)
    parser.add_argument("--plate-yolo-model", required=True)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--seed", type=int, default=20260831)
    parser.add_argument("--box-mask-threshold", type=float, default=0.85)
    parser.add_argument("--mask-color-tolerance", type=int, default=18)
    parser.add_argument("--minimum-word-recall", type=float, default=0.98)
    parser.add_argument("--minimum-document-recall", type=float, default=1.0)
    parser.add_argument("--timeout", type=int, default=35)
    parser.add_argument("--report")
    return parser.parse_args()


def pairs(dataset):
    result = []
    for annotation in sorted((dataset / "annotations").glob("*.json")):
        image = dataset / "images" / f"{annotation.stem}.png"
        if image.exists():
            result.append((image, annotation))
    return result


def word_boxes(annotation_path):
    document = json.loads(annotation_path.read_text(encoding="utf-8"))
    result = []
    for entity in document.get("form", []):
        for word in entity.get("words", []):
            text = str(word.get("text", "")).strip()
            box = word.get("box")
            if text and isinstance(box, list) and len(box) == 4:
                left, top, right, bottom = map(int, box)
                if right > left and bottom > top:
                    result.append((left, top, right, bottom))
    return result


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
    diagnostic = completed.stderr.decode("utf-8", errors="replace")
    report_line = next((line for line in diagnostic.splitlines()
                        if line.startswith("ANONYMIZATION_REPORT=")), None)
    if not report_line:
        raise RuntimeError("anonymizer report missing")
    return completed.stdout, json.loads(report_line.split("=", 1)[1])


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
        raise SystemExit("no paired FUNSD images and annotations")
    random.Random(args.seed).shuffle(available)
    selected = available[:min(args.limit, len(available))]

    failures = []
    total_words = 0
    masked_words = 0
    processed_images = 0
    process_errors = 0
    suspected_documents = 0
    durations = []
    tick_frequency = cv2.getTickFrequency()

    for image_path, annotation_path in selected:
        boxes = word_boxes(annotation_path)
        if not boxes:
            continue
        started = cv2.getTickCount()
        try:
            sanitized_bytes, anonymization_report = run_anonymizer(args, image_path.read_bytes())
            sanitized = cv2.imdecode(np.frombuffer(sanitized_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
            if sanitized is None:
                raise RuntimeError("invalid sanitized image")
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            process_errors += 1
            failures.append({"image": image_path.name, "reason": type(error).__name__})
            continue
        durations.append((cv2.getTickCount() - started) / tick_frequency)
        processed_images += 1
        if anonymization_report.get("document", {}).get("suspected") is True:
            suspected_documents += 1
        for box in boxes:
            total_words += 1
            masked = mask_fraction(sanitized, box, args.mask_color_tolerance)
            if masked >= args.box_mask_threshold:
                masked_words += 1
            else:
                failures.append({
                    "image": image_path.name, "box": box, "maskFraction": round(masked, 4),
                })

    recall = masked_words / total_words if total_words else 0.0
    durations.sort()
    percentile = lambda fraction: durations[min(len(durations) - 1, int((len(durations) - 1) * fraction))] if durations else None
    report = {
        "dataset": str(dataset),
        "seed": args.seed,
        "selectedImages": len(selected),
        "processedImages": processed_images,
        "processErrors": process_errors,
        "suspectedDocuments": suspected_documents,
        "documentDetectionRecall": round(suspected_documents / processed_images, 4) if processed_images else 0.0,
        "groundTruthWords": total_words,
        "maskedWords": masked_words,
        "wordRecall": round(recall, 4),
        "boxMaskThreshold": args.box_mask_threshold,
        "maskColorTolerance": args.mask_color_tolerance,
        "minimumWordRecall": args.minimum_word_recall,
        "minimumDocumentRecall": args.minimum_document_recall,
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
    document_recall = suspected_documents / processed_images if processed_images else 0.0
    accepted = (
        process_errors == 0
        and total_words > 0
        and recall >= args.minimum_word_recall
        and document_recall >= args.minimum_document_recall
    )
    return 0 if accepted else 1


if __name__ == "__main__":
    raise SystemExit(main())
