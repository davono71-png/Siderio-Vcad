#!/usr/bin/env python3
"""SfM for the capture-app set (pycolmap 4.x, CPU SIFT).
All photos are the same ultrawide lens (2.2 mm, SM-F976B) stored in the same 4080x3060 sensor frame -> ONE shared
camera (images are NOT EXIF-rotated, see prep_images.py). DSP-SIFT+affine, exhaustive guided matching,
incremental mapping with several seeds (keep the model with most images) + GLOMAP global for comparison.
Usage: sfm.py WORKDIR [--reuse-db] [--model SIMPLE_RADIAL|RADIAL|OPENCV]"""
import sys, os, csv, shutil, time, argparse, pycolmap as p
p.set_random_seed(0)
ap = argparse.ArgumentParser(); ap.add_argument('wd'); ap.add_argument('--reuse-db', action='store_true')
ap.add_argument('--model', default='RADIAL'); ap.add_argument('--feat', type=int, default=12000); ap.add_argument('--seeds', type=int, default=4)
a = ap.parse_args(); wd = a.wd
img = os.path.join(wd, 'images'); db = os.path.join(wd, 'database.db')
rows = list(csv.DictReader(open(os.path.join(img, 'images.csv')))); names = [r['name'] for r in rows]
w, h = int(rows[0]['w']), int(rows[0]['h'])
f0 = 13 / 43.27 * (w * w + h * h) ** 0.5     # ~13 mm-equiv ultrawide prior
params = {'SIMPLE_RADIAL': f'{f0},{w/2},{h/2},0', 'RADIAL': f'{f0},{w/2},{h/2},0,0',
          'OPENCV': f'{f0},{f0},{w/2},{h/2},0,0,0,0'}[a.model]
t0 = time.time()
if not a.reuse_db:
    if os.path.exists(db): os.remove(db)
    eo = p.FeatureExtractionOptions(); eo.max_image_size = max(w, h); eo.num_threads = 6
    eo.sift.max_num_features = a.feat; eo.sift.peak_threshold = 0.004; eo.sift.estimate_affine_shape = True; eo.sift.domain_size_pooling = True
    ro = p.ImageReaderOptions(); ro.camera_model = a.model; ro.camera_params = params
    p.extract_features(db, img, image_names=names, camera_mode=p.CameraMode.SINGLE, reader_options=ro, extraction_options=eo, device=p.Device.cpu)
    t1 = time.time(); print(f'extract {t1 - t0:.1f}s', flush=True)
    mo = p.FeatureMatchingOptions(); mo.num_threads = 6; mo.guided_matching = True
    vo = p.TwoViewGeometryOptions(); vo.min_num_inliers = 15
    p.match_exhaustive(db, matching_options=mo, verification_options=vo, device=p.Device.cpu)
    t2 = time.time(); print(f'match {t2 - t1:.1f}s', flush=True)
    dbo = p.Database.open(db); cams = dbo.read_all_cameras()
    for c in cams: c.has_prior_focal_length = True; dbo.update_camera(c)
    dbo.close()

def report(recs, tag):
    for k, r in recs.items():
        reg = sorted(i.name[:3] for i in r.images.values())
        print(tag, k, 'reg', r.num_reg_images(), 'pts', r.num_points3D(), 'reproj %.3f px' % r.compute_mean_reprojection_error(),
              'track %.2f' % r.compute_mean_track_length(), 'missing', sorted(set(n[:3] for n in names) - set(reg)), flush=True)
t2 = time.time(); best = None
for seed in range(a.seeds):
    tmp = os.path.join(wd, f'sparse_seed{seed}'); shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    o = p.IncrementalPipelineOptions(); o.num_threads = 6; o.ba_refine_principal_point = False; o.min_num_matches = 15; o.multiple_models = True
    o.random_seed = seed
    m = o.mapper; m.init_min_tri_angle = 4; m.abs_pose_min_num_inliers = 15; m.abs_pose_min_inlier_ratio = 0.15; m.random_seed = seed
    recs = p.incremental_mapping(db, img, tmp, o); report(recs, f'INC seed{seed}')
    if recs:
        k = max(recs, key=lambda k: (recs[k].num_reg_images(), recs[k].num_points3D())); r = recs[k]
        score = (r.num_reg_images(), -r.compute_mean_reprojection_error())
        if best is None or score > best[0]: best = (score, seed, k)
    if best and best[0][0] == len(rows): break
out = os.path.join(wd, 'sparse'); shutil.rmtree(out, ignore_errors=True)
shutil.copytree(os.path.join(wd, f'sparse_seed{best[1]}', str(best[2])), os.path.join(out, '0'))
for seed in range(a.seeds): shutil.rmtree(os.path.join(wd, f'sparse_seed{seed}'), ignore_errors=True)
t3 = time.time(); print(f'incremental {t3 - t2:.1f}s; chosen seed {best[1]} model {best[2]} -> {out}/0')
r = p.Reconstruction(os.path.join(out, '0')); report({0: r}, 'CHOSEN')
for c in r.cameras.values(): print('camera', c.model, c.params)
