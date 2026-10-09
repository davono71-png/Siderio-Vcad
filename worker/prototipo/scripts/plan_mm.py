#!/usr/bin/env python3
"""Plan view in mm: dense-cloud density (wall band 15-90% H), simplified walls, door, camera positions, app points.
Usage: plan_mm.py OUT_DIR WORK_DIR"""
import sys, json, numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Rectangle
out, wd = sys.argv[1:3]
r = json.load(open(f'{out}/room_mm.json')); s = r['mm_per_unit']; L, W, H = (r['dims'][k] for k in ('length_x', 'width_y', 'height_z'))
T = np.array(r['transform_colmap_to_room_mm']); t = 150
import os
if not os.path.exists(f'{wd}/aligned_pts.npy'):
    import open3d as o3d; Tm = np.array(json.load(open(f'{out}/room.json'))['transform_colmap_to_room'])
    q = np.asarray(o3d.io.read_point_cloud(f'{wd}/mvs/scene_dense.ply').voxel_down_sample(0.02).points); np.save(f'{wd}/aligned_pts.npy', (q @ Tm[:3, :3].T + Tm[:3, 3]).astype(np.float32))
P = np.load(f'{wd}/aligned_pts.npy') * s
det = r['detection']; cams = np.array(det['cameras_room_frame_mm']) if 'cameras_room_frame_mm' in det else np.array(det['cameras_room_frame']) * s
sc = json.load(open(f'{wd}/scale_sparse_ext.json'))
fig, ax = plt.subplots(figsize=(11, 10))
ax.add_patch(Polygon([[-t, -t], [L + t, -t], [L + t, W + t], [-t, W + t]], closed=True, fc='#c9cfd8', ec='k'))
ax.add_patch(Polygon([[0, 0], [L, 0], [L, W], [0, W]], closed=True, fc='white', ec='k'))
m = (P[:, 2] > 0.15 * H) & (P[:, 2] < 0.9 * H)
ax.hist2d(P[m, 0], P[m, 1], bins=[np.arange(-400, L + 400, 15), np.arange(-400, W + 400, 15)], cmap='Greys', vmax=25, cmin=1, alpha=0.8)
for o in r['openings']:
    ax.add_patch(Rectangle((o['u0'], W), o['u1'] - o['u0'], t, fc='#e07b39'))
    ax.text((o['u0'] + o['u1']) / 2, W + t + 60, f"door {o['width']:.0f} x {o['height']:.0f}", ha='center', color='#e07b39')
ax.plot(cams[:, 0], cams[:, 1], 'r^', ms=6, label=f'photo positions ({len(cams)})')
for q in sc['points']:
    X = T[:3, :3] @ np.array(q['X']) + T[:3, 3]; ax.plot(X[0], X[1], 'bo', ms=5); ax.text(X[0] + 30, X[1] - 90, q['label'], color='b', fontsize=10)
ax.annotate('', (0, W * 0.45), (L, W * 0.45), arrowprops=dict(arrowstyle='<->', color='g')); ax.text(L / 2, W * 0.45 + 40, f'Lx = {L:.0f} mm', ha='center', color='g', fontsize=12)
ax.annotate('', (L * 0.55, 0), (L * 0.55, W), arrowprops=dict(arrowstyle='<->', color='g')); ax.text(L * 0.55 + 40, W * 0.3, f'Wy = {W:.0f} mm', rotation=90, color='g', fontsize=12)
ax.text(60, 120, f'H (floor-ceiling) = {H:.0f} mm\nscale {s:.2f} mm/unit from 4 app measurements', fontsize=10)
for lab, x, y, rot in [('S - window (curtains)', L / 2, -t / 2, 0), ('N - painting + door', L * 0.3, W + t / 2, 0), ('W - wardrobe + bed head', -t / 2, W / 2, 90), ('E - desk + shelves', L + t / 2, W / 2, 90)]:
    ax.text(x, y, lab, ha='center', va='center', fontsize=8, rotation=rot)
ax.set_aspect('equal'); ax.set_xlim(-450, L + 450); ax.set_ylim(-450, W + 450); ax.grid(alpha=0.3); ax.legend(loc='lower right')
ax.set_title('Plan (Z up, floor Z=0) - grey = dense points 15-90% of height, mm'); plt.tight_layout(); plt.savefig(f'{out}/preview_plan_mm.png', dpi=100)
print('ok')
