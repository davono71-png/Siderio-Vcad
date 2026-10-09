#!/usr/bin/env python3
"""Preview PNGs of the mm outputs (Open3D offscreen Filament on CPU). Usage: render_mm.py OUT_DIR"""
import sys, os, json, numpy as np, open3d as o3d
import open3d.visualization.rendering as rd
out = sys.argv[1]; room = json.load(open(os.path.join(out, 'room_mm.json')))
L, W, H = room['dims']['length_x'], room['dims']['width_y'], room['dims']['height_z']
c = np.array([L / 2, W / 2, H / 2])
R = rd.OffscreenRenderer(1400, 1050)
d = os.path.join(out, 'room_textured_mm_obj')
mesh = o3d.io.read_triangle_mesh(os.path.join(d, 'room_textured_mm.obj'), False)
tex = o3d.io.read_image(os.path.join(d, 'material_0.png'))
def crop(m, zmax=None):
    hi = np.array([L + 600, W + 600, H + 600.0]); hi[2] = zmax if zmax else hi[2]
    return m.crop(o3d.geometry.AxisAlignedBoundingBox(np.array([-600, -600, -600.0]), hi))
mats = []
views = [
    ('preview_mesh_iso_SE.png', crop(mesh, 0.86 * H), dict(fov=34, eye=[L * 1.45, -W * 0.65, H * 2.1], at=c * [1, 1, 0.3])),
    ('preview_mesh_iso_NW.png', crop(mesh, 0.86 * H), dict(fov=34, eye=[-L * 0.5, W * 1.6, H * 2.1], at=c * [1, 1, 0.3])),
    ('preview_mesh_top.png', crop(mesh, 0.86 * H), dict(fov=40, eye=[L / 2, W / 2, H * 2.6], at=[L / 2, W / 2, 0], up=[0, 1, 0])),
    ('preview_mesh_inside.png', mesh, dict(fov=80, eye=[L * 0.75, W * 0.25, H * 0.55], at=[L * 0.1, W * 0.9, H * 0.45])),
]
for name, geo, v in views:
    R.scene.clear_geometry(); R.scene.set_background([1, 1, 1, 1])
    m = rd.MaterialRecord(); m.shader = 'defaultUnlit'; m.albedo_img = tex; mats.append(m)
    R.scene.add_geometry('m', geo, m); R.setup_camera(v['fov'], v['at'], v['eye'], v.get('up', [0, 0, 1]))
    o3d.io.write_image(os.path.join(out, name), R.render_to_image()); print('wrote', name, flush=True)
R.scene.clear_geometry()
os._exit(0)
