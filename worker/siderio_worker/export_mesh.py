"""Apply the room transform and write OBJ, GLB and a dense PLY in millimetres."""

from __future__ import annotations

import os
import zipfile

import numpy as np


def _read_textured_ply(path: str):
    with open(path, "rb") as handle:
        header = b""
        while not header.endswith(b"end_header\n"):
            line = handle.readline()
            if not line:
                raise RuntimeError(f"PLY senza fine header: {path}")
            header += line
        text = header.decode("utf-8", errors="replace")
        if "TextureFile" not in text:
            raise RuntimeError("Il PLY testurizzato non contiene TextureFile.")
        vertices = int(text.split("element vertex ")[1].split()[0])
        faces = int(text.split("element face ")[1].split()[0])
        texture = text.split("TextureFile ")[1].split()[0]
        xyz = np.frombuffer(handle.read(vertices * 12), np.float32).reshape(vertices, 3).astype(np.float64)
        dtype = np.dtype([("n", "u1"), ("v", "<u4", 3), ("m", "u1"), ("uv", "<f4", 6)])
        raw = np.frombuffer(handle.read(faces * dtype.itemsize), dtype)
    if not ((raw["n"] == 3).all() and (raw["m"] == 6).all()):
        raise RuntimeError("Formato facce del PLY testurizzato non riconosciuto.")
    return xyz, raw["v"].astype(np.int64), raw["uv"].reshape(-1, 3, 2).astype(np.float64), texture


def export_textured(room: dict, mvs_dir: str, out_dir: str, mm_per_unit: float, crop_margin_mm: float = 200.0, glb_tex: int = 4096):
    import trimesh
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None
    os.makedirs(out_dir, exist_ok=True)
    ply = os.path.join(mvs_dir, "scene_textured.ply")
    cloud = os.path.join(mvs_dir, "scene_dense.ply")
    vertices, faces, uvs, texture_name = _read_textured_ply(ply)
    transform = np.diag([mm_per_unit, mm_per_unit, mm_per_unit, 1.0]) @ np.asarray(room["transform_colmap_to_room"], float)
    vertices = trimesh.transform_points(vertices, transform)
    dims = room["dims"]
    high = np.array([dims["length_x"], dims["width_y"], dims["height_z"]], float) * mm_per_unit
    margin = float(crop_margin_mm)

    def inside(xyz):
        return np.all((xyz >= -margin) & (xyz <= high + margin), axis=1)

    keep = inside(vertices)[faces].all(axis=1)
    faces = faces[keep]
    uvs = uvs[keep]
    image = Image.open(os.path.join(mvs_dir, texture_name))
    corners = vertices[faces].reshape(-1, 3)
    uv = uvs.reshape(-1, 2)
    triangles = np.arange(len(corners)).reshape(-1, 3)
    mesh = trimesh.Trimesh(corners, triangles, visual=trimesh.visual.TextureVisuals(uv=uv, image=image), process=False)
    mesh.merge_vertices(merge_tex=False, merge_norm=True)
    mesh.remove_unreferenced_vertices()
    obj_dir = os.path.join(out_dir, "room_textured_obj")
    os.makedirs(obj_dir, exist_ok=True)
    mesh.export(os.path.join(obj_dir, "room_textured.obj"))
    small = image.copy()
    small.thumbnail((glb_tex, glb_tex))
    glb = trimesh.Trimesh(
        mesh.vertices,
        mesh.faces,
        visual=trimesh.visual.TextureVisuals(uv=mesh.visual.uv, image=small),
        process=False,
    )
    glb_path = os.path.join(out_dir, "room_textured.glb")
    glb.export(glb_path)
    zip_path = os.path.join(out_dir, "room_textured_obj.zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for dirpath, _, files in os.walk(obj_dir):
            for filename in files:
                full = os.path.join(dirpath, filename)
                archive.write(full, os.path.relpath(full, obj_dir))
    dense_path = os.path.join(out_dir, "room_dense.ply")
    _write_dense(cloud, dense_path, transform, inside)
    return {"objZip": zip_path, "glb": glb_path, "dense": dense_path, "vertices": int(len(mesh.vertices)), "faces": int(len(mesh.faces))}


def _write_dense(src: str, dest: str, transform: np.ndarray, inside):
    try:
        import open3d as o3d

        cloud = o3d.io.read_point_cloud(src)
        cloud.transform(transform)
        keep = np.flatnonzero(inside(np.asarray(cloud.points)))
        cloud = cloud.select_by_index(keep.tolist())
        o3d.io.write_point_cloud(dest, cloud)
        return
    except Exception:
        pass
    # ASCII fallback when Open3D cannot read the cloud. Vertices only.
    xyz, colors = _read_xyz_ply(src)
    xyz = (transform[:3, :3] @ xyz.T).T + transform[:3, 3]
    mask = inside(xyz)
    xyz = xyz[mask]
    colors = colors[mask] if colors is not None else None
    _write_ascii_ply(dest, xyz, colors)


def _read_xyz_ply(path: str):
    with open(path, "rb") as handle:
        header = b""
        while not header.endswith(b"end_header\n"):
            header += handle.readline()
        text = header.decode("utf-8", errors="replace")
        count = int(text.split("element vertex ")[1].split()[0])
        props = [line.split()[1:] for line in text.splitlines() if line.startswith("property ")]
        names = [p[-1] for p in props]
        binary = "format binary_little_endian" in text
        if not binary:
            rows = []
            for _ in range(count):
                rows.append([float(v) for v in handle.readline().split()])
            data = np.asarray(rows, float)
        else:
            # Common OpenMVS dense cloud: x y z nx ny nz red green blue, float/uchar mixed.
            # Fall through to a structured read only when every property is float.
            kinds = [p[0] for p in props]
            if any(k not in ("float", "float32") for k in kinds):
                raise RuntimeError("Nuvola densa binaria non leggibile senza Open3D.")
            data = np.frombuffer(handle.read(count * 4 * len(names)), np.float32).reshape(count, len(names)).astype(np.float64)
    xyz = data[:, [names.index("x"), names.index("y"), names.index("z")]]
    colors = None
    if "red" in names:
        colors = data[:, [names.index("red"), names.index("green"), names.index("blue")]]
        if colors.max() > 1:
            colors = colors / 255.0
    return xyz, colors


def _write_ascii_ply(path, xyz, colors):
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("ply\nformat ascii 1.0\n")
        handle.write(f"element vertex {len(xyz)}\n")
        handle.write("property float x\nproperty float y\nproperty float z\n")
        if colors is not None:
            handle.write("property uchar red\nproperty uchar green\nproperty uchar blue\n")
        handle.write("end_header\n")
        if colors is None:
            for x, y, z in xyz:
                handle.write(f"{x:.4f} {y:.4f} {z:.4f}\n")
        else:
            rgb = np.clip(colors * (255 if colors.max() <= 1 else 1), 0, 255).astype(int)
            for (x, y, z), (r, g, b) in zip(xyz, rgb):
                handle.write(f"{x:.4f} {y:.4f} {z:.4f} {r} {g} {b}\n")
