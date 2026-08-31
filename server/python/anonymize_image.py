#!/usr/bin/env python3
"""Local, network-free privacy masking for facade photographs."""

import argparse
import json
import sys
from itertools import product


def expanded_rect(x, y, width, height, image_width, image_height, margin=0.12):
    pad_x = max(4, int(width * margin))
    pad_y = max(4, int(height * margin))
    left = max(0, int(x) - pad_x)
    top = max(0, int(y) - pad_y)
    right = min(image_width, int(x + width) + pad_x)
    bottom = min(image_height, int(y + height) + pad_y)
    return left, top, right, bottom


def mask_rect(image, rect):
    left, top, right, bottom = rect
    if right > left and bottom > top:
        image[top:bottom, left:right] = (38, 38, 38)


def scaled_rectangles(rectangles, scale_x, scale_y, width, height):
    return [
        (
            max(0, int(left * scale_x)), max(0, int(top * scale_y)),
            min(width, int(right * scale_x)), min(height, int(bottom * scale_y)),
        )
        for left, top, right, bottom in rectangles
    ]


def detect_yunet(cv2, image, model_path, score_threshold):
    height, width = image.shape[:2]
    detector = cv2.FaceDetectorYN.create(model_path, "", (width, height), score_threshold, 0.3, 5000)
    detector.setInputSize((width, height))
    _, detections = detector.detect(image)
    if detections is None:
        return []
    return [expanded_rect(row[0], row[1], row[2], row[3], width, height) for row in detections]


def detect_plates(cv2, np, image, model_path, score_threshold=0.85):
    """OpenCV Zoo LPD-YuNet post-processing, kept local and network-free."""
    height, width = image.shape[:2]
    model = cv2.dnn.readNet(model_path)
    steps = [8, 16, 32, 64]
    min_sizes = [[10, 16, 24], [32, 48], [64, 96], [128, 192, 256]]
    feature_map_2 = [int(int((height + 1) / 2) / 2), int(int((width + 1) / 2) / 2)]
    feature_map_3 = [int(feature_map_2[0] / 2), int(feature_map_2[1] / 2)]
    feature_map_4 = [int(feature_map_3[0] / 2), int(feature_map_3[1] / 2)]
    feature_map_5 = [int(feature_map_4[0] / 2), int(feature_map_4[1] / 2)]
    feature_map_6 = [int(feature_map_5[0] / 2), int(feature_map_5[1] / 2)]
    priors = []
    for level, feature_map in enumerate([feature_map_3, feature_map_4, feature_map_5, feature_map_6]):
        for row, column in product(range(feature_map[0]), range(feature_map[1])):
            for minimum in min_sizes[level]:
                priors.append([
                    (column + 0.5) * steps[level] / width,
                    (row + 0.5) * steps[level] / height,
                    minimum / width,
                    minimum / height,
                ])
    priors = np.asarray(priors, dtype=np.float32)
    model.setInput(cv2.dnn.blobFromImage(image))
    location, confidence, iou = model.forward(["loc", "conf", "iou"])
    iou_scores = np.clip(iou[:, 0], 0.0, 1.0)
    scores = np.sqrt(confidence[:, 1] * iou_scores)
    scale = np.asarray([width, height], dtype=np.float32)
    corners = np.hstack((
        (priors[:, 0:2] + location[:, 4:6] * 0.1 * priors[:, 2:4]) * scale,
        (priors[:, 0:2] + location[:, 6:8] * 0.1 * priors[:, 2:4]) * scale,
        (priors[:, 0:2] + location[:, 10:12] * 0.1 * priors[:, 2:4]) * scale,
        (priors[:, 0:2] + location[:, 12:14] * 0.1 * priors[:, 2:4]) * scale,
    ))
    rectangles = []
    for corner_row, score in zip(corners, scores):
        if score < score_threshold:
            continue
        points = corner_row.reshape(4, 2).astype(np.int32)
        x, y, box_width, box_height = cv2.boundingRect(points)
        area_ratio = (box_width * box_height) / float(width * height)
        aspect_ratio = box_width / float(max(1, box_height))
        if area_ratio < 0.00002 or area_ratio > 0.05 or aspect_ratio < 1.2 or aspect_ratio > 8.0:
            continue
        rectangles.append(expanded_rect(x, y, box_width, box_height, width, height, 0.2))
    if not rectangles:
        return []
    boxes = [[left, top, right - left, bottom - top] for left, top, right, bottom in rectangles]
    kept = cv2.dnn.NMSBoxes(boxes, [1.0] * len(boxes), 0.1, 0.3, top_k=5000)
    return [rectangles[int(index)] for index in np.asarray(kept).reshape(-1)[:750]]


