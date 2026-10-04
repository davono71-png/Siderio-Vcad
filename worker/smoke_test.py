#!/usr/bin/env python3
"""CI smoke test: import the worker and run scale + wall detection on a synthetic room.

No GPU, R2, COLMAP or OpenMVS. CadQuery is used when it is installed.
"""

from __future__ import annotations

import os
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from siderio_worker import export_mesh, openmvs, options, pipeline, prep, previews, r2, room, scale, sfm, status, walls  # noqa: E402
import handler  # noqa: E402
import test_local  # noqa: E402


def _grid(origin, axis_u, axis_v, nu, nv, normal, noise=4.0, rng=None):
    rng = rng or np.random.default_rng(0)
    us = np.linspace(0, 1, nu)
    vs = np.linspace(0, 1, nv)
    uu, vv = np.meshgrid(us, vs)
    pts = origin + uu.reshape(-1, 1) * axis_u + vv.reshape(-1, 1) * axis_v
    pts = pts + rng.normal(0, noise, pts.shape)
    nrm = np.repeat(np.asarray(normal, float)[None, :], len(pts), axis=0)
    nrm = nrm + rng.normal(0, 0.02, nrm.shape)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    return pts, nrm


def synthetic_room(rng):
    parts = []
    # Floor and ceiling reach the true walls. A table must not become the floor.
    parts.append(_grid(np.array([0, 0, 0.0]), np.array([4000, 0, 0]), np.array([0, 3000, 0]), 80, 60, [0, 0, 1], rng=rng))
    parts.append(_grid(np.array([0, 0, 2700.0]), np.array([4000, 0, 0]), np.array([0, 3000, 0]), 70, 50, [0, 0, -1], rng=rng))
    # West wall is mostly hidden by the wardrobe: only a strip above it and the sides.
    parts.append(_grid(np.array([0, 0, 2400.0]), np.array([0, 3000, 0]), np.array([0, 0, 300]), 50, 8, [1, 0, 0], rng=rng))
    parts.append(_grid(np.array([0, 0, 0.0]), np.array([0, 350, 0]), np.array([0, 0, 2700]), 8, 40, [1, 0, 0], rng=rng))
    parts.append(_grid(np.array([0, 2450, 0.0]), np.array([0, 550, 0]), np.array([0, 0, 2700]), 10, 40, [1, 0, 0], rng=rng))
    # Wardrobe front, dense, inset 620 mm. The old detector picked this plane.
    parts.append(_grid(np.array([620, 350, 0.0]), np.array([0, 2100, 0]), np.array([0, 0, 2300]), 40, 46, [1, 0, 0], noise=3, rng=rng))
    # East, south, north walls.
    parts.append(_grid(np.array([4000, 0, 0.0]), np.array([0, 3000, 0]), np.array([0, 0, 2700]), 60, 50, [-1, 0, 0], rng=rng))
    parts.append(_grid(np.array([0, 0, 0.0]), np.array([4000, 0, 0]), np.array([0, 0, 2700]), 70, 50, [0, 1, 0], rng=rng))
    parts.append(_grid(np.array([0, 3000, 0.0]), np.array([4000, 0, 0]), np.array([0, 0, 2700]), 70, 50, [0, -1, 0], rng=rng))
    # Painting 80 mm in front of the north wall.
    parts.append(_grid(np.array([1500, 2920, 1200.0]), np.array([700, 0, 0]), np.array([0, 0, 500]), 18, 14, [0, -1, 0], noise=2, rng=rng))
    # Table top.
    parts.append(_grid(np.array([1800, 800, 750.0]), np.array([900, 0, 0]), np.array([0, 700, 0]), 16, 12, [0, 0, 1], rng=rng))
    # Points seen through the north door: a narrow tongue, not a wall.
    parts.append(_grid(np.array([1800, 3000, 0.0]), np.array([800, 0, 0]), np.array([0, 1400, 0]), 12, 20, [0, 0, 1], rng=rng))
    clutter = rng.uniform([400, 400, 200], [3600, 2600, 2400], size=(400, 3))
    clutter_n = rng.normal(size=clutter.shape)
    clutter_n /= np.linalg.norm(clutter_n, axis=1, keepdims=True)
    parts.append((clutter, clutter_n))
    points = np.vstack([p for p, _ in parts])
    normals = np.vstack([n for _, n in parts])
    cameras = np.array([[2000.0, 1500.0, 1500.0], [800.0, 700.0, 1600.0], [3200.0, 2200.0, 1400.0]])
    return points, normals, cameras


