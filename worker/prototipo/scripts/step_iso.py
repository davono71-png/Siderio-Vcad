#!/usr/bin/env python3
"""Iso/plan previews of the walls STL (tessellated STEP) with a tiny numpy z-buffer rasterizer
(flat shading + sharp edges; no GPU/OpenGL needed). Usage: step_iso.py STL OUT_PREFIX"""
import sys, numpy as np, trimesh
from PIL import Image
tm = trimesh.load(sys.argv[1]); pre = sys.argv[2]
Wpx, Hpx = 1200, 1000
Ld = np.array([0.45, -0.6, 0.75]); Ld /= np.linalg.norm(Ld)
fn = tm.face_normals; shade = 0.40 + 0.60 * np.clip(np.abs(fn @ Ld), 0, 1)
base = np.array([205, 210, 220.0])
sharp = tm.face_adjacency_angles > np.radians(20)
edges = tm.face_adjacency_edges[sharp]
lo, hi = tm.bounds; c = (lo + hi) / 2; diag = np.linalg.norm(hi - lo)

def view(eye_dir, up):
    f = -np.asarray(eye_dir, float); f /= np.linalg.norm(f)
    r = np.cross(f, up); r /= np.linalg.norm(r); u = np.cross(r, f)
    return np.stack([r, -u, f])  # orthographic camera rows: x right, y down, z depth

def render(R, name):
    V = (tm.vertices - c) @ R.T
    s = 0.88 * min(Wpx / np.ptp(V[:, 0]), Hpx / np.ptp(V[:, 1]))
    X = np.c_[V[:, 0] * s + Wpx / 2, V[:, 1] * s + Hpx / 2, V[:, 2]]
    img = np.full((Hpx, Wpx, 3), 255.0); zb = np.full((Hpx, Wpx), np.inf)
    for fi, tri in enumerate(tm.faces):
        P = X[tri]; x0, y0 = np.floor(P[:, :2].min(0)).astype(int); x1, y1 = np.ceil(P[:, :2].max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, Wpx - 1), min(y1, Hpx - 1)
        if x1 < x0 or y1 < y0: continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = P
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12: continue
        w0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den; w1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den; w2 = 1 - w0 - w1
        ins = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6); z = w0 * az + w1 * bz + w2 * cz
        sub = zb[y0:y1 + 1, x0:x1 + 1]; upd = ins & (z < sub)
        sub[upd] = z[upd]; img[y0:y1 + 1, x0:x1 + 1][upd] = base * shade[fi]
    for a, b in edges:  # depth-tested edge lines
        pa, pb = X[a], X[b]; n = int(np.hypot(*(pb[:2] - pa[:2]))) * 2 + 2
        t = np.linspace(0, 1, n)[:, None]; q = pa + (pb - pa) * t
        xi = np.clip(q[:, 0].astype(int), 0, Wpx - 1); yi = np.clip(q[:, 1].astype(int), 0, Hpx - 1)
        vis = q[:, 2] <= zb[yi, xi] + 0.01 * diag
        for dx in (0, 1):
            for dy in (0, 1):
                img[np.clip(yi[vis] + dy, 0, Hpx - 1), np.clip(xi[vis] + dx, 0, Wpx - 1)] = (40, 40, 55)
    Image.fromarray(img.astype(np.uint8)).save(f'{pre}_{name}.png'); print('wrote', f'{pre}_{name}.png', flush=True)

render(view([1.0, -1.25, 1.1], [0, 0, 1]), 'iso')
render(view([-1.0, 1.25, 1.1], [0, 0, 1]), 'iso_back')
render(view([0, 0, 1.0], [0, 1, 0]), 'plan_top')