def detect_yolo_plates(cv2, np, ort, image, model_path, image_size=384, score_threshold=0.25):
    """Global YOLOv9 plate detector with local ONNX Runtime inference."""
    height, width = image.shape[:2]
    ratio = min(image_size / height, image_size / width)
    resized_width, resized_height = round(width * ratio), round(height * ratio)
    resized = cv2.resize(image, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)
    padding_x = (image_size - resized_width) / 2
    padding_y = (image_size - resized_height) / 2
    left, right = round(padding_x - 0.1), round(padding_x + 0.1)
    top, bottom = round(padding_y - 0.1), round(padding_y + 0.1)
    padded = cv2.copyMakeBorder(
        resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114),
    )
    tensor = np.expand_dims(padded.transpose((2, 0, 1))[::-1].astype(np.float32) / 255.0, 0)
    session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    predictions = np.asarray(session.run(None, {session.get_inputs()[0].name: tensor})[0]).reshape(-1, 7)
    rectangles = []
    for row in predictions:
        if float(row[6]) < score_threshold:
            continue
        x1 = (float(row[1]) - padding_x) / ratio
        y1 = (float(row[2]) - padding_y) / ratio
        x2 = (float(row[3]) - padding_x) / ratio
        y2 = (float(row[4]) - padding_y) / ratio
        box_width, box_height = x2 - x1, y2 - y1
        aspect_ratio = box_width / max(1.0, box_height)
        area_ratio = (box_width * box_height) / float(width * height)
        if 1.1 <= aspect_ratio <= 9.0 and 0.00001 <= area_ratio <= 0.08:
            rectangles.append(expanded_rect(x1, y1, box_width, box_height, width, height, 0.2))
    return rectangles


def detect_text(cv2, image, model_path):
    height, width = image.shape[:2]
    detector = cv2.dnn_TextDetectionModel_DB(model_path)
    detector.setBinaryThreshold(0.25)
    detector.setPolygonThreshold(0.45)
    detector.setUnclipRatio(2.0)
    detector.setMaxCandidates(2000)
    detector.setInputParams(1.0 / 255.0, (736, 736), (122.67891434, 116.66876762, 104.00698793), True)
    polygons, _ = detector.detect(image)
    rectangles = []
    if polygons is None:
        return rectangles
    for polygon in polygons:
        x, y, box_width, box_height = cv2.boundingRect(polygon)
        if box_width * box_height >= 24:
            rectangles.append(expanded_rect(x, y, box_width, box_height, width, height, 0.18))
    return rectangles


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--face-model", required=True)
    parser.add_argument("--text-model", required=True)
    parser.add_argument("--plate-model", required=True)
    parser.add_argument("--plate-yolo-model", required=True)
    args = parser.parse_args()

    try:
        import cv2
        import numpy as np
        import onnxruntime as ort

        raw = sys.stdin.buffer.read(25 * 1024 * 1024 + 1)
        if len(raw) < 16 or len(raw) > 25 * 1024 * 1024:
            raise ValueError("invalid input size")
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.ndim != 3:
            raise ValueError("image decode failed")

        original_height, original_width = image.shape[:2]
        longest_side = max(original_width, original_height)
        if longest_side > 1920:
            detection_scale = 1920.0 / longest_side
            detection_image = cv2.resize(
                image,
                (max(1, int(original_width * detection_scale)), max(1, int(original_height * detection_scale))),
                interpolation=cv2.INTER_AREA,
            )
        else:
            detection_image = image
        detection_height, detection_width = detection_image.shape[:2]
        scale_x = original_width / float(detection_width)
        scale_y = original_height / float(detection_height)

        face_rects = scaled_rectangles(
            detect_yunet(cv2, detection_image, args.face_model, 0.70),
            scale_x, scale_y, original_width, original_height,
        )
        text_rects = scaled_rectangles(
            detect_text(cv2, detection_image, args.text_model),
            scale_x, scale_y, original_width, original_height,
        )
        yunet_plate_rects = detect_plates(cv2, np, detection_image, args.plate_model, 0.85)
        yolo_plate_rects = detect_yolo_plates(cv2, np, ort, detection_image, args.plate_yolo_model)
        plate_rects = scaled_rectangles(
            yunet_plate_rects + yolo_plate_rects,
            scale_x, scale_y, original_width, original_height,
        )
        text_area_ratio = min(1.0, sum(
            max(0, right - left) * max(0, bottom - top)
            for left, top, right, bottom in text_rects
        ) / float(original_width * original_height))
        document_suspected = len(text_rects) >= 8 or text_area_ratio >= 0.08
        for rect in face_rects + text_rects + plate_rects:
            mask_rect(image, rect)

        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            raise RuntimeError("jpeg encode failed")
        report = {
            "version": "2026-08-31.1",
            "detectors": {"face": "ok", "text": "ok", "plate": "ok"},
            "regions": {
                "faces": len(face_rects), "text": len(text_rects), "plates": len(plate_rects),
                "plateDetectors": {
                    "yunet": len(yunet_plate_rects), "yoloV9": len(yolo_plate_rects),
                },
            },
            "document": {
                "suspected": document_suspected,
                "textAreaRatio": round(text_area_ratio, 6),
            },
            "detectionSize": {"width": detection_width, "height": detection_height},
        }
        print("ANONYMIZATION_REPORT=" + json.dumps(report, separators=(",", ":")), file=sys.stderr)
        sys.stdout.buffer.write(encoded.tobytes())
    except Exception as error:  # fail closed; never emit an image on failure
        print("ANONYMIZATION_ERROR=" + json.dumps({"type": type(error).__name__}), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