def check_walls():
    rng = np.random.default_rng(1)
    points, normals, cameras = synthetic_room(rng)
    detected = room.detect_room(points, normals, cameras, mm_per_unit=1.0, up_prior=np.array([0.0, 0.0, 1.0]))
    dims = detected["dims"]
    length, width, height = dims["length_x"], dims["width_y"], dims["height_z"]
    print(f"synthetic room {length:.0f} x {width:.0f} x {height:.0f} mm")
    assert abs(length - 4000) < 120, length
    assert abs(width - 3000) < 120, width
    assert abs(height - 2700) < 80, height
    # The wardrobe plane would shrink the length by about 620 mm.
    assert length > 3700, length
    notes = detected["detection"]["walls"]
    for side in ("xmin", "xmax", "ymin", "ymax"):
        rejected = (notes.get(side) or {}).get("rejected") or []
        insets = [item.get("insetMm", 0) for item in rejected]
        print(side, notes[side].get("method"), "rejected", len(rejected), "max inset", max(insets) if insets else None)
    raw = detected["detection"]["raw_planes"]["xmin"]
    forced = room.detect_room(
        points,
        normals,
        cameras,
        mm_per_unit=1.0,
        overrides={"xmin": raw + 500},
        up_prior=np.array([0.0, 0.0, 1.0]),
    )
    delta = detected["dims"]["length_x"] - forced["dims"]["length_x"]
    assert abs(delta - 500) < 40, delta
    mm = room.to_millimetres(detected, 1.0)
    assert mm["units"] == "mm"
    assert abs(mm["dims"]["length_x"] - length) < 1


def _pinhole(centre, uv, f=500.0, principal=(320.0, 240.0)):
    centre = np.asarray(centre, float)
    uv = np.asarray(uv, float)
    xn = (uv[0] - principal[0]) / f
    yn = (uv[1] - principal[1]) / f
    direction = np.array([xn, yn, 1.0])
    direction /= np.linalg.norm(direction)

    def project(xyz):
        local = np.asarray(xyz, float) - centre
        if local[2] <= 1e-8:
            return None
        return np.array([f * local[0] / local[2] + principal[0], f * local[1] / local[2] + principal[1]])

    return scale.Ray("cam", centre, direction, project, uv)


def check_scale():
    # Point A at the origin of the view, 5 m in front of two cameras 2 m apart.
    point_a = np.array([0.0, 0.0, 5.0])
    point_b = np.array([1.0, 0.2, 5.0])
    cams = [np.array([0.0, 0.0, 0.0]), np.array([2.0, -0.4, 0.0])]

    def observe(point):
        rays = []
        for cam in cams:
            local = point - cam
            uv = np.array([500 * local[0] / local[2] + 320, 500 * local[1] / local[2] + 240])
            rays.append(_pinhole(cam, uv))
        return rays

    got, _ = scale.triangulate(observe(point_a))
    assert np.linalg.norm(got - point_a) < 1e-3, got
    located = {"A": scale.triangulate(observe(point_a))[0], "B": scale.triangulate(observe(point_b))[0]}
    distance = float(np.linalg.norm(located["A"] - located["B"]))
    project = {
        "points": [
            {"id": "pa", "label": "A", "observations": []},
            {"id": "pb", "label": "B", "observations": []},
        ],
        "measurements": [
            {"pointA": "pa", "pointB": "pb", "labelA": "A", "labelB": "B", "distanceMm": 1000.0, "note": ""},
            {"pointA": "pa", "pointB": "pb", "labelA": "A", "labelB": "B", "distanceMm": 1000.0, "note": "dup"},
            {"pointA": "pb", "pointB": "pa", "distanceMm": 1040.0, "note": "second"},
        ],
    }
    # The second measurement has no labels: ids must resolve to A and B.
    report = scale.scale_report(project, located, monte_carlo=0)
    assert report["n_used"] == 2, report
    s, residual, rms = scale.fit_scale([distance, distance], [1000.0, 1040.0])
    assert abs(report["mm_per_unit"] - s) < 1e-6
    assert rms > 0
    text = scale.render_markdown(report)
    assert "Millimetri per unità" in text
    assert abs(residual).sum() > 0


def check_imports_and_options():
    assert handler.handler({"input": {}})["ok"] is False
    opt = options.parse_options({"downscale": 3, "wallThicknessMm": 120, "roomOverrides": {"xmin": 1}, "device": "cpu"})
    assert opt.downscale == 3 and opt.wall_thickness_mm == 120 and opt.room_overrides["xmin"] == 1
    project_id = "11111111-2222-4333-8444-555555555555"
    photo = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    assert r2.photo_key(project_id, 1, photo) == f"rilievi/{project_id}/foto/001-{photo}.jpg"
    assert r2.result_key(project_id, "walls.step").endswith("/risultati/walls.step")
    modules = [export_mesh, openmvs, options, pipeline, prep, previews, r2, room, scale, sfm, status, walls, test_local]
    assert all(mod is not None for mod in modules)
    assert sfm.compiled_sms() == {61, 89}


def check_step():
    try:
        import cadquery  # noqa: F401
    except ImportError:
        print("cadquery assente: salto lo STEP")
        return
    model = {
        "dims": {"length_x": 4.0, "width_y": 3.0, "height_z": 2.7},
        "openings": [{"wall": "N_ymax", "kind_guess": "door", "u0": 1.0, "u1": 1.8, "z0": 0.0, "z1": 2.1}],
    }
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "walls.step")
        info = walls.export_step(model, path, mm_per_unit=1000.0, thickness_mm=150, floor_slab_mm=150, ceiling_slab_mm=150, cut="doors")
        assert os.path.getsize(path) > 500, info
        assert abs(info["lengthMm"] - 4000) < 1


def main():
    check_imports_and_options()
    check_scale()
    check_walls()
    check_step()
    print("smoke ok")


if __name__ == "__main__":
    main()
