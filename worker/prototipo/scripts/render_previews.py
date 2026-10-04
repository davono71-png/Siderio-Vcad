#!/usr/bin/env python3
"""Preview PNGs: textured mesh (Open3D offscreen, Filament/Vulkan llvmpipe on CPU), dense cloud, STEP walls (iso+plan).
Usage: render_previews.py OUT_DIR   (expects OUT_DIR/room.json, room_textured_obj/, room_dense_cloud.ply, walls_model_units.stl)"""
import sys, os, json, numpy as np, open3d as o3d
import open3d.visualization.rendering as rd
out = sys.argv[1]; room = json.load(open(os.path.join(out, 'room.json')))
L, W, H = room['dims']['length_x'], room['dims']['width_y'], room['dims']['height_z']
c = np.array([L / 2, W / 2, H / 2])

_R = rd.OffscreenRenderer(1280, 960)   # one renderer for everything (Filament dislikes re-creation)
_keep = []
def renderer(bg=(1, 1, 1, 1)):
    _R.scene.clear_geometry(); _R.scene.set_background(list(bg)); return _R

mesh = o3d.io.read_triangle_mesh(os.path.join(out, 'room_textured_obj', 'room_textured.obj'), False)
tex = o3d.io.read_image(os.path.join(out, 'room_textured_obj', 'material_0.png'))
def tex_mat():
    m = rd.MaterialRecord(); m.shader = 'defaultUnlit'
    if tex is not None: m.albedo_img = tex
    return m
def crop(mesh, zmax=None, ymax=None, xmax=None):
    lo = np.array([-5, -5, -5.0]); hi = np.array([L + 5, W + 5, H + 5.0])
    if zmax is not None: hi[2] = zmax
    if ymax is not None: hi[1] = ymax
    if xmax is not None: hi[0] = xmax
    return mesh.crop(o3d.geometry.AxisAlignedBoundingBox(lo, hi))

views = [
    ('preview_mesh_dollhouse_iso.png', crop(mesh, zmax=0.86 * H), dict(fov=34, eye=[L * 1.45, -W * 0.65, H * 2.1], at=c * [1, 1, 0.3])),
    ('preview_mesh_dollhouse_iso2.png', crop(mesh, zmax=0.86 * H), dict(fov=34, eye=[-L * 0.5, W * 1.6, H * 2.1], at=c * [1, 1, 0.3])),
    ('preview_mesh_inside_view.png', mesh, dict(fov=80, eye=[L * 0.35, W * 0.30, H * 0.55], at=[L, W * 0.75, H * 0.45])),
    ('preview_mesh_top_ceiling_removed.png', crop(mesh, zmax=0.86 * H), dict(fov=40, eye=[L / 2, W / 2, H * 2.6], at=[L / 2, W / 2, 0], up=[0, 1, 0])),
]
for name, geo, v in views:
    r = renderer(); mm = tex_mat(); _keep.append(mm); r.scene.add_geometry('m', geo, mm)
    r.setup_camera(v['fov'], v['at'], v['eye'], v.get('up', [0, 0, 1]))
    o3d.io.write_image(os.path.join(out, name), r.render_to_image()); print('wrote', name)

# dense point cloud (numpy z-buffer splatter, see splat.py)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from splat import look_at, render
from PIL import Image
pc = o3d.io.read_point_cloud(os.path.join(out, 'room_dense_cloud.ply'))
P = np.asarray(pc.points); C = (np.asarray(pc.colors) * 255).astype(np.uint8); k = P[:, 2] < 0.86 * H; P, C = P[k], C[k]
for name, eye, at in [('preview_cloud_iso.png', [L * 1.45, -W * 0.65, H * 2.1], c * [1, 1, 0.3]),
                      ('preview_cloud_top.png', [L / 2, W / 2 - 0.01, H * 2.6], [L / 2, W / 2, 0])]:
    R, t = look_at(eye, at, up=(0, 0, 1) if 'iso' in name else (0, 1, 0))
    img = render(P, C, R, t, W=1280, H=960, f=960 / (2 * np.tan(np.radians(17 if 'iso' in name else 20))), radius=1)
    Image.fromarray(img).save(os.path.join(out, name)); print('wrote', name)

# STEP walls: matplotlib shaded iso views (Filament shadow/acne artifacts on the flat CAD faces)
import subprocess
subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'step_iso.py'),
                os.path.join(out, 'walls_model_units.stl'), os.path.join(out, 'preview_step_walls')], check=True)
_R.scene.clear_geometry()
os._exit(0)  # skip Filament teardown (can abort on exit)
