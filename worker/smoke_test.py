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

from siderio_worker import export_mesh, facade, openmvs, options, pipeline, prep, previews, r2, room, scale, sfm, status, walls  # noqa: E402
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
    assert detected["detection"]["floorMethod"] == "plane"
    assert detected["detection"]["ceilingMethod"] == "plane"
    assert detected["mode"] == "stanza"
    assert mm["mode"] == "stanza"
    assert mm["detection"]["floorMethod"] == "plane"


def _box(rng, *, with_floor=True, with_ceiling=True, wall_top=2700.0, ceiling_z=2700.0, patch=False):
    """Axis-aligned room. Floor and ceiling can be omitted or reduced to a patch."""
    parts = []
    floor_pts, floor_n = _grid(np.array([0, 0, 0.0]), np.array([4000, 0, 0]), np.array([0, 3000, 0]), 40, 30, [0, 0, 1], rng=rng)
    if not with_floor:
        floor_n = np.repeat([[1.0, 0.0, 0.0]], len(floor_pts), axis=0)
    parts.append((floor_pts, floor_n))
    if with_ceiling and not patch:
        parts.append(_grid(np.array([0, 0, ceiling_z]), np.array([4000, 0, 0]), np.array([0, 3000, 0]), 36, 28, [0, 0, -1], rng=rng))
    if patch:
        parts.append(_grid(np.array([1800, 1300, ceiling_z]), np.array([400, 0, 0]), np.array([0, 400, 0]), 8, 6, [0, 0, -1], noise=2, rng=rng))
    parts.append(_grid(np.array([0, 0, 0.0]), np.array([0, 3000, 0]), np.array([0, 0, wall_top]), 24, 20, [1, 0, 0], rng=rng))
    parts.append(_grid(np.array([4000, 0, 0.0]), np.array([0, 3000, 0]), np.array([0, 0, wall_top]), 24, 20, [-1, 0, 0], rng=rng))
    parts.append(_grid(np.array([0, 0, 0.0]), np.array([4000, 0, 0]), np.array([0, 0, wall_top]), 32, 20, [0, 1, 0], rng=rng))
    parts.append(_grid(np.array([0, 3000, 0.0]), np.array([4000, 0, 0]), np.array([0, 0, wall_top]), 32, 20, [0, -1, 0], rng=rng))
    points = np.vstack([p for p, _ in parts])
    normals = np.vstack([n for _, n in parts])
    return points, normals


def _detect_box(points, normals, cameras):
    return room.detect_room(points, normals, cameras, mm_per_unit=1.0, up_prior=np.array([0.0, 0.0, 1.0]))


