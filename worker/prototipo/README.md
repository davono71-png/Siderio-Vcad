# foto3d-test2: Stanza test, 53 photos from the capture app (Siderio Vcad), CPU only

Input: `Stanza-test.zip` -> `foto/001..053.jpg` + `project.json` (photo id -> `photos[].file`, 7 points, 5 measurements).
Reuses the venv and OpenMVS of `../foto3d-test` (nothing there was modified). Pipeline: `./run_pipeline.sh` (about 20 min).

## Results (mm, Z up, floor Z=0, X = W->E, Y = S->N)
| item | value |
|---|---|
| registered | 53/53 (51 strict + 005/013 with relaxed abs-pose thresholds), reproj 1.05 px @2040, 17 237 pts, track 3.53 |
| scale | 233.856 mm/unit, LS over A-B 730, E-F 930, F-G 625 (duplicate entry counted once), H-I 2105. Residuals -5.1 / +5.3 / -0.4 / -0.5 mm (max 0.71 %), RMS 3.7 mm |
| room interior | **Lx 3150 x Wy 2837 x H 2681 mm** (floor area 8.94 m2). Wy to the curtain plane: about 2743 |
| door (N wall) | clear opening about **769 x 2098 mm** (+-20 mm in width), 2189 mm from the W corner; outside of the architraves about 947 mm |
| check vs old test | H 2681 vs 2690 (tape) -0.3 %; Lx 3150 vs 3159 -0.3 %; Wy 2837 vs 2712: the old S wall was the curtain plane (2743 here, +1.1 %) |

## Files
* `out/` deliverables: `room_textured_mm_obj/` (OBJ+MTL+8k PNG), `room_textured_mm.glb` (4k texture, mm), `room_mesh_vcolor_mm.ply`,
  `room_dense_cloud_mm.ply`, `walls_mm.step` (+`.stl`; walls 150 mm + floor/ceiling slabs 150 mm + door cut), `room_mm.json`, `room.json` (model units),
  `scale_report.md/.json`, `diagnostic.md`, `preview_*.png`, `previews_overview.jpg`.
* `scripts/`: `prep_images.py` (raw sensor frame, /2), `sfm.py`, `pose_check.py` (SfM vs phone orientation), `export_sparse.py` (+gravity prior),
  `scale_points.py` (triangulation + LS scale + Monte-Carlo), `room_planes.py` (old script + `--tu` threshold unit + gravity prior),
  `walls_cad.py` (+`--ceiling-slab`), `export_meshes.py`, `render_mm.py`, `plan_mm.py`, `coverage.py`, `step_iso.py`.
* `room_config.json`: wall planes fixed manually (aligned pre-origin frame). Auto-detection picked the wardrobe front (W) and the painting (N). The values are medians of the dense points:
  W wall above the bed, N wall beside the painting and the door (agree within 4 mm), E wall at y 0.5-7.5, S wall strip at the E corner (also supported by the floor/ceiling extent).
* `work/`: images, `database.db`, `sparse/0` (51), `sparse_ext` (53, used for scale), `sparse_dense` (52, no 005, used for MVS), `mvs/`, logs, `timings.txt`.

## Key decisions
* Images were **not** EXIF-rotated: all 53 come from the same 4080x3060 ultrawide sensor, so there is 1 shared camera. App `rawX/rawY` / 2 = COLMAP pixels.
* RADIAL camera model, exhaustive guided matching, DSP-SIFT (12k features). The sequential app capture with walking gave enough parallax.
* `room_planes.py` thresholds were tuned for about 124 mm/unit; this model is about 234 mm/unit, so `--tu 0.53`.

## Timings (8 vCPU, no GPU)
prep 27 s · features 100 s · exhaustive matching 268 s · mapping 4 seeds 104 s (+4 s extension) · undistort 5 s · DensifyPointCloud 410 s ·
ReconstructMesh 89 s · TextureMesh 128 s · planes 20 s · mm export 44 s · renders ~25 s. Compute about 20 min. Wall clock including analysis and reporting: 17:35-18:05 CEST (about 30 min).
