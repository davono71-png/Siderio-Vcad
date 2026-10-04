#!/usr/bin/env python3
"""Level + Manhattan-align the dense cloud, detect floor/ceiling/walls/openings, write room.json.

Usage: room_planes.py --cloud work/mvs/scene_dense.ply --cams work/incA.npz --out out/room.json [--config room_config.json]

Frame convention of all outputs: Z up, floor at Z=0, walls parallel to X/Y, origin at room's (xmin,ymin) corner.
Units: arbitrary SfM "model units" (mu). rescale.py turns them into millimetres.

Steps
 1. voxel-downsample, outlier removal, normals oriented towards the mean camera centre (inside the room)
 2. up vector: start from mean camera 'image-up' (phone held upright), refine = principal axis of near-vertical normals
 3. yaw: circular mean of 4*theta of horizontal normals (Manhattan world assumption)
 4. Open3D iterative RANSAC planes (reported + used to snap), and oriented-normal histograms per side
    (+X/-X/+Y/-Y/up/down) -> candidate planes; per side pick outermost candidate that has enough support and
    vertical extent and is not implausibly far beyond the dominant plane (rejects corridor seen through door)
 5. openings: points *outside* the room box are ray-cast from the camera centres onto the wall they were seen
    through; dense clusters in (u,z) on a wall -> door/window bounding boxes.
 Overrides: room_config.json may fix any of xmin,xmax,ymin,ymax,floor,ceiling (in the aligned, pre-origin frame).
"""
import argparse, json, numpy as np, open3d as o3d
o3d.utility.random.seed(0); np.random.seed(0)
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument('--cloud', required=True); ap.add_argument('--cams', required=True)
ap.add_argument('--out', required=True); ap.add_argument('--config', default=None)
ap.add_argument('--voxel', type=float, default=None)
ap.add_argument('--tu', type=float, default=1.0, help='threshold unit: all length thresholds (tuned for ~124 mm/unit) are multiplied by this')
a = ap.parse_args()
cfg = json.load(open(a.config)) if a.config else {}
TU = a.tu; a.voxel = a.voxel or 0.06 * TU

cams = np.load(a.cams); Rc = cams['R']; Cc = cams['C']
pc = o3d.io.read_point_cloud(a.cloud)
pcd = pc.voxel_down_sample(a.voxel); pcd, _ = pcd.remove_statistical_outlier(20, 2.0)
pcd.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=a.voxel * 7, max_nn=40))
cm = Cc.mean(0); pcd.orient_normals_towards_camera_location(cm)
P = np.asarray(pcd.points); N = np.asarray(pcd.normals); COL = np.asarray(pcd.colors)

# --- 2. up
if 'UP' in cams.files: up = cams['UP'] / np.linalg.norm(cams['UP'])   # gravity prior from the phone sensors (capture app)
else: up = -Rc[:, 1, :].mean(0); up /= np.linalg.norm(up)       # fallback: mean image-up (upright portrait photos)
up_prior = up.copy()
for _ in range(4):
    m = np.abs(N @ up) > np.cos(np.radians(20)); w, v = np.linalg.eigh(N[m].T @ N[m]); u = v[:, -1]; up = u * np.sign(u @ up)
# --- 3. yaw
hz = np.abs(N @ up) < np.sin(np.radians(15)); Nh = N[hz] - np.outer(N[hz] @ up, up)
e1 = np.cross(up, [1, 0, 0]); e1 /= np.linalg.norm(e1); e2 = np.cross(up, e1)
th = np.arctan2(Nh @ e2, Nh @ e1); zz = np.exp(4j * th).mean(); yaw = np.angle(zz) / 4
ex = np.cos(yaw) * e1 + np.sin(yaw) * e2; ey = np.cross(up, ex); Ra = np.stack([ex, ey, up])
Q = (P - cm) @ Ra.T; NQ = N @ Ra.T; CQ = (Cc - cm) @ Ra.T