def check_ceiling_fallbacks():
    rng = np.random.default_rng(2)
    cams = np.array([[2000.0, 1500.0, 1500.0]])
    sparse, sparse_n = _box(rng, with_ceiling=False, wall_top=2700.0)
    detected = _detect_box(sparse, sparse_n, cams)
    assert detected["detection"]["floorMethod"] == "plane"
    assert detected["detection"]["ceilingMethod"] == "fallback-percentile", detected["detection"]["ceilingMethod"]
    assert 2200 < detected["dims"]["height_z"] < 2800, detected["dims"]
    assert abs(detected["dims"]["length_x"] - 4000) < 200

    short, short_n = _box(rng, with_ceiling=False, wall_top=1400.0)
    phone = np.array([[2000.0, 1500.0, 1600.0]])
    detected = _detect_box(short, short_n, phone)
    assert detected["detection"]["ceilingMethod"] == "fallback-cameras", detected["detection"]["ceilingMethod"]
    assert abs(detected["dims"]["height_z"] - 1800) < 40, detected["dims"]["height_z"]

    partial, partial_n = _box(rng, with_ceiling=False, patch=True, ceiling_z=2700.0)
    detected = _detect_box(partial, partial_n, cams)
    assert detected["detection"]["ceilingMethod"] == "fallback-peak", detected["detection"]["ceilingMethod"]
    assert abs(detected["dims"]["height_z"] - 2700) < 80, detected["dims"]["height_z"]

    # A downward patch on a low piece of furniture is not a ceiling.
    low_patch, low_patch_n = _box(rng, with_ceiling=False, patch=True, ceiling_z=400.0, wall_top=2700.0)
    detected = _detect_box(low_patch, low_patch_n, cams)
    assert detected["detection"]["ceilingMethod"] == "fallback-percentile", detected["detection"]["ceilingMethod"]
    assert 2200 < detected["dims"]["height_z"] < 2800, detected["dims"]

    no_floor, no_floor_n = _box(rng, with_floor=False, ceiling_z=2700.0)
    detected = _detect_box(no_floor, no_floor_n, cams)
    assert detected["detection"]["ceilingMethod"] == "plane"
    assert detected["detection"]["floorMethod"] == "fallback-percentile", detected["detection"]["floorMethod"]
    assert 2400 < detected["dims"]["height_z"] < 2900, detected["dims"]

    tall, tall_n = _box(rng, ceiling_z=6000.0, wall_top=6000.0)
    try:
        _detect_box(tall, tall_n, cams)
    except RuntimeError as exc:
        assert "abbastanza estesi" in str(exc)
    else:
        raise AssertionError("a 6 m ceiling should be rejected")

    low, low_n = _box(rng, ceiling_z=500.0, wall_top=500.0)
    inside = np.array([[2000.0, 1500.0, 250.0]])
    try:
        _detect_box(low, low_n, inside)
    except RuntimeError:
        pass
    else:
        raise AssertionError("a 0.5 m room should be rejected")


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
    assert "incoerenti" not in text
    assert report["warning"] is None
    assert abs(residual).sum() > 0
    warned = scale.consistency_warning(
        {
            "measurements": [
                {"pair": "A-B", "mm": 1200.0, "duplicate": False},
                {"pair": "B-C", "mm": 2500.0, "duplicate": False},
            ],
            "leave_one_out": [
                {"leftOut": "A-B", "predictedMm": 1364.8, "errMm": 164.8},
                {"leftOut": "B-C", "predictedMm": 2198.1, "errMm": -301.9},
            ],
        }
    )
    assert warned and "incoerenti" in warned and ("13." in warned or "12." in warned), warned
    assert scale.consistency_warning(
        {"measurements": [{"pair": "A-B", "mm": 1000.0, "duplicate": False}], "leave_one_out": [{"leftOut": "A-B", "errMm": 10.0, "predictedMm": 1010.0}]}
    ) is None


def _span(plane, axis):
    origin = np.asarray(plane["originMm"], float)
    along_u = np.asarray(plane["axisU"], float) * float(plane["widthMm"])
    along_v = np.asarray(plane["axisV"], float) * float(plane["heightMm"])
    corners = [origin, origin + along_u, origin + along_v, origin + along_u + along_v]
    values = [float(corner[axis]) for corner in corners]
    return min(values), max(values)


def synthetic_facade(rng):
    """Wall, desk top and monitor. No floor and no ceiling."""
    parts = []
    parts.append(_grid(np.array([0, 0, 0.0]), np.array([2000, 0, 0]), np.array([0, 0, 1600]), 70, 56, [0, 1, 0], rng=rng))
    parts.append(_grid(np.array([300, 0, 740.0]), np.array([1200, 0, 0]), np.array([0, 700, 0]), 36, 22, [0, 0, 1], rng=rng))
    parts.append(_grid(np.array([700, 180, 860.0]), np.array([450, 0, 0]), np.array([0, 0, 420]), 16, 14, [0, 1, 0], noise=2, rng=rng))
    parts.append(_grid(np.array([80, 90, 180.0]), np.array([40, 0, 0]), np.array([0, 30, 0]), 6, 5, [0, 1, 0], noise=1, rng=rng))
    points = np.vstack([item[0] for item in parts])
    normals = np.vstack([item[1] for item in parts])
    cameras = np.array([[1000.0, 1500.0, 1100.0], [600.0, 1400.0, 1000.0], [1400.0, 1600.0, 1200.0]])
    return points, normals, cameras


