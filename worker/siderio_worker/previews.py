"""Headless preview PNGs. No OpenGL: a numpy z-buffer for the cloud and a plan drawn with Pillow."""

from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw


def _look_at(eye, target, up=(0, 0, 1)):
    eye = np.asarray(eye, float)
    forward = np.asarray(target, float) - eye
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, np.asarray(up, float))
    right /= np.linalg.norm(right)
    cam_up = np.cross(right, forward)
    rotation = np.stack([right, -cam_up, forward])
    return rotation, -rotation @ eye


def _splat(points, colors, rotation, translation, width, height, focal, radius=1):
    local = points @ rotation.T + translation
    keep = local[:, 2] > 0.05
    local = local[keep]
    cols = colors[keep]
    u = focal * local[:, 0] / local[:, 2] + width / 2
    v = focal * local[:, 1] / local[:, 2] + height / 2
    z = local[:, 2]
    image = np.full((height, width, 3), 245, np.uint8)
    order = np.argsort(-z)
    u, v, z, cols = u[order], v[order], z[order], cols[order]
    for du in range(-radius, radius + 1):
        for dv in range(-radius, radius + 1):
            ui = np.round(u).astype(int) + du
            vi = np.round(v).astype(int) + dv
            ok = (ui >= 0) & (ui < width) & (vi >= 0) & (vi < height)
            image[vi[ok], ui[ok]] = cols[ok]
    return image


def _load_cloud(path: str, limit: int = 250000):
    try:
        import open3d as o3d

        cloud = o3d.io.read_point_cloud(path)
        points = np.asarray(cloud.points)
        colors = np.asarray(cloud.colors)
        if len(colors) != len(points) or len(colors) == 0:
            colors = np.full((len(points), 3), 0.45)
    except Exception:
        from .export_mesh import _read_xyz_ply

        points, colors = _read_xyz_ply(path)
        if colors is None:
            colors = np.full((len(points), 3), 0.45)
        elif colors.max() > 1:
            colors = colors / 255.0
    if len(points) > limit:
        rng = np.random.default_rng(0)
        take = rng.choice(len(points), limit, replace=False)
        points, colors = points[take], colors[take]
    rgb = np.clip(colors * 255.0, 0, 255).astype(np.uint8)
    return points, rgb


def _plan(room_mm: dict, path: str):
    dims = room_mm["dims"]
    length, width = float(dims["length_x"]), float(dims["width_y"])
    canvas = Image.new("RGB", (1100, 900), "white")
    draw = ImageDraw.Draw(canvas)
    pad = 80
    scale = min((canvas.width - 2 * pad) / max(length, 1), (canvas.height - 2 * pad) / max(width, 1))
    def xy(x, y):
        return pad + x * scale, canvas.height - pad - y * scale
    corners = [xy(0, 0), xy(length, 0), xy(length, width), xy(0, width)]
    draw.polygon(corners, outline=(20, 40, 60), width=4)
    if room_mm.get("mode") == "facciata":
        label = f"facciata {length:.0f} x {width:.0f} mm, profondità {float(dims['height_z']):.0f} mm"
    else:
        label = f"{length:.0f} x {width:.0f} mm, h {dims['height_z']:.0f} mm"
    draw.text((pad, 24), label, fill=(20, 40, 60))
    for opening in room_mm.get("openings") or []:
        u0, u1 = float(opening["u0"]), float(opening["u1"])
        wall = opening["wall"]
        if wall == "S_ymin":
            a, b = xy(u0, 0), xy(u1, 0)
        elif wall == "N_ymax":
            a, b = xy(u0, width), xy(u1, width)
        elif wall == "W_xmin":
            a, b = xy(0, u0), xy(0, u1)
        else:
            a, b = xy(length, u0), xy(length, u1)
        draw.line([a, b], fill=(180, 60, 40), width=8)
    canvas.save(path)


def write_previews(out_dir: str, room_mm: dict):
    dense = os.path.join(out_dir, "room_dense.ply")
    written = []
    plan = os.path.join(out_dir, "preview_plan.png")
    _plan(room_mm, plan)
    written.append(plan)
    if not os.path.isfile(dense):
        return written
    points, colors = _load_cloud(dense)
    if len(points) < 20:
        return written
    dims = room_mm["dims"]
    length, width, height = float(dims["length_x"]), float(dims["width_y"]), float(dims["height_z"])
    centre = np.array([length / 2, width / 2, height / 3])
    views = {
        "preview_iso.png": (np.array([length * 1.5, -width * 0.7, height * 1.8]), centre, (0, 0, 1)),
        "preview_top.png": (np.array([length / 2, width / 2 - max(width, 1) * 0.01, height * 2.4]), np.array([length / 2, width / 2, 0]), (0, 1, 0)),
    }
    for name, (eye, target, up) in views.items():
        rotation, translation = _look_at(eye, target, up)
        image = _splat(points, colors, rotation, translation, 960, 720, focal=700, radius=1)
        path = os.path.join(out_dir, name)
        Image.fromarray(image).save(path)
        written.append(path)
    return written