# --- 4a. Open3D RANSAC planes (for the report / sanity)
ransac = []
rest = o3d.geometry.PointCloud(); rest.points = o3d.utility.Vector3dVector(Q)
for i in range(14):
    if len(rest.points) < 2000: break
    model, inl = rest.segment_plane(distance_threshold=0.12 * TU, ransac_n=3, num_iterations=2000)
    n = np.array(model[:3]); d = model[3]; k = int(np.argmax(np.abs(n))); s = np.sign(n[k])
    ang = np.degrees(np.arccos(min(1, abs(n[k]))))
    ransac.append(dict(normal=(n * s).round(4).tolist(), axis='xyz'[k], offset=float(-d * s / abs(n[k])), inliers=len(inl), off_axis_deg=round(float(ang), 2)))
    rest = rest.select_by_index(inl, invert=True)

# --- 4b. per-side candidates from oriented-normal histograms
def candidates(ax, sign, binw=None):
    binw = binw or 0.1 * TU
    m = (NQ[:, ax] * sign) > 0.9          # normal points into the room
    v = Q[m, ax]
    if len(v) < 50: return [], m
    bins = np.arange(v.min() - binw, v.max() + 2 * binw, binw); h, e = np.histogram(v, bins); c = (e[:-1] + e[1:]) / 2
    hs = ndimage.uniform_filter1d(h.astype(float), 3)
    pk = [i for i in range(1, len(hs) - 1) if hs[i] >= hs[i - 1] and hs[i] >= hs[i + 1] and hs[i] > 0]
    out = []
    for i in pk:
        sel = m & (np.abs(Q[:, ax] - c[i]) < 0.25 * TU)
        zr = np.percentile(Q[sel, 2], [2, 98]); o = 1 - ax if ax < 2 else 0
        ur = np.percentile(Q[sel, o], [2, 98]) if ax < 2 else np.percentile(Q[sel, 0], [2, 98])
        out.append(dict(pos=float(c[i]), support=int(sel.sum()), zext=float(zr[1] - zr[0]), uext=float(ur[1] - ur[0])))
    return out, m

def pick(cands, sign, H, span, dominant=None):
    if not cands: return None
    mx = max(c['support'] for c in cands); dom = max(cands, key=lambda c: c['support'])['pos'] if dominant is None else dominant
    ok = [c for c in cands if c['support'] >= max(300, 0.05 * mx) and (H is None or c['zext'] >= 0.35 * H)
          and sign * (dom - c['pos']) <= 0.35 * span + 1e-9]
    if not ok: return dom
    return min(ok, key=lambda c: sign * c['pos'])['pos']   # outermost (sign=+1 -> min coordinate)

cf, _ = candidates(2, +1); cc, _ = candidates(2, -1)
# floor: lowest strong upward-facing plane; ceiling: highest strong downward-facing
def strong(c, frac=0.3):
    mx = max(x['support'] for x in c); return [x for x in c if x['support'] >= frac * mx]
floor = cfg.get('floor', min(x['pos'] for x in strong(cf)))
ceil = cfg.get('ceiling', max(x['pos'] for x in strong(cc)))
H = ceil - floor
side = {}
cxm, _ = candidates(0, +1); cxp, _ = candidates(0, -1); cym, _ = candidates(1, +1); cyp, _ = candidates(1, -1)
dom = lambda c: max(c, key=lambda q: q['support'])['pos']
spanx = dom(cxp) - dom(cxm); spany = dom(cyp) - dom(cym)
side['xmin'] = cfg.get('xmin', pick(cxm, +1, H, spanx)); side['xmax'] = cfg.get('xmax', pick(cxp, -1, H, spanx))
side['ymin'] = cfg.get('ymin', pick(cym, +1, H, spany)); side['ymax'] = cfg.get('ymax', pick(cyp, -1, H, spany))
# snap to RANSAC plane offsets if one is within 0.15 mu (RANSAC fit is less quantised than the histogram)
for k, ax in [('xmin', 'x'), ('xmax', 'x'), ('ymin', 'y'), ('ymax', 'y')]:
    near = [r for r in ransac if r['axis'] == ax and r['off_axis_deg'] < 5 and abs(r['offset'] - side[k]) < 0.15 * TU]
    if near and k not in cfg: side[k] = max(near, key=lambda r: r['inliers'])['offset']
for k, ax in [('floor', 'z'), ('ceiling', 'z')]:
    v = floor if k == 'floor' else ceil
    near = [r for r in ransac if r['axis'] == ax and r['off_axis_deg'] < 5 and abs(r['offset'] - v) < 0.15 * TU]
    if near and k not in cfg:
        if k == 'floor': floor = max(near, key=lambda r: r['inliers'])['offset']
        else: ceil = max(near, key=lambda r: r['inliers'])['offset']