def check_facade():
    rng = np.random.default_rng(3)
    points, normals, cameras = synthetic_facade(rng)
    detected = facade.detect_facade(
        points,
        normals,
        cameras,
        mm_per_unit=1.0,
        up_prior=np.array([0.0, 0.0, 1.0]),
        wall_thickness_mm=150.0,
    )
    scene = facade.to_millimetres(detected, 1.0)
    assert scene["mode"] == "facciata"
    background = [plane for plane in scene["planes"] if plane["role"] == "background"]
    assert len(background) == 1, scene["planes"]
    wall = background[0]
    assert wall["type"] == "facciata"
    assert abs(wall["widthMm"] - 2000) < 160, wall
    assert abs(wall["heightMm"] - 1600) < 160, wall
    assert wall["thicknessMm"] == 150.0
    assert wall["thicknessSource"] == "parete"
    assert wall["step"] == "walls"
    assert abs(wall["normal"][2] - 1) < 1e-6
    horizontal = [plane for plane in scene["planes"] if plane["type"] == "orizzontale"]
    vertical = [plane for plane in scene["planes"] if plane["type"] == "verticale"]
    assert len(horizontal) == 1, scene["note"]
    assert len(vertical) == 1, scene["planes"]
    desk = horizontal[0]
    desk_x = _span(desk, 0)
    desk_z = _span(desk, 2)
    desk_y = _span(desk, 1)
    assert abs((desk_x[1] - desk_x[0]) - 1200) < 160, desk
    assert abs((desk_z[1] - desk_z[0]) - 700) < 160, desk
    assert abs(desk_y[0] - 740) < 40 and abs(desk_y[1] - 740) < 40, desk
    assert desk["thicknessMm"] == 20.0
    assert desk["thicknessSource"] == "nominale"
    assert desk["step"] == "extra"
    monitor = vertical[0]
    assert abs((_span(monitor, 0)[1] - _span(monitor, 0)[0]) - 450) < 120, monitor
    assert abs((_span(monitor, 1)[1] - _span(monitor, 1)[0]) - 420) < 120, monitor
    assert abs(_span(monitor, 2)[0] - 180) < 40, monitor
    assert monitor["thicknessMm"] == 20.0
    assert monitor["step"] == "extra"
    assert any(item["reason"] == "estensione insufficiente" for item in scene["skipped"]), scene["skipped"]
    assert "Piano di fondo" in scene["note"]
    assert scene["openings"] == []
    assert not any(plane["type"] == "inclinato" for plane in scene["planes"])
    # The same cloud is not a room: facciata must not invent a floor.
    assert "floorMethod" not in scene

    wall_only, wall_normals, _ = synthetic_facade(rng)
    # Keep the wall. The patch at y=90 and the monitor at y=180 stay out.
    keep = (wall_normals[:, 1] > 0.5) & (wall_only[:, 1] < 30)
    alone = facade.detect_facade(wall_only[keep], wall_normals[keep], cameras, mm_per_unit=1.0, up_prior=np.array([0.0, 0.0, 1.0]))
    assert len(alone["planes"]) == 1
    assert alone["planes"][0]["role"] == "background"
    assert alone["note"].startswith("Solo il piano di fondo")

    # More points on the desk than on the wall, camera above looking down.
    # The background stays the wall.
    dense_desk = [
        _grid(np.array([0, 0, 0.0]), np.array([2000, 0, 0]), np.array([0, 0, 1600]), 24, 18, [0, 1, 0], rng=rng),
        _grid(np.array([200, 0, 740.0]), np.array([1400, 0, 0]), np.array([0, 800, 0]), 50, 40, [0, 0, 1], rng=rng),
    ]
    desk_points = np.vstack([item[0] for item in dense_desk])
    desk_normals = np.vstack([item[1] for item in dense_desk])
    above = np.array([[1000.0, 700.0, 1700.0]])
    looked_down = facade.detect_facade(desk_points, desk_normals, above, mm_per_unit=1.0, up_prior=np.array([0.0, 0.0, 1.0]))
    assert looked_down["planes"][0]["type"] == "facciata"
    assert abs(looked_down["planes"][0]["normal"][2] - 1) < 1e-6
    assert any(plane["type"] == "orizzontale" for plane in looked_down["planes"])

    check_outdoor_facade(rng)
    check_zup_facade(rng)
    check_sparse_patch_not_opening()

    rng_noise = np.random.default_rng(4)
    noise = rng_noise.normal(size=(60, 3)) * 100
    noise_n = rng_noise.normal(size=(60, 3))
    try:
        facade.detect_facade(noise, noise_n, cameras, mm_per_unit=1.0)
    except RuntimeError as exc:
        assert "piano di fondo" in str(exc)
        assert "pavimento" not in str(exc)
    else:
        raise AssertionError("a cloud without a plane should not become a facade")


