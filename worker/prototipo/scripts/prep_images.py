#!/usr/bin/env python3
"""Prepare images for SfM: keep the RAW sensor frame of each JPEG (NO EXIF rotation applied -> all 53 photos share
one 4080x3060 sensor geometry = one COLMAP camera), downscale by integer factor, drop EXIF orientation.
Writes WORK/images/<NNN>.jpg + images.csv (name, photoId, exifOrientation, scale).
App coordinates: rawX/rawY (stored-JPEG pixels) -> colmap = raw/FACTOR (pixel-corner convention identical)."""
import sys, os, json, csv
from PIL import Image
src, wd, fac = sys.argv[1], sys.argv[2], int(sys.argv[3])
proj = json.load(open(os.path.join(src, 'project.json')))
od = os.path.join(wd, 'images'); os.makedirs(od, exist_ok=True)
rows = []
for p in proj['photos']:
    fn = os.path.basename(p['file']); im = Image.open(os.path.join(src, p['file']))
    assert im.size == (p['width'], p['height']), (fn, im.size)
    sm = im.resize((im.width // fac, im.height // fac), Image.LANCZOS)
    sm.save(os.path.join(od, fn), quality=95)       # no exif -> no orientation tag
    rows.append(dict(name=fn, photoId=p['id'], seq=p['sequence'], orient=p['exifOrientation'], w=sm.width, h=sm.height, factor=fac))
with open(os.path.join(od, 'images.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, rows[0].keys()); w.writeheader(); w.writerows(rows)
print(len(rows), 'images ->', od)