H = ceil - floor
x0, x1, y0, y1 = side['xmin'], side['xmax'], side['ymin'], side['ymax']

# --- 5. openings by ray casting outside points onto walls
walls = {  # name: (axis, value, along-axis, along-range)
    'S_ymin': (1, y0, 0, (x0, x1)), 'N_ymax': (1, y1, 0, (x0, x1)),
    'W_xmin': (0, x0, 1, (y0, y1)), 'E_xmax': (0, x1, 1, (y0, y1))}
margin = 0.5 * TU
inside_z = (Q[:, 2] > floor + 0.1 * TU) & (Q[:, 2] < ceil - 0.1 * TU)
out_mask = inside_z & ((Q[:, 0] < x0 - margin) | (Q[:, 0] > x1 + margin) | (Q[:, 1] < y0 - margin) | (Q[:, 1] > y1 + margin))
O = Q[out_mask]; eye = CQ.mean(0)
hits = {k: [] for k in walls}
for p in O:
    dvec = p - eye; best = None
    for k, (ax, val, al, (lo, hi)) in walls.items():
        if abs(dvec[ax]) < 1e-9: continue
        t = (val - eye[ax]) / dvec[ax]
        if 0 < t < 1:
            hp = eye + t * dvec
            if lo <= hp[al] <= hi and floor <= hp[2] <= ceil and (best is None or t < best[0]): best = (t, k, hp[al], hp[2])
    if best: hits[best[1]].append((best[2], best[3]))
openings = []
cell = 0.25 * TU
for k, pts in hits.items():
    if len(pts) < 200: continue
    ax, val, al, (lo, hi) = walls[k]; pts = np.array(pts)
    gu = np.arange(lo, hi + cell, cell); gz = np.arange(floor, ceil + cell, cell)
    h, _, _ = np.histogram2d(pts[:, 0], pts[:, 1], [gu, gz])
    occ = ndimage.binary_closing(h >= 3, iterations=2); lab, n = ndimage.label(occ)
    for i in range(1, n + 1):
        cells = np.argwhere(lab == i)
        if len(cells) < 40: continue
        sel = np.isin(lab, [i]); cnt = h[sel].sum()
        u0, u1 = gu[cells[:, 0].min()], gu[cells[:, 0].max() + 1]; z0, z1 = gz[cells[:, 1].min()], gz[cells[:, 1].max() + 1]
        w, hh = u1 - u0, z1 - z0
        if w < 0.1 * min(x1 - x0, y1 - y0) or hh < 0.25 * H: continue
        kind = 'door' if (z0 - floor) < 0.08 * H and hh < 0.9 * H else ('window/french-window' if (z0 - floor) < 0.08 * H else 'window')
        if kind == 'door': z0 = floor  # door openings start at the floor
        openings.append(dict(wall=k, kind_guess=kind, u0=float(u0), u1=float(u1), z0=float(z0), z1=float(z1), n_points=int(cnt)))

# --- 5b. window candidates: bright, low-saturation points (back-lit curtains / glass) hugging a wall
import matplotlib.colors as mcol
hsv = mcol.rgb_to_hsv(np.clip(COL, 0, 1))
bright = (hsv[:, 2] > 0.85) & (hsv[:, 1] < 0.2) & inside_z
for k, (ax, val, al, (lo, hi)) in walls.items():
    m = bright & (np.abs(Q[:, ax] - val) < 1.0 * TU) & (Q[:, al] > lo) & (Q[:, al] < hi)
    if m.sum() < 300: continue
    gu = np.arange(lo, hi + cell, cell); gz = np.arange(floor, ceil + cell, cell)
    h, _, _ = np.histogram2d(Q[m, al], Q[m, 2], [gu, gz])
    occ = ndimage.binary_closing(h >= 2, iterations=2); lab, n = ndimage.label(occ)
    if n == 0: continue
    sizes = ndimage.sum(occ, lab, range(1, n + 1)); i = int(np.argmax(sizes)) + 1
    if sizes[i - 1] < 40: continue
    cells = np.argwhere(lab == i)
    u0, u1 = gu[cells[:, 0].min()], gu[cells[:, 0].max() + 1]; z0, z1 = gz[cells[:, 1].min()], gz[cells[:, 1].max() + 1]
    ov = [o for o in openings if o['wall'] == k and not (u1 < o['u0'] or u0 > o['u1'])]
    if ov:  # merge with the ray-cast opening (glass seen between curtains) -> union box
        o = ov[0]
        if o['kind_guess'].startswith('door'): continue
        o.update(u0=float(min(o['u0'], u0)), u1=float(max(o['u1'], u1)), z0=float(min(o['z0'], z0)), z1=float(max(o['z1'], z1)),
                 kind_guess='window (approx.: union of see-through area + bright curtain area)')
        continue
    openings.append(dict(wall=k, kind_guess='window (low confidence: bright curtain region, extent approximate)',
                         u0=float(u0), u1=float(u1), z0=float(z0), z1=float(z1), n_points=int(m.sum())))