def check_outdoor_facade(rng):
    """Tilted outdoor wall, ground, door recess, and a bad gravity prior."""
    wall, wall_n = _grid(np.array([0.0, 0.0, 0.0]), np.array([7000.0, 0.0, 0.0]), np.array([0.0, 0.0, 2700.0]), 90, 40, [0.0, 1.0, 0.0], rng=rng)
    hole = (wall[:, 0] > 2800) & (wall[:, 0] < 3700) & (wall[:, 2] < 2100)
    parts = [(wall[~hole], wall_n[~hole])]
    parts.append(_grid(np.array([2800.0, -140.0, 0.0]), np.array([900.0, 0.0, 0.0]), np.array([0.0, 0.0, 2100.0]), 14, 28, [0.0, 1.0, 0.0], noise=2, rng=rng))
    parts.append(_grid(np.array([-200.0, 0.0, 0.0]), np.array([7400.0, 0.0, 0.0]), np.array([0.0, 3500.0, 0.0]), 48, 22, [0.0, 0.0, 1.0], rng=rng))
    parts.append(_grid(np.array([6200.0, 350.0, 400.0]), np.array([700.0, 0.0, 0.0]), np.array([0.0, 0.0, 1600.0]), 10, 16, [0.45, 0.89, 0.0], noise=2, rng=rng))
    roof_normal = np.array([0.0, 0.45, 0.89])
    roof_normal = roof_normal / np.linalg.norm(roof_normal)
    roof_v = np.cross(roof_normal, np.array([1.0, 0.0, 0.0]))
    roof_v = roof_v / np.linalg.norm(roof_v) * 400.0
    parts.append(_grid(np.array([400.0, 800.0, 2100.0]), np.array([500.0, 0.0, 0.0]), roof_v, 8, 8, roof_normal, noise=2, rng=rng))
    points = np.vstack([item[0] for item in parts])
    normals = np.vstack([item[1] for item in parts])
    cameras = np.array(
        [
            [800.0, 4200.0, 1500.0],
            [2500.0, 4500.0, 1550.0],
            [4300.0, 3900.0, 1480.0],
            [6100.0, 4700.0, 1600.0],
        ]
    )
    ups = np.repeat([[0.0, 0.0, 1.0]], len(cameras), axis=0)
    angle = np.radians(28)
    cosine, sine = np.cos(angle), np.sin(angle)
    rotation = np.array([[cosine, 0.0, sine], [0.0, 1.0, 0.0], [-sine, 0.0, cosine]])
    points = points @ rotation.T
    normals = normals @ rotation.T
    cameras = cameras @ rotation.T
    ups = ups @ rotation.T
    bad_prior = np.array([0.96, 0.12, 0.18])
    bad_prior = bad_prior / np.linalg.norm(bad_prior)
    detected = facade.detect_facade(
        points,
        normals,
        cameras,
        mm_per_unit=1.0,
        up_prior=bad_prior,
        camera_ups=ups,
        wall_thickness_mm=150.0,
    )
    scene = facade.to_millimetres(detected, 1.0)
    wall_plane = scene["planes"][0]
    assert wall_plane["role"] == "background", scene["note"]
    assert abs(wall_plane["widthMm"] - 7000) < 400, wall_plane
    assert abs(wall_plane["heightMm"] - 2700) < 350, wall_plane
    assert wall_plane["thicknessMm"] == 150.0
    assert scene["upAxis"] == "Y"
    assert "Asse verticale: Y" in scene["convention"]
    true_up = np.array([sine, 0.0, cosine])
    frame = np.asarray(detected["transform_colmap_to_room"], float)[:3, :3]
    assert float(frame[1] @ true_up) > 0.95, frame[1]
    assert scene["upSource"] in ("camere", "camere+terreno", "terreno", "gravita+terreno"), scene["upSource"]
    assert not any(plane["type"] == "inclinato" for plane in scene["planes"]), scene["planes"]
    assert any(item.get("reason") == "inclinato" for item in scene["skipped"]), scene["skipped"]
    ground = [plane for plane in scene["planes"] if plane["role"] == "terreno"]
    assert len(ground) == 1, scene["planes"]
    assert ground[0]["type"] == "orizzontale"
    assert len(scene["openings"]) == 1, scene["openings"]
    door = scene["openings"][0]
    assert abs(door["widthMm"] - 900) < 200, door
    assert 1700 < door["heightMm"] < 2400, door
    assert door["y0"] < 400, door
    kinds = sorted(plane["role"] for plane in scene["planes"])
    print(
        f"synthetic facade {wall_plane['widthMm']:.0f} x {wall_plane['heightMm']:.0f} mm, "
        f"up {scene['upSource']}, door {door['widthMm']:.0f}x{door['heightMm']:.0f}, planes {kinds}"
    )
    with tempfile.TemporaryDirectory() as tmp:
        plan = os.path.join(tmp, "preview_plan.png")
        previews._plan(scene, plan)
        assert os.path.getsize(plan) > 500

    # Same cloud without camera ups: the ground plane replaces the bad prior.
    detected = facade.detect_facade(points, normals, cameras, mm_per_unit=1.0, up_prior=bad_prior, wall_thickness_mm=150.0)
    assert detected["upSource"] == "terreno", detected["upSource"]
    assert abs(detected["planes"][0]["width"] - 7000) < 400


