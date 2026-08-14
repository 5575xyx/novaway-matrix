#!/usr/bin/env python3
"""模板预览与生成结果预览的视觉基准对比工具。"""

import argparse
import json
import math
from pathlib import Path

from PIL import Image


def image_rmse(left: Image.Image, right: Image.Image) -> float:
    left = left.convert("RGB").resize((1280, 720))
    right = right.convert("RGB").resize((1280, 720))
    pixels_a = list(left.getdata())
    pixels_b = list(right.getdata())
    total = 0
    for a, b in zip(pixels_a, pixels_b):
        total += (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
    return math.sqrt(total / (len(pixels_a) * 3))


def dhash_distance(left: Image.Image, right: Image.Image) -> int:
    small_left = left.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    small_right = right.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    bits = 0
    for y in range(8):
        for x in range(8):
            a = small_left.getpixel((x, y)) > small_left.getpixel((x + 1, y))
            b = small_right.getpixel((x, y)) > small_right.getpixel((x + 1, y))
            bits = (bits << 1) | (a != b)
    return bits.bit_count()


def compare_directories(template_dir: Path, generated_dir: Path, allow_partial: bool = False) -> dict:
    results = {}
    for template_file in sorted(template_dir.glob("*.jpg")):
        generated_file = generated_dir / template_file.name
        if not generated_file.exists():
            results[template_file.name] = {
                "status": "skipped" if allow_partial else "missing",
                "rmse": None,
                "dhash": None,
            }
            continue
        template_image = Image.open(template_file)
        generated_image = Image.open(generated_file)
        results[template_file.name] = {
            "status": "ok",
            "rmse": round(image_rmse(template_image, generated_image), 4),
            "dhash": dhash_distance(template_image, generated_image),
        }
    scores = [item for item in results.values() if item["status"] == "ok"]
    return {
        "files": results,
        "summary": {
            "total": len(results),
            "ok": len(scores),
            "missing": sum(1 for item in results.values() if item["status"] == "missing"),
            "skipped": sum(1 for item in results.values() if item["status"] == "skipped"),
            "avg_rmse": round(sum(item["rmse"] or 0 for item in scores) / len(scores), 4) if scores else None,
            "avg_dhash": round(sum(item["dhash"] or 0 for item in scores) / len(scores), 2) if scores else None,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template-dir", required=True)
    parser.add_argument("--generated-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-rmse", type=float, default=45.0)
    parser.add_argument("--max-dhash", type=int, default=12)
    parser.add_argument("--allow-partial", action="store_true")
    args = parser.parse_args()
    result = compare_directories(Path(args.template_dir), Path(args.generated_dir), args.allow_partial)
    summary = result["summary"]
    summary["accepted"] = (
        (args.allow_partial or summary["missing"] == 0)
        and summary["avg_rmse"] is not None
        and summary["avg_rmse"] <= args.max_rmse
        and summary["avg_dhash"] is not None
        and summary["avg_dhash"] <= args.max_dhash
    )
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    if not summary["accepted"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
