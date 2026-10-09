#!/usr/bin/env python3
"""Rescale the room reconstruction from arbitrary model units to millimetres.

Give ONE known real distance; the scale factor (mm per model unit) is derived and every output is
re-exported in mm under out/mm/ (room_mm.json, textured OBJ/GLB, vertex-colour PLY, dense cloud, STEP walls).

Examples
  python rescale.py --ceiling-height-mm 2700
  python rescale.py --wall-length-mm 3150 --wall S        # S/N = along X (length_x), W/E = along Y (width_y)
  python rescale.py --length-x-mm 3150                    # same as wall S/N
  python rescale.py --width-y-mm 2750                     # same as wall W/E
  python rescale.py --door-height-mm 2100                 # uses detected door opening (opening #0 of kind door)
  python rescale.py --door-width-mm 800
  python rescale.py --points 1.2 0 0.5  20.4 0 0.5 --mm 2400   # two 3D points in room frame (model units), e.g.
                                                          # picked in MeshLab/CloudCompare on out/room_textured.glb
  python rescale.py --mm-per-unit 127.3 [--dry-run]       # set factor directly
Options: --thickness-mm 150 (wall thickness for STEP), --dry-run (only print dimensions), --skip-meshes
"""
import argparse, json, os, subprocess, sys, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('--room', default=os.path.join(HERE, 'out', 'room.json'))
ap.add_argument('--mvs', default=os.path.join(HERE, 'work', 'mvs'))
ap.add_argument('--outdir', default=os.path.join(HERE, 'out'))
ap.add_argument('--crop-margin', default='0.45')
g = ap.add_mutually_exclusive_group(required=True)
g.add_argument('--ceiling-height-mm', type=float)
g.add_argument('--wall-length-mm', type=float)
g.add_argument('--length-x-mm', type=float); g.add_argument('--width-y-mm', type=float)
g.add_argument('--door-height-mm', type=float); g.add_argument('--door-width-mm', type=float)
g.add_argument('--points', type=float, nargs=6, metavar=('X1', 'Y1', 'Z1', 'X2', 'Y2', 'Z2'))
g.add_argument('--mm-per-unit', type=float)
ap.add_argument('--wall', choices=['S', 'N', 'W', 'E'], help='which wall for --wall-length-mm')
ap.add_argument('--mm', type=float, help='real distance for --points')
ap.add_argument('--thickness-mm', type=float, default=150.0)
ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--skip-meshes', action='store_true')
a = ap.parse_args()
room = json.load(open(a.room)); d = room['dims']
doors = [o for o in room['openings'] if o['kind_guess'].startswith('door')]
if a.ceiling_height_mm: s = a.ceiling_height_mm / d['height_z']; how = f"ceiling height {a.ceiling_height_mm} mm"
elif a.wall_length_mm:
    if not a.wall: sys.exit('--wall S|N|W|E required with --wall-length-mm')
    ref = d['length_x'] if a.wall in 'SN' else d['width_y']; s = a.wall_length_mm / ref; how = f"wall {a.wall} = {a.wall_length_mm} mm"
elif a.length_x_mm: s = a.length_x_mm / d['length_x']; how = f"length_x = {a.length_x_mm} mm"
elif a.width_y_mm: s = a.width_y_mm / d['width_y']; how = f"width_y = {a.width_y_mm} mm"
elif a.door_height_mm:
    if not doors: sys.exit('no door detected')
    s = a.door_height_mm / doors[0]['height']; how = f"door height {a.door_height_mm} mm (detected opening, approx.)"
elif a.door_width_mm:
    if not doors: sys.exit('no door detected')
    s = a.door_width_mm / doors[0]['width']; how = f"door width {a.door_width_mm} mm (detected opening, approx.)"
elif a.points:
    if not a.mm: sys.exit('--mm required with --points')
    p = np.array(a.points).reshape(2, 3); s = a.mm / np.linalg.norm(p[1] - p[0]); how = f"points distance {a.mm} mm"
else: s = a.mm_per_unit; how = 'explicit factor'
print(f"scale: {s:.4f} mm per model unit  (from {how})")
print(f"room: {d['length_x']*s:.0f} x {d['width_y']*s:.0f} mm, ceiling {d['height_z']*s:.0f} mm, floor area {d['length_x']*d['width_y']*s*s/1e6:.2f} m2")
for o in room['openings']:
    print(f"  {o['wall']:7s} {o['kind_guess'][:40]:40s} width {o['width']*s:.0f} mm  height {o['height']*s:.0f} mm  sill {o['z0']*s:.0f} mm  from wall start {o['u0']*s:.0f} mm")
if a.dry_run: sys.exit(0)
os.makedirs(a.outdir, exist_ok=True)
rmm = json.loads(json.dumps(room)); rmm['units'] = 'mm'; rmm['mm_per_unit'] = s; rmm['scale_source'] = how
rmm['dims'] = {k: round(v * s, 1) for k, v in d.items()}
rmm['floor_polygon'] = [[round(x * s, 1), round(y * s, 1)] for x, y in room['floor_polygon']]
for w in rmm['walls'].values(): w['length'] = round(w['length'] * s, 1)
for o in rmm['openings']:
    for k in ('u0', 'u1', 'z0', 'z1', 'width', 'height'): o[k] = round(o[k] * s, 1)
Tm = np.diag([s, s, s, 1.0]) @ np.array(room['transform_colmap_to_room']); rmm['transform_colmap_to_room_mm'] = Tm.tolist()
# keep model-unit room.json as the geometric source; room_mm.json is for humans/CAD
json.dump(rmm, open(os.path.join(a.outdir, 'room_mm.json'), 'w'), indent=1)
py = sys.executable
subprocess.run([py, os.path.join(HERE, 'scripts', 'walls_cad.py'), a.room, os.path.join(a.outdir, 'walls_mm.step'),
                '--mm-per-unit', str(s), '--thickness', str(a.thickness_mm)], check=True)
if not a.skip_meshes:
    subprocess.run([py, os.path.join(HERE, 'scripts', 'export_meshes.py'), a.room, a.mvs, a.outdir, '--scale', str(s), '--suffix', '_mm', '--crop-margin', a.crop_margin], check=True)
print('written to', a.outdir)