def check_zup_facade(rng=None):
    rng = np.random.default_rng(11)
    """Z-up cloud, the COLMAP room convention, with a sideways camera axis.

    Gravity is +Z. Portrait JPEGs without EXIF rotation report camera Y along
    +X. The wall must stay the background, Y must be the exported up axis,
    and the door and window must be cut.
    """
    wall, wall_n = _grid(
        np.array([0.0, 0.0, 0.0]),
        np.array([3500.0, 0.0, 0.0]),
        np.array([0.0, 0.0, 2200.0]),
        80,
        48,
        [0.0, 1.0, 0.0],
        rng=rng,
    )
    door_hole = (wall[:, 0] > 1100) & (wall[:, 0] < 1700) & (wall[:, 2] < 2000)
    window_hole = (wall[:, 0] > 1900) & (wall[:, 0] < 2400) & (wall[:, 2] > 900) & (wall[:, 2] < 1700)
    keep = ~door_hole & ~window_hole
    wall, wall_n = wall[keep], wall_n[keep]
    wall = wall.copy()
    wall[:, 1] += rng.uniform(-25.0, 25.0, len(wall))
    wall_n = wall_n.copy()
    wall_n[:, 0] += rng.normal(0.0, 0.12, len(wall))
    wall_n[:, 2] += rng.normal(0.0, 0.12, len(wall))
    wall_n /= np.linalg.norm(wall_n, axis=1, keepdims=True)
    parts = [(wall, wall_n)]
    parts.append(_grid(np.array([-200.0, 0.0, 0.0]), np.array([3900.0, 0.0, 0.0]), np.array([0.0, 2500.0, 0.0]), 40, 24, [0.0, 0.0, 1.0], rng=rng))
    roof_normal = np.array([0.0, 0.45, 0.89])
    roof_normal = roof_normal / np.linalg.norm(roof_normal)
    roof_v = np.cross(roof_normal, np.array([1.0, 0.0, 0.0]))
    roof_v = roof_v / np.linalg.norm(roof_v) * 300.0
    parts.append(_grid(np.array([200.0, 400.0, 1800.0]), np.array([400.0, 0.0, 0.0]), roof_v, 6, 6, roof_normal, noise=2, rng=rng))
    # Glass set back behind the hole. An empty patch alone is not a window.
    parts.append(_grid(np.array([1920.0, -120.0, 930.0]), np.array([460.0, 0.0, 0.0]), np.array([0.0, 0.0, 740.0]), 8, 12, [0.0, 1.0, 0.0], noise=2, rng=rng))
    points = np.vstack([item[0] for item in parts])
    normals = np.vstack([item[1] for item in parts])
    cameras = np.array([[600.0, 4000.0, 1100.0], [1700.0, 4200.0, 1200.0], [2800.0, 3900.0, 1000.0]])
    sensor_up = np.repeat([[1.0, 0.0, 0.0]], len(cameras), axis=0)
    detected = facade.detect_facade(
        points,
        normals,
        cameras,
        mm_per_unit=1.0,
        up_prior=np.array([0.0, 0.0, 1.0]),
        camera_ups=sensor_up,
        wall_thickness_mm=150.0,
    )
    scene = facade.to_millimetres(detected, 1.0)
    frame = np.asarray(detected["transform_colmap_to_room"], float)[:3, :3]
    assert float(frame[1] @ np.array([0.0, 0.0, 1.0])) > 0.95, (frame, scene["upSource"])
    assert float(frame[2] @ np.array([0.0, 1.0, 0.0])) > 0.95, frame[2]
    assert scene["upAxis"] == "Y"
    assert scene["upSource"].startswith("gravita"), scene["upSource"]
    wall_plane = scene["planes"][0]
    assert wall_plane["role"] == "background" and wall_plane["type"] == "facciata"
    assert abs(wall_plane["widthMm"] - 3500) < 400, wall_plane
    assert abs(wall_plane["heightMm"] - 2200) < 350, wall_plane
    assert wall_plane["normal"][2] > 0.99
    assert wall_plane["support"] > 1500, wall_plane["support"]
    doors = [item for item in scene["openings"] if item["kind"] == "door"]
    windows = [item for item in scene["openings"] if item["kind"] == "window"]
    assert len(doors) == 1, scene["openings"]
    assert abs(doors[0]["widthMm"] - 600) < 180, doors[0]
    assert abs(doors[0]["heightMm"] - 2000) < 250, doors[0]
    assert doors[0]["y0"] < 300, doors[0]
    assert len(windows) == 1, scene["openings"]
    assert abs(windows[0]["widthMm"] - 500) < 180, windows[0]
    assert 500 < windows[0]["heightMm"] < 1200, windows[0]
    assert windows[0]["y0"] > 400, windows[0]
    ground = [plane for plane in scene["planes"] if plane["role"] == "terreno"]
    assert len(ground) == 1 and ground[0]["type"] == "orizzontale", scene["planes"]
    assert not any(plane["type"] == "inclinato" for plane in scene["planes"]), scene["planes"]
    assert any(item.get("reason") == "inclinato" for item in scene["skipped"]), scene["skipped"]
    length, vertical, depth = (float(scene["dims"][key]) for key in ("length_x", "width_y", "height_z"))
    eye, target, view_up = previews.facade_views(length, vertical, depth)["preview_iso.png"]
    assert abs(view_up[1] - 1.0) < 1e-6
    rotation, translation = previews._look_at(eye, target, view_up)

    def image_row(point):
        local = rotation @ point + translation
        return float(local[1] / local[2])

    top = np.array([length / 2.0, vertical * 0.85, 0.0])
    bottom = np.array([length / 2.0, vertical * 0.05, 0.0])
    assert image_row(top) < image_row(bottom)
    print(
        f"z-up facade {wall_plane['widthMm']:.0f} x {wall_plane['heightMm']:.0f} mm, "
        f"up {scene['upAxis']} via {scene['upSource']}, "
        f"door {doors[0]['widthMm']:.0f}x{doors[0]['heightMm']:.0f}, "
        f"window {windows[0]['widthMm']:.0f}x{windows[0]['heightMm']:.0f}"
    )


