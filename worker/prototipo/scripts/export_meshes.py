#!/usr/bin/env python3
"""Apply the room transform (room.json) to OpenMVS outputs and export OBJ(+MTL+PNG), PLY, GLB + aligned clouds.
Usage: export_meshes.py ROOM_JSON MVS_DIR OUT_DIR [--scale S] [--suffix _mm]
--scale multiplies coordinates after alignment (rescale.py passes mm_per_unit)."""
import sys, os, json, argparse, shutil, numpy as np, trimesh, open3d as o3d
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
ap = argparse.ArgumentParser(); ap.add_argument('room'); ap.add_argument('mvs'); ap.add_argument('out')
ap.add_argument('--scale', type=float, default=1.0); ap.add_argument('--suffix', default='')
ap.add_argument('--glb-tex', type=int, default=4096)
ap.add_argument('--crop-margin', type=float, default=0.8, help='model units; <0 disables cropping to the room box')
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
room = json.load(open(a.room)); T = np.array(room['transform_colmap_to_room']); S = np.diag([a.scale] * 3 + [1]); M = S @ T

def read_textured_ply(path):
    with open(path, 'rb') as f:
        hdr = b''
        while not hdr.endswith(b'end_header\n'): hdr += f.readline()
        h = hdr.decode(); nv = int(h.split('element vertex ')[1].split()[0]); nf = int(h.split('element face ')[1].split()[0])
        tex = h.split('TextureFile ')[1].split()[0]
        V = np.frombuffer(f.read(nv * 12), np.float32).reshape(nv, 3).astype(np.float64)
        dt = np.dtype([('n', 'u1'), ('v', '<u4', 3), ('m', 'u1'), ('uv', '<f4', 6)])
        Fr = np.frombuffer(f.read(nf * dt.itemsize), dt)
    assert (Fr['n'] == 3).all() and (Fr['m'] == 6).all()
    return V, Fr['v'].astype(np.int64), Fr['uv'].reshape(-1, 3, 2).astype(np.float64), tex

mvs = a.mvs; sfx = a.suffix
V, F, UV, texname = read_textured_ply(os.path.join(mvs, 'scene_textured.ply'))
V = trimesh.transform_points(V, M)
dims = room['dims']; box_hi = np.array([dims['length_x'], dims['width_y'], dims['height_z']]) * a.scale
mg_ = a.crop_margin * a.scale
def inbox(X): return np.all((X >= -mg_) & (X <= box_hi + mg_), axis=1)
if a.crop_margin >= 0:
    keep = inbox(V)[F].all(1); F = F[keep]; UV = UV[keep]
    print('cropped to room box: kept faces', keep.sum(), 'of', len(keep))
img = Image.open(os.path.join(mvs, texname))
# unshare vertices per face corner, then merge identical (pos,uv)
v3 = V[F].reshape(-1, 3); uv = UV.reshape(-1, 2); fc = np.arange(len(v3)).reshape(-1, 3)
mesh = trimesh.Trimesh(v3, fc, visual=trimesh.visual.TextureVisuals(uv=uv, image=img), process=False)
mesh.merge_vertices(merge_tex=False, merge_norm=True); mesh.remove_unreferenced_vertices()
obj_dir = os.path.join(a.out, f'room_textured{sfx}_obj'); os.makedirs(obj_dir, exist_ok=True)
mesh.export(os.path.join(obj_dir, f'room_textured{sfx}.obj'))  # writes .mtl + material png
# GLB with a smaller texture
small = img.copy(); small.thumbnail((a.glb_tex, a.glb_tex))
mg = trimesh.Trimesh(mesh.vertices, mesh.faces, visual=trimesh.visual.TextureVisuals(uv=mesh.visual.uv, image=small), process=False)
mg.export(os.path.join(a.out, f'room_textured{sfx}.glb'))
# PLY with per-vertex colours sampled from the texture (portable, no texture file needed)
cols = mg.visual.to_color().vertex_colors
mc = trimesh.Trimesh(mesh.vertices, mesh.faces, vertex_colors=cols, process=False)
mc.export(os.path.join(a.out, f'room_mesh_vcolor{sfx}.ply'))
# dense cloud (aligned)
pc = o3d.io.read_point_cloud(os.path.join(mvs, 'scene_dense.ply')); pc.transform(M)
if a.crop_margin >= 0: pc = pc.select_by_index(np.where(inbox(np.asarray(pc.points)))[0])
o3d.io.write_point_cloud(os.path.join(a.out, f'room_dense_cloud{sfx}.ply'), pc)
print('verts', len(mesh.vertices), 'faces', len(mesh.faces), 'bounds', mesh.bounds.round(3).tolist())
