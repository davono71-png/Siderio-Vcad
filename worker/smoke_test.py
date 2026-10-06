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
    assert abs(residual).sum() > 0


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
    monitor = vertical[0]
    assert abs((_span(monitor, 0)[1] - _span(monitor, 0)[0]) - 450) < 120, monitor
    assert abs((_span(monitor, 1)[1] - _span(monitor, 1)[0]) - 420) < 120, monitor
    assert abs(_span(monitor, 2)[0] - 180) < 40, monitor
    assert monitor["thicknessMm"] == 20.0
    assert any(item["reason"] == "estensione insufficiente" for item in scene["skipped"]), scene["skipped"]
    assert "Piano di fondo" in scene["note"]
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