def check_sparse_patch_not_opening():
    """A missing patch is a lacuna. A thin wing still belongs to the wall.

    The cloud is already Y-up, Z toward the camera. Six points on the left
    are under one percent of the cloud, so a point-count percentile would
    drop that wing. Bins keep it. The empty rectangles have no points behind
    them and no reveal, so they are not cut.
    """
    rng = np.random.default_rng(19)
    wall, wall_n = _grid(
        np.array([0.0, 0.0, 0.0]),
        np.array([4000.0, 0.0, 0.0]),
        np.array([0.0, 2500.0, 0.0]),
        70,
        42,
        [0.0, 0.0, 1.0],
        rng=rng,
    )
    above_picture = (wall[:, 0] > 200) & (wall[:, 0] < 1600) & (wall[:, 1] > 1750) & (wall[:, 1] < 2450)
    interior = (wall[:, 0] > 1700) & (wall[:, 0] < 2450) & (wall[:, 1] > 450) & (wall[:, 1] < 1250)
    door_hole = (wall[:, 0] > 2600) & (wall[:, 0] < 3500) & (wall[:, 1] < 2000)
    keep = ~above_picture & ~interior & ~door_hole
    wall, wall_n = wall[keep], wall_n[keep]
    wing_x = np.linspace(-480.0, -20.0, 6)
    wing = np.stack([wing_x, np.full(6, 1200.0), np.zeros(6)], axis=1)
    wing_n = np.repeat([[0.0, 0.0, 1.0]], 6, axis=0)
    parts = [(wall, wall_n), (wing, wing_n)]
    parts.append(_grid(np.array([2600.0, 0.0, -140.0]), np.array([900.0, 0.0, 0.0]), np.array([0.0, 2000.0, 0.0]), 12, 24, [0.0, 0.0, 1.0], noise=2, rng=rng))
    parts.append(_grid(np.array([4000.0, 0.0, 0.0]), np.array([0.0, 0.0, 800.0]), np.array([0.0, 2400.0, 0.0]), 10, 28, [-1.0, 0.0, 0.0], rng=rng))
    parts.append(_grid(np.array([1500.0, 0.0, 0.0]), np.array([0.0, 0.0, 400.0]), np.array([0.0, 1000.0, 0.0]), 8, 14, [-1.0, 0.0, 0.0], rng=rng))
    parts.append(_grid(np.array([400.0, 700.0, 80.0]), np.array([1400.0, 0.0, 0.0]), np.array([0.0, 0.0, 500.0]), 16, 8, [0.0, 1.0, 0.0], rng=rng))
    # Picture proud of the wall, under the top gap. One edge is not a frame.
    parts.append(_grid(np.array([250.0, 1050.0, 90.0]), np.array([1300.0, 0.0, 0.0]), np.array([0.0, 650.0, 0.0]), 16, 10, [0.0, 0.0, 1.0], noise=2, rng=rng))
    points = np.vstack([item[0] for item in parts])
    normals = np.vstack([item[1] for item in parts])
    cameras = np.array([[800.0, 1400.0, 3200.0], [2000.0, 1300.0, 3400.0], [3400.0, 1500.0, 3000.0]])
    detected = facade.detect_facade(
        points,
        normals,
        cameras,
        mm_per_unit=1.0,
        up_prior=np.array([0.0, 1.0, 0.0]),
        camera_ups=np.repeat([[0.0, 1.0, 0.0]], len(cameras), axis=0),
        wall_thickness_mm=150.0,
    )
    scene = facade.to_millimetres(detected, 1.0)
    wall_plane = next(plane for plane in scene["planes"] if plane["role"] == "background")
    assert wall_plane["widthMm"] > 4300, wall_plane
    assert abs(wall_plane["heightMm"] - 2500) < 250, wall_plane
    assert not any(item["kind"] == "window" for item in scene["openings"]), scene["openings"]
    doors = [item for item in scene["openings"] if item["kind"] == "door"]
    assert len(doors) == 1, scene["openings"]
    assert abs(doors[0]["widthMm"] - 900) < 220, doors[0]
    assert doors[0]["y0"] <= wall_plane["originMm"][1] + 1, doors[0]

    def covers(item, x, y):
        return item["x0"] <= x <= item["x1"] and item["y0"] <= y <= item["y1"]

    lacune = scene["lacune"]
    assert any(item["kind"] == "lacuna" and item.get("reason") == "dati mancanti" and covers(item, 1000, 2100) for item in lacune), lacune
    assert any(item["kind"] == "lacuna" and covers(item, 2300, 800) for item in lacune), lacune
    assert not any(covers(item, 1000, 2100) or covers(item, 2300, 800) for item in scene["openings"])
    returns = [plane for plane in scene["planes"] if plane["role"] == "ritorno"]
    assert len(returns) == 1, scene["planes"]
    assert returns[0]["step"] == "walls" and returns[0]["thicknessMm"] == 150.0, returns[0]
    extras = [plane for plane in scene["planes"] if plane["step"] == "extra"]
    assert len(extras) >= 2, scene["planes"]
    assert all(plane["role"] not in ("background", "terreno", "ritorno") for plane in extras)
    door_cut = walls.opening_cut_bounds(doors[0])
    assert door_cut[2] == doors[0]["y0"] - 20
    window_cut = walls.opening_cut_bounds({"kind": "window", "x0": 100, "x1": 400, "y0": 800, "y1": 1400})
    assert window_cut == (100, 400, 800, 1400)
    print(
        f"sparse facade {wall_plane['widthMm']:.0f} x {wall_plane['heightMm']:.0f} mm, "
        f"door {doors[0]['widthMm']:.0f}x{doors[0]['heightMm']:.0f}, lacune {len(lacune)}, extra {len(extras)}"
    )


