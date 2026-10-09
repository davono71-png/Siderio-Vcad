"""Downscale JPEGs without applying EXIF orientation, so one lens stays one COLMAP camera."""

from __future__ import annotations

import csv
import os

from PIL import Image


def _focal_px(image: Image.Image, width: int, height: int):
    exif = image.getexif()
    focal_35 = exif.get(41989)  # FocalLengthIn35mmFilm
    if focal_35:
        try:
            return float(focal_35) / 36.0 * max(width, height)
        except (TypeError, ValueError):
            return None
    return None


def prepare_images(project: dict, photo_paths: dict, work_dir: str, factor: int):
    """photo_paths maps photo id -> local JPEG path. Returns the csv path and rows."""
    out_dir = os.path.join(work_dir, "images")
    os.makedirs(out_dir, exist_ok=True)
    photos = [p for p in project.get("photos") or [] if p.get("accepted", True)]
    photos.sort(key=lambda p: int(p.get("sequence") or 0))
    rows = []
    warnings = []
    for index, photo in enumerate(photos, start=1):
        path = photo_paths.get(photo["id"])
        if not path or not os.path.isfile(path):
            warnings.append(f"foto assente: {photo.get('id')}")
            continue
        seq = int(photo.get("sequence") or index)
        name = f"{seq:03d}.jpg"
        # Keep names unique if two photos share a sequence.
        if any(row["name"] == name for row in rows):
            name = f"{seq:03d}-{photo['id'][:8]}.jpg"
        with Image.open(path) as image:
            image = image.convert("RGB")
            expected = (int(photo["width"]), int(photo["height"])) if photo.get("width") and photo.get("height") else None
            if expected and image.size != expected:
                warnings.append(f"{name}: JPEG {image.size[0]}x{image.size[1]}, project.json {expected[0]}x{expected[1]}")
            focal = _focal_px(image, image.width, image.height)
            use = max(1, int(factor))
            if min(image.width, image.height) // use < 320:
                use = 1
            resized = image.resize((image.width // use, image.height // use), Image.Resampling.LANCZOS)
            resized.save(os.path.join(out_dir, name), quality=92)
        rows.append(
            {
                "name": name,
                "photoId": photo["id"],
                "seq": seq,
                "orient": photo.get("exifOrientation") or 1,
                "w": resized.width,
                "h": resized.height,
                "factor": use,
                "focalPx": "" if focal is None else f"{focal / use:.4f}",
                "fullW": image.width,
                "fullH": image.height,
            }
        )
    if not rows:
        raise RuntimeError("Nessuna foto accettata da preparare.")
    csv_path = os.path.join(out_dir, "images.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return {"csv": csv_path, "dir": out_dir, "rows": rows, "warnings": warnings, "factor": factor}


def load_rows(csv_path: str) -> list[dict]:
    with open(csv_path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))