# keep only the largest window candidate per wall (others -> rejected_openings, usually glimpses through gaps)
rejected = []
for k in walls:
    ws = [o for o in openings if o['wall'] == k and not o['kind_guess'].startswith('door')]
    if len(ws) > 1:
        keep = max(ws, key=lambda o: (o['u1'] - o['u0']) * (o['z1'] - o['z0']))
        for o in ws:
            if o is not keep: openings.remove(o); rejected.append(o)

# --- shift so floor z=0 and room corner at origin
shift = np.array([-x0, -y0, -floor])
T = np.eye(4); T[:3, :3] = Ra; T[:3, 3] = -Ra @ cm + shift  # aligned = T @ colmap
L, Wd = x1 - x0, y1 - y0
for o in openings + rejected:
    ax, val, al, (lo, hi) = walls[o['wall']]
    off = -x0 if al == 0 else -y0
    o.update(u0=round(o['u0'] + off, 3), u1=round(o['u1'] + off, 3), z0=round(o['z0'] - floor, 3), z1=round(o['z1'] - floor, 3),
             width=round(o['u1'] - o['u0'], 3), height=round(o['z1'] - o['z0'], 3))
room = dict(
    units='model units (arbitrary, SfM scale)', mm_per_unit=None,
    transform_colmap_to_room=T.tolist(),
    convention='Z up, floor Z=0, room interior = [0,Lx]x[0,Ly]x[0,H]; walls: S=y0, N=y=Ly, W=x0, E=x=Lx',
    floor_polygon=[[0, 0], [L, 0], [L, Wd], [0, Wd]],
    dims=dict(length_x=round(L, 4), width_y=round(Wd, 4), height_z=round(H, 4)),
    ratios=dict(x_over_y=round(L / Wd, 4), x_over_h=round(L / H, 4), y_over_h=round(Wd / H, 4),
                normalised_h1=[round(L / H, 3), round(Wd / H, 3), 1.0]),
    walls={'S_ymin': dict(length=round(L, 4), plane='y=0'), 'N_ymax': dict(length=round(L, 4), plane=f'y={Wd:.4f}'),
           'W_xmin': dict(length=round(Wd, 4), plane='x=0'), 'E_xmax': dict(length=round(Wd, 4), plane=f'x={L:.4f}')},
    openings=openings, rejected_openings=rejected,
    detection=dict(up=up.round(5).tolist(), up_prior=up_prior.round(5).tolist(), up_vs_prior_deg=round(float(np.degrees(np.arccos(min(1, abs(up @ up_prior))))), 2), yaw_deg=round(float(np.degrees(yaw)), 3), manhattan_strength=round(float(abs(zz)), 3),
                   raw_planes=dict(floor=floor, ceiling=ceil, **side), overrides=cfg,
                   candidates=dict(xmin=cxm, xmax=cxp, ymin=cym, ymax=cyp, floor=cf, ceiling=cc), ransac_planes=ransac,
                   n_points_used=int(len(P)), cameras_room_frame=(CQ + shift).round(3).tolist()))
json.dump(room, open(a.out, 'w'), indent=1)
print(json.dumps(dict(dims=room['dims'], ratios=room['ratios'], openings=openings, raw=room['detection']['raw_planes'],
                      yaw=room['detection']['yaw_deg'], ms=room['detection']['manhattan_strength']), indent=1))
print('RANSAC planes:'); [print('  ', r) for r in ransac]
