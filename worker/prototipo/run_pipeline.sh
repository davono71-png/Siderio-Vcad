#!/usr/bin/env bash
# foto3d-test2: 53 capture-app photos -> SfM -> OpenMVS -> planes -> mm outputs (scale from app measurements)
# Reuses ../foto3d-test/.venv and ../foto3d-test/tools/openmvs-install. ~20 min on 8 vCPU, no GPU.
set -euo pipefail
cd "$(dirname "$0")"
source ../foto3d-test/.venv/bin/activate
export PATH=/workspace/foto3d-test/tools/openmvs-install/bin/OpenMVS:$PATH
WD=$PWD/work; OUT=$PWD/out; M=$WD/mvs; mkdir -p $WD $OUT; : > $WD/timings.txt
T() { local t0=$(date +%s); "$@"; echo "[time] $(( $(date +%s)-t0 ))s : $*" | tee -a "$WD/timings.txt"; }
T python scripts/prep_images.py . $WD 2                              # raw sensor frame (no EXIF rotation), 2040x1530
T python scripts/sfm.py $WD 2>&1 | grep -vE '^[IW][0-9]{8}' | tee $WD/sfm.log   # 51/53 strict
# register the remaining images with relaxed absolute-pose thresholds (-> 53/53, 005/013 weak)
T python - <<'PY'
import pycolmap as p, os
o = p.IncrementalPipelineOptions(); o.num_threads = 6; o.ba_refine_principal_point = False; o.min_num_matches = 10; o.multiple_models = False
m = o.mapper; m.abs_pose_min_num_inliers = 8; m.abs_pose_min_inlier_ratio = 0.08; m.abs_pose_max_error = 16; m.filter_max_reproj_error = 4
os.makedirs('work/sparse_ext', exist_ok=True)
r = p.incremental_mapping('work/database.db', 'work/images', 'work/sparse_ext', o, input_path='work/sparse/0')
r = p.Reconstruction('work/sparse_ext') if not r else r[0]; print('extended', r.num_reg_images())
r = p.Reconstruction('work/sparse_ext')
im = [i for i in r.images.values() if i.name == '005.jpg']
if im: r.deregister_frame(im[0].frame_id)            # 005: only 14 points, pose 6.5 deg off the phone gravity -> not used for MVS
os.makedirs('work/sparse_dense', exist_ok=True); r.write('work/sparse_dense')
PY
python scripts/pose_check.py project.json $WD/sparse_ext $WD
python scripts/export_sparse.py $WD/sparse_dense $WD/sparse_dense.npz $WD/R_colmap_to_enu.npy
python scripts/scale_points.py project.json $WD/sparse_ext $WD/images/images.csv $OUT/scale_report.json | tee $WD/scale.log
rm -rf $WD/dense; mkdir -p $M
T python -c "import pycolmap as p; p.undistort_images('$WD/dense','$WD/sparse_dense','$WD/images',output_type='COLMAP',num_threads=4); r=p.Reconstruction('$WD/dense/sparse'); r.write_text('$WD/dense/sparse')"
T InterfaceCOLMAP -i $WD/dense -o $M/scene.mvs --image-folder $WD/dense/images -w $M > $M/log_interface.txt 2>&1
T DensifyPointCloud -i $M/scene.mvs -o $M/scene_dense.mvs -w $M --resolution-level 1 --max-threads 6 --number-views-fuse 2 --estimate-roi 0 > $M/log_densify.txt 2>&1
T ReconstructMesh -i $M/scene_dense.mvs -o $M/scene_mesh.mvs -w $M --max-threads 6 > $M/log_mesh.txt 2>&1
T TextureMesh -i $M/scene_dense.mvs -m $M/scene_mesh.ply -o $M/scene_textured.mvs -w $M --max-threads 6 --export-type ply --decimate 0.5 --empty-color 12632256 > $M/log_tex.txt 2>&1
# planes; thresholds scaled to this model's unit (--tu 0.53 ~ 124/234 mm per unit); walls fixed in room_config.json
# (auto-pick took the wardrobe front as W wall and the painting plane as N wall; values measured from the cloud, see README)
T python scripts/room_planes.py --cloud $M/scene_dense.ply --cams $WD/sparse_dense.npz --out $OUT/room.json --tu 0.53 --config room_config.json
python - <<'PY'   # door: replace auto ray-cast box with opening measured from the N-wall point gap + app point H
import json; r = json.load(open('out/room.json')); r['rejected_openings'] += r['openings']
d = dict(wall='N_ymax', kind_guess='door (opening measured from the gap in the N-wall points + app points H/I)', u0=9.36, u1=12.65, z0=0.0, z1=8.973)
d.update(width=round(d['u1'] - d['u0'], 3), height=d['z1']); r['openings'] = [d]; json.dump(r, open('out/room.json', 'w'), indent=1)
PY
S=$(python -c "import json;print(json.load(open('out/scale_report.json'))['mm_per_unit'])")
T python rescale.py --mm-per-unit $S --thickness-mm 150
python scripts/walls_cad.py $OUT/room.json $OUT/walls_mm.step --mm-per-unit $S --thickness 150 --floor-slab 150 --ceiling-slab 150
python scripts/walls_cad.py $OUT/room.json $WD/walls_open_top_mm.step --mm-per-unit $S --thickness 150 --floor-slab 150
python scripts/render_mm.py $OUT 2>&1 | grep -vE '^(FEngine|Vulkan|Selected|Backend)|WARNING' || true
python scripts/step_iso.py $WD/walls_open_top_mm.stl $WD/preview_walls
python scripts/plan_mm.py $OUT $WD    # needs work/aligned_pts.npy (see README)
python scripts/coverage.py $OUT/room_dense_cloud_mm.ply $OUT/room_mm.json new53 > $WD/coverage_new.json
echo done
