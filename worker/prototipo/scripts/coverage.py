#!/usr/bin/env python3
"""Coverage of the 6 room surfaces by the dense cloud (mm, room frame). 100 mm cells on each plane:
'surface' = dense points within +-60 mm of the plane; 'surface or object' = any point within 0..700 mm in front.
Usage: coverage.py DENSE_MM_PLY ROOM_MM_JSON [label]"""
import sys, json, numpy as np, open3d as o3d
pc = o3d.io.read_point_cloud(sys.argv[1]).voxel_down_sample(10.0); P = np.asarray(pc.points)
r = json.load(open(sys.argv[2])); L, W, H = (r['dims'][k] for k in ('length_x', 'width_y', 'height_z')); cell = 100
surf = {  # name: (normal axis, plane value, inward sign, (u axis, umax), (v axis, vmax))
    'floor': (2, 0, +1, (0, L), (1, W)), 'ceiling': (2, H, -1, (0, L), (1, W)),
    'S wall (y=0)': (1, 0, +1, (0, L), (2, H)), 'N wall (y=W)': (1, W, -1, (0, L), (2, H)),
    'W wall (x=0)': (0, 0, +1, (1, W), (2, H)), 'E wall (x=L)': (0, L, -1, (1, W), (2, H))}
res = {}
for k, (ax, val, sg, (ua, um), (va, vm)) in surf.items():
    d = (P[:, ax] - val) * sg
    nu, nv = int(np.ceil(um / cell)), int(np.ceil(vm / cell))
    def cov(m):
        iu = np.clip((P[m, ua] / cell).astype(int), 0, nu - 1); iv = np.clip((P[m, va] / cell).astype(int), 0, nv - 1)
        inb = (P[m, ua] >= 0) & (P[m, ua] <= um) & (P[m, va] >= 0) & (P[m, va] <= vm)
        g = np.zeros((nu, nv), bool); g[iu[inb], iv[inb]] = True; return g.mean()
    res[k] = dict(surface_pct=round(100 * cov(np.abs(d) < 60), 1), surface_or_object_pct=round(100 * cov((d > -60) & (d < 700)), 1))
tot = np.mean([v['surface_pct'] for v in res.values()])
print(json.dumps(dict(label=sys.argv[3] if len(sys.argv) > 3 else '', n_points_10mm_voxel=len(P), per_surface=res, mean_surface_pct=round(tot, 1)), indent=1))
