#!/usr/bin/env python3
"""Triangulate the app's named points from the SfM poses and compute a least-squares scale (mm per model unit).
App coords: rawX/rawY = pixels of the stored JPEG (no EXIF rotation) == frame used by COLMAP here, divided by FACTOR.
Usage: scale_points.py PROJECT_JSON SPARSE_DIR IMAGES_CSV OUT_JSON [--mesh MESH_PLY (model units, COLMAP frame) for 1-view fallback]"""
import sys, json, csv, argparse, numpy as np, pycolmap as p
ap = argparse.ArgumentParser(); ap.add_argument('proj'); ap.add_argument('sparse'); ap.add_argument('csv'); ap.add_argument('out')
ap.add_argument('--mesh', default=None); a = ap.parse_args()
proj = json.load(open(a.proj)); rec = p.Reconstruction(a.sparse)
rows = {r['photoId']: r for r in csv.DictReader(open(a.csv))}
byname = {im.name: im for im in rec.images.values()}

def ray(pid, o):
    r = rows[pid]; im = byname.get(r['name'])
    if im is None: return None
    fac = float(r['factor']); cam = rec.cameras[im.camera_id]
    uv = np.array([o['rawX'] / fac, o['rawY'] / fac])       # COLMAP pixel convention: top-left corner = (0,0), same as app
    xn = np.asarray(cam.cam_from_img(uv)).ravel()[:2]        # undistorted normalised coords
    T = im.cam_from_world(); R = T.rotation.matrix(); t = np.asarray(T.translation)
    C = -R.T @ t; d = R.T @ np.array([xn[0], xn[1], 1.0]); d /= np.linalg.norm(d)
    return dict(name=r['name'], C=C, d=d, R=R, t=t, cam=cam, uv=uv)

def reproj(X, rr):
    xc = rr['R'] @ X + rr['t']
    if xc[2] <= 0: return float('inf')
    px = np.asarray(rr['cam'].img_from_cam(xc)).ravel()[:2]
    return float(np.linalg.norm(px - rr['uv']))

def triangulate(rs):   # midpoint / least squares closest point to all rays
    A = np.zeros((3, 3)); b = np.zeros(3)
    for r in rs: P = np.eye(3) - np.outer(r['d'], r['d']); A += P; b += P @ r['C']
    X = np.linalg.solve(A, b)
    from scipy.optimize import least_squares
    def res(X): return np.concatenate([ (lambda xc: np.asarray(r['cam'].img_from_cam(xc)).ravel()[:2] - r['uv'])(r['R'] @ X + r['t']) for r in rs])
    X = least_squares(res, X).x
    ang = max(np.degrees(np.arccos(np.clip(abs(r1['d'] @ r2['d']), -1, 1))) for i, r1 in enumerate(rs) for r2 in rs[i + 1:]) if len(rs) > 1 else 0
    # ray-gap at the solution (perpendicular distances)
    gaps = [float(np.linalg.norm((X - r['C']) - ((X - r['C']) @ r['d']) * r['d'])) for r in rs]
    return X, float(ang), gaps

mesh_scene = None
if a.mesh:
    import open3d as o3d
    m = o3d.io.read_triangle_mesh(a.mesh); mesh_scene = o3d.t.geometry.RaycastingScene(); mesh_scene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(m))

pts = {}; report_pts = []
for pt in proj['points']:
    rs = [ray(o['photoId'], o) for o in pt['observations']]
    used = [r for r in rs if r is not None]
    info = dict(label=pt['label'], n_obs=len(rs), n_registered=len(used), photos=[rows[o['photoId']]['name'] for o in pt['observations']],
                unregistered=[rows[o['photoId']]['name'] for o, r in zip(pt['observations'], rs) if r is None])
    if len(used) >= 2:
        X, ang, gaps = triangulate(used)
        info.update(method='triangulated', X=X.tolist(), tri_angle_deg=round(ang, 2), reproj_px=[round(reproj(X, r), 2) for r in used],
                    ray_gap_mu=[round(g, 4) for g in gaps], depth_mu=[round(float(np.linalg.norm(X - r['C'])), 3) for r in used])
        pts[pt['label']] = X
    elif len(used) == 1 and mesh_scene is not None:
        r = used[0]; import open3d as o3d
        hit = mesh_scene.cast_rays(o3d.core.Tensor([[*r['C'], *r['d']]], dtype=o3d.core.Dtype.Float32))['t_hit'].numpy()[0]
        if np.isfinite(hit):
            X = r['C'] + hit * r['d']; pts[pt['label']] = X; info.update(method='single view: ray x mesh', X=X.tolist(), depth_mu=float(hit))
        else: info.update(method='single view: ray missed mesh')
    else: info.update(method='not usable (%d registered observations)' % len(used))
    report_pts.append(info)