def check_imports_and_options():
    assert handler.handler({"input": {}})["ok"] is False
    opt = options.parse_options({"downscale": 3, "wallThicknessMm": 120, "roomOverrides": {"xmin": 1}, "device": "cpu"})
    assert opt.downscale == 3 and opt.wall_thickness_mm == 120 and opt.room_overrides["xmin"] == 1
    assert options.parse_options({}).mode is None
    assert options.parse_options({"mode": "Facciata"}).mode == "facciata"
    assert options.resolve_mode(options.parse_options({}), {"project": {"kind": "facciata"}}) == "facciata"
    assert options.resolve_mode(options.parse_options({"mode": "stanza"}), {"project": {"kind": "facciata"}}) == "stanza"
    assert options.resolve_mode(options.parse_options({}), {"version": 2}) == "stanza"
    try:
        options.parse_options({"mode": "box"})
    except ValueError:
        pass
    else:
        raise AssertionError("mode sconosciuta accettata")
    project_id = "11111111-2222-4333-8444-555555555555"
    photo = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    assert r2.photo_key(project_id, 1, photo) == f"rilievi/{project_id}/foto/001-{photo}.jpg"
    assert r2.result_key(project_id, "walls.step").endswith("/risultati/walls.step")
    modules = [export_mesh, facade, openmvs, options, pipeline, prep, previews, r2, room, scale, sfm, status, walls, test_local]
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
    check_ceiling_fallbacks()
    check_facade()
    check_step()
    print("smoke ok")


if __name__ == "__main__":
    main()
