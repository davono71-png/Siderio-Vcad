#!/usr/bin/env python3
"""Cross-check SfM camera rotations with the phone orientation sensors recorded by the capture app
(direction = viewing vector in East/North/Up). Robust Kabsch fit COLMAP->ENU; per-image angular error; elevation error
(gravity is reliable indoors, compass is not). Saves R_colmap_to_enu.npy (gravity prior for room_planes.py).
Usage: pose_check.py PROJECT_JSON SPARSE_DIR OUT_DIR"""
import sys, json, numpy as np, pycolmap as p
proj = json.load(open(sys.argv[1])); r = p.Reconstruction(sys.argv[2]); od = sys.argv[3]
dirs = {q['file'].split('/')[-1]: np.array([q['direction']['east'], q['direction']['north'], q['direction']['up']]) for q in proj['photos']}
names, A, B = [], [], []
for im in r.images.values():
    R = im.cam_from_world().rotation.matrix(); names.append(im.name); A.append(R.T @ [0, 0, 1]); B.append(dirs[im.name])
A, B = np.array(A), np.array(B)
def kabsch(A, B):
    U, S, Vt = np.linalg.svd(B.T @ A); D = np.diag([1, 1, np.sign(np.linalg.det(U @ Vt))]); return U @ D @ Vt
Rw = kabsch(A, B)
for _ in range(3):
    err = np.degrees(np.arccos(np.clip(np.sum((A @ Rw.T) * B, 1), -1, 1))); m = err < np.percentile(err, 75) + 5; Rw = kabsch(A[m], B[m])
err = np.degrees(np.arccos(np.clip(np.sum((A @ Rw.T) * B, 1), -1, 1)))
el_s = np.degrees(np.arcsin(np.clip((A @ Rw.T)[:, 2], -1, 1))); el_a = np.degrees(np.arcsin(np.clip(B[:, 2], -1, 1)))
np.save(f'{od}/R_colmap_to_enu.npy', Rw)
res = dict(median_dir_err_deg=float(np.median(err)), median_elev_err_deg=float(np.median(abs(el_s - el_a))),
           per_image={n: dict(dir_err=round(float(e), 1), elev_sfm=round(float(a), 1), elev_app=round(float(b), 1)) for n, e, a, b in zip(names, err, el_s, el_a)})
json.dump(res, open(f'{od}/pose_check.json', 'w'), indent=1)
print('median dir err %.1f deg, median elevation err %.1f deg' % (res['median_dir_err_deg'], res['median_elev_err_deg']))
for n in sorted(names):
    q = res['per_image'][n]
    if q['dir_err'] > 15 or abs(q['elev_sfm'] - q['elev_app']) > 5: print('  check', n, q)