# measurements (deduplicate identical pairs/values)
seen = set(); meas = []
for m in proj['measurements']:
    key = (frozenset([m['labelA'], m['labelB']]), m['distanceMm'])
    dup = key in seen; seen.add(key)
    meas.append(dict(pair=f"{m['labelA']}-{m['labelB']}", mm=m['distanceMm'], note=m['note'], duplicate=dup,
                     d_mu=float(np.linalg.norm(pts[m['labelA']] - pts[m['labelB']])) if m['labelA'] in pts and m['labelB'] in pts else None))
use = [m for m in meas if not m['duplicate'] and m['d_mu']]
d = np.array([m['d_mu'] for m in use]); D = np.array([m['mm'] for m in use], float)
s_abs = float(d @ D / (d @ d))                              # min sum (s d - D)^2
s_rel = float(np.sum(d / D) / np.sum((d / D) ** 2))          # min sum ((s d - D)/D)^2
for m in meas:
    if m['d_mu']:
        m['model_mm'] = round(m['d_mu'] * s_abs, 1); m['resid_mm'] = round(m['d_mu'] * s_abs - m['mm'], 1); m['resid_pct'] = round(100 * (m['d_mu'] * s_abs - m['mm']) / m['mm'], 2)
        m['scale_from_this_alone'] = round(m['mm'] / m['d_mu'], 3)
loo = []
for i in range(len(use)):
    k = [j for j in range(len(use)) if j != i]; si = d[k] @ D[k] / (d[k] @ d[k]); loo.append(dict(left_out=use[i]['pair'], scale=round(float(si), 3), pred_mm=round(float(d[i] * si), 1), err_mm=round(float(d[i] * si - D[i]), 1)))
rms = float(np.sqrt(np.mean((s_abs * d - D) ** 2)))
res = dict(mm_per_unit=s_abs, mm_per_unit_relative_ls=s_rel, rms_resid_mm=rms, n_used=len(use), measurements=meas, leave_one_out=loo,
           points=report_pts, points_mm_colmap_frame={k: (v * s_abs).tolist() for k, v in pts.items()})
json.dump(res, open(a.out, 'w'), indent=1)
print(json.dumps(dict(s=s_abs, s_rel=s_rel, rms=rms), indent=1))
for q in report_pts: print(q['label'], q['method'], q.get('tri_angle_deg'), q.get('reproj_px'), q['unregistered'])
for m in meas: print(m)
for l in loo: print('LOO', l)

# --- Monte-Carlo: click noise sigma = 2 px full-res (app clicks) -> std of each measured distance in mm
rng = np.random.default_rng(0); sig = 2.0
obs = {pt['label']: [(o['photoId'], o) for o in pt['observations']] for pt in proj['points']}
mc = {m['pair']: [] for m in use}
for _ in range(300):
    Xs = {}
    for lab, ol in obs.items():
        rs = []
        for pid, o in ol:
            o2 = dict(o, rawX=o['rawX'] + rng.normal(0, sig), rawY=o['rawY'] + rng.normal(0, sig)); rr = ray(pid, o2)
            if rr is not None: rs.append(rr)
        if len(rs) >= 2: Xs[lab] = triangulate(rs)[0]
    for m in use:
        a_, b_ = m['pair'].split('-')
        if a_ in Xs and b_ in Xs: mc[m['pair']].append(np.linalg.norm(Xs[a_] - Xs[b_]) * s_abs)
res['monte_carlo_click_noise_2px_std_mm'] = {k: round(float(np.std(v)), 1) for k, v in mc.items()}
json.dump(res, open(a.out, 'w'), indent=1); print('MC std mm', res['monte_carlo_click_noise_2px_std_mm'])
