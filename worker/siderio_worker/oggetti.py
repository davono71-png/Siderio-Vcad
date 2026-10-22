"""Generic outdoor objects: walls, a shed, ground. Not one facade.

A facade is one background wall, an optional return at one end, and the
ground. A garden has a perimeter wall in any direction and a box-shaped
building. This mode levels the cloud on gravity and the ground, drops
vegetation and isolated noise, and writes closed solids. Whatever is left
and is large enough becomes a tessellated shell, separate from the solids.

Y is up. The main ground is Y=0. X and Z are horizontal, origin at the
minimum corner of the occupied scene.
"""

from __future__ import annotations

import numpy as np

from . import facade

_UP = np.array([0.0, 1.0, 0.0])
_CONVENTION = (
    "Asse verticale: Y. Il terreno principale è Y=0. X e Z sono orizzontali, "
    "origine nell'angolo minimo della scena. Lo spessore dei muri cresce verso l'interno "
    "degli edifici e resta centrato sui muri isolati."
)


def assumptions_hold(
    points,
    normals,
    cameras=None,
    mm_per_unit=None,
    up_prior=None,
    camera_ups=None,
) -> bool:
    """True when the cloud is one background wall plus at most one end return.

    A second vertical structure away from that wall, or three substantial
    directions, is not a facade. The office survey stays a facade.
    """
    cloud = np.asarray(points, float)
    norms = _unit_rows(np.asarray(normals, float))
    if len(cloud) < 80 or len(norms) != len(cloud):
        return True
    span = float(np.linalg.norm(np.percentile(cloud, 95, axis=0) - np.percentile(cloud, 5, axis=0)))
    if span < 1e-8:
        return True
    cameras_arr = np.asarray(cameras, float).reshape(-1, 3) if cameras is not None and len(cameras) else np.zeros((0, 3))
    up, _source = facade._estimate_up(cloud, norms, cameras_arr, camera_ups, up_prior, mm_per_unit, span)
    level = facade._level_rotation(up)
    centre = cameras_arr.mean(0) if len(cameras_arr) else cloud.mean(0)
    leveled = (cloud - centre) @ level.T
    dirs = norms @ level.T
    scale = float(mm_per_unit) if mm_per_unit else 1.0
    xyz = leveled * scale
    vertical = np.abs(dirs[:, 1]) <= 0.34
    count = int(vertical.sum())
    if count < 120:
        return False
    groups = _direction_groups(xyz[vertical], dirs[vertical])
    if not groups:
        return False
    groups.sort(key=lambda item: item["count"], reverse=True)
    dominant = groups[0]
    if dominant["count"] < 0.46 * count:
        return False
    others = [item for item in groups[1:] if item["count"] >= 0.12 * count and _angle_mod_pi(item["yaw"], dominant["yaw"]) > np.radians(28)]
    for extra in others:
        share = extra["count"] / count
        if share >= 0.22 and extra["count"] > 0.45 * dominant["count"]:
            return False
        if not _return_at_end(dominant, extra):
            return False
    if len(others) >= 2:
        return False
    if _separated_structures(xyz[vertical], cell=450.0, bridge=1600.0):
        return False
    return True


def facade_result_holds(model: dict) -> bool:
    """False when the fitted background is a huge plane with almost no points.

    The office wall is dense and is the surface the photos look at. A garden
    run as a facade picks a 40 m plane with a few hundred points while the
    shed and the perimeter wall, much denser, are dumped in front of it.
    """
    planes = model.get("planes") or []
    background = next((plane for plane in planes if plane.get("role") == "background"), None)
    if background is None:
        return False
    support = int(background.get("support") or 0)
    scale = float(model.get("mm_per_unit") or 1.0)
    width_mm = float(background.get("width") or 0.0) * scale
    others = [
        int(plane.get("support") or 0)
        for plane in planes
        if plane.get("role") not in ("background", "terreno")
    ]
    best = max(others, default=0)
    if width_mm > 25000 and support < 2000:
        return False
    if support < 800 and best > max(1500, support * 5):
        return False
    return support >= 600


def detect_oggetti(
    points,
    normals,
    cameras=None,
    mm_per_unit=None,
    up_prior=None,
    wall_thickness_mm=150.0,
    camera_ups=None,
    fallback_from=None,
):
    """Level, reconstruct, and return a scene in model units plus millimetre solids."""
    cloud = np.asarray(points, float)
    norms = _unit_rows(np.asarray(normals, float))
    if len(cloud) < 80:
        raise RuntimeError("La nuvola è troppo povera per ricostruire gli oggetti.")
    span = float(np.linalg.norm(np.percentile(cloud, 95, axis=0) - np.percentile(cloud, 5, axis=0)))
    cameras_arr = np.asarray(cameras, float).reshape(-1, 3) if cameras is not None and len(cameras) else np.zeros((0, 3))
    up, up_source = facade._estimate_up(cloud, norms, cameras_arr, camera_ups, up_prior, mm_per_unit, span)
    level = facade._level_rotation(up)
    centre = cameras_arr.mean(0) if len(cameras_arr) else cloud.mean(0)
    leveled = (cloud - centre) @ level.T
    dirs = norms @ level.T
    scale = float(mm_per_unit) if mm_per_unit else 1.0
    built = reconstruct_mm(leveled * scale, dirs, wall_thickness_mm=wall_thickness_mm)
    shift_mm = np.asarray(built["shift"], float)
    transform = np.eye(4)
    transform[:3, :3] = level
    transform[:3, 3] = -level @ centre + shift_mm / scale
    dims_mm = built["dims"]
    bounds_mm = built.get("bounds_mm")
    note = built["note"]
    if fallback_from == "facciata":
        note = (
            "Non è un solo muro di fondo: la modalità facciata passa agli oggetti. " + note
        )
    return {
        "units": "model",
        "mode": "oggetti",
        "mm_per_unit": scale,
        "upSource": up_source,
        "upAxis": "Y",
        "transform_colmap_to_room": transform.tolist(),
        "convention": _CONVENTION,
        "dims": {key: float(value) / scale for key, value in dims_mm.items()},
        "bounds": (
            {key: [float(v) / scale for v in bounds_mm[key]] for key in ("min", "max")}
            if bounds_mm
            else None
        ),
        "solids_mm": _to_builtin(built["solids"]),
        "openings_mm": _to_builtin(built["openings"]),
        "residual_mm": built["residual"],
        "fallbackFrom": fallback_from,
        "note": note,
        "dropped": built["dropped"],
    }


def to_millimetres(scene: dict, mm_per_unit: float | None = None) -> dict:
    """Scene document for scene.json. Solids are already millimetres."""
    del mm_per_unit
    dims = scene.get("dims_mm") or _dims_from_model(scene)
    solids = []
    for solid in scene.get("solids_mm") or []:
        item = {
            "name": solid["name"],
            "role": solid["role"],
            "kind": solid["kind"],
            "widthMm": round(float(solid.get("width", 0.0)), 1),
            "heightMm": round(float(solid.get("height", 0.0)), 1),
            "thicknessMm": round(float(solid.get("thickness", 0.0)), 1),
        }
        if solid.get("kind") == "box":
            item["originMm"] = [round(float(v), 1) for v in solid["origin"]]
            item["axisU"] = [round(float(v), 6) for v in solid["axisU"]]
            item["axisV"] = [round(float(v), 6) for v in solid["axisV"]]
            item["normal"] = [round(float(v), 6) for v in solid["normal"]]
        solids.append(item)
    return {
        "units": "mm",
        "mode": "oggetti",
        "mm_per_unit": scene.get("mm_per_unit"),
        "upSource": scene.get("upSource"),
        "upAxis": "Y",
        "convention": scene.get("convention") or _CONVENTION,
        "note": scene.get("note") or "",
        "fallbackFrom": scene.get("fallbackFrom"),
        "dims": {key: round(float(value), 1) for key, value in dims.items()},
        "solids": solids,
        "openings": scene.get("openings_mm") or [],
        "dropped": scene.get("dropped") or [],
        "planes": _planes_for_view(scene.get("solids_mm") or []),
    }


def reconstruct_mm(points, normals, wall_thickness_mm=150.0) -> dict:
    """Y-up cloud in millimetres. The main ground is Y=0. X/Z start at the occupied minimum.

    One dominant ground, at most one extra terrace, roofs that are real slabs
    (nothing continues above them), thin caps as walls, thick footprints as
    buildings. Vertical faces are accepted only when they are filled sheets.
    """
    cloud = np.asarray(points, float)
    dirs = _unit_rows(np.asarray(normals, float))
    sample, dirs = _prepare(cloud, dirs, voxel=70.0, min_count=3)
    grounds = _ground_planes(sample, dirs)
    main_y = float(grounds[0]["y"]) if grounds else float(np.percentile(sample[:, 1], 8))
    shift = np.array([
        -float(np.percentile(sample[:, 0], 1)),
        -main_y,
        -float(np.percentile(sample[:, 2], 1)),
    ])
    sample = sample + shift
    for plane in grounds:
        plane["y"] = float(plane["y"] + shift[1])
        plane["xz"] = plane["xz"] + shift[[0, 2]]
        plane["polygon"] = _hull(plane["xz"], cell=480.0)
    if grounds:
        grounds[0]["y"] = 0.0
    caps = _elevated_slabs(sample, dirs, grounds)
    buildings = []
    footprints = []
    walls = []
    slabs = []
    for cap in caps:
        base = _support_y(cap["centre"], cap["y"], grounds)
        height = float(cap["y"] - base)
        split = _split_thick(cap["xz"], 180.0)
        blob = split["blob"]
        made_building = False
        if blob is not None and len(blob) >= 12 and height >= 850:
            building = _building_from_blob(blob, float(cap["y"]), base, wall_thickness_mm)
            centre = np.mean(np.asarray(building["footprint"], float), axis=0) if building is not None else None
            if building is not None and not _near_footprint(centre, footprints, margin=600):
                buildings.append(building)
                footprints.append(building["footprint"])
                made_building = True
        if not made_building:
            wall = _wall_from_cap(cap["xz"], float(cap["y"]), base, wall_thickness_mm)
            if wall is not None and _cap_is_wall(sample, dirs, cap["xz"], base, float(cap["y"])):
                walls.append(wall)
            elif 300 <= height <= 900 and cap["area"] >= 1_800_000 and _above_fraction(sample, cap) < 0.12:
                slabs.append(cap)
        thin = split["thin"]
        if thin is not None and len(thin) >= 8:
            for component in _components_xz(thin, 220.0):
                piece = thin[component]
                wall = _wall_from_cap(piece, float(cap["y"]), base, wall_thickness_mm)
                if wall is not None and _cap_is_wall(sample, dirs, piece, base, float(cap["y"])):
                    walls.append(wall)
    roof_line = max([float(building["roofY"]) for building in buildings], default=2200.0)
    for plane in _vertical_sheets(sample, dirs, grounds):
        if _covered_by_building(plane, footprints):
            continue
        # A face much taller than every roof is the edge of a canopy, not a wall.
        if float(plane["y1"]) > roof_line + 700 and float(plane["height"]) > min(roof_line + 500, 1900):
            continue
        base = _support_y(np.asarray(plane["centre"], float)[[0, 2]], float(plane["y1"]), grounds)
        if float(plane["y0"]) > base + 180 and float(plane["y0"]) < base + 900:
            origin = np.array(plane["origin"], float)
            origin[1] = base
            plane["origin"] = origin
            plane["height"] = float(plane["y1"]) - base
            plane["y0"] = base
        walls.append(_wall_from_plane(plane, wall_thickness_mm))
    walls = [wall for wall in walls if not _near_footprint(_box_centre(wall)[[0, 2]], footprints, margin=350)]
    walls = _dedupe_walls(walls)[:8]
    solids = []
    solids.extend(_ground_solids(grounds))
    solids.extend(_slab_solids(slabs))
    for index, wall in enumerate(walls, start=1):
        wall["name"] = f"muro_{index}"
        wall["role"] = "muro"
        solids.append(wall)
    openings = []
    for index, building in enumerate(buildings, start=1):
        building["name"] = f"edificio_{index}"
        building["role"] = "edificio"
        found = _openings_for_building(sample, building)
        building["openings"] = found
        openings.extend({"building": building["name"], **item} for item in found)
        solids.append(building)
    explained = _explained_mask(sample, solids)
    residual, dropped = _residual_points(sample, explained)
    dims, bounds = _scene_dims(sample, solids)
    note = _note(solids, openings, dropped, residual)
    print(f"[oggetti] {note}", flush=True)
    return {
        "shift": shift.tolist(),
        "dims": dims,
        "bounds_mm": bounds,
        "solids": solids,
        "openings": openings,
        "residual": residual,
        "dropped": dropped,
        "note": note,
    }


def _dims_from_model(scene: dict) -> dict:
    scale = float(scene.get("mm_per_unit") or 1.0)
    dims = scene.get("dims") or {}
    return {key: float(dims.get(key, 0.0)) * scale for key in ("length_x", "width_y", "height_z")}


def _planes_for_view(solids: list[dict]) -> list[dict]:
    """Boxes the results page can draw. A building is its walls and its roof."""
    listed = []
    for solid in solids:
        if solid.get("kind") == "box":
            listed.append(_box_plane(solid, solid.get("role"), solid.get("name")))
        elif solid.get("kind") == "building":
            for part in solid.get("parts") or []:
                listed.append(_box_plane(part, solid.get("role"), solid.get("name")))
        elif solid.get("kind") == "slab":
            polygon = np.asarray(solid.get("polygon") or [], float)
            if len(polygon) < 3:
                continue
            x0, z0 = polygon.min(0)
            x1, z1 = polygon.max(0)
            thickness = float(solid.get("thickness") or 80.0)
            y = float(solid.get("y") or 0.0)
            listed.append(
                {
                    "role": solid.get("role"),
                    "name": solid.get("name"),
                    "type": solid.get("role"),
                    "widthMm": round(float(x1 - x0), 1),
                    "heightMm": round(float(z1 - z0), 1),
                    "thicknessMm": round(thickness, 1),
                    "originMm": [round(float(x0), 1), round(y - thickness, 1), round(float(z0), 1)],
                    "axisU": [1.0, 0.0, 0.0],
                    "axisV": [0.0, 0.0, 1.0],
                    "normal": [0.0, 1.0, 0.0],
                    "step": "walls",
                }
            )
    return listed


def _box_plane(box: dict, role, name) -> dict:
    return {
        "role": role,
        "name": name,
        "type": role,
        "widthMm": round(float(box.get("width", 0.0)), 1),
        "heightMm": round(float(box.get("height", 0.0)), 1),
        "thicknessMm": round(float(box.get("thickness", 0.0)), 1),
        "originMm": [round(float(v), 1) for v in box["origin"]],
        "axisU": [round(float(v), 6) for v in box["axisU"]],
        "axisV": [round(float(v), 6) for v in box["axisV"]],
        "normal": [round(float(v), 6) for v in box["normal"]],
        "step": "walls",
    }


def _to_builtin(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, dict):
        return {key: _to_builtin(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_builtin(item) for item in value]
    return value


def _prepare(points, normals, voxel, min_count=1):
    means, inverse, counts, keys = _voxel_means(points, voxel)
    nsum = np.column_stack([np.bincount(inverse, weights=normals[:, axis]) for axis in range(3)])
    length = np.linalg.norm(nsum, axis=1)
    averaged = nsum / np.maximum(length, 1e-12)[:, None]
    dense = counts >= int(min_count)
    if int(dense.sum()) < max(80, 0.12 * len(means)):
        # A sparse sample (tests, a thin survey) has no dense core. Keep it all.
        keep = np.ones(len(means), dtype=bool)
    else:
        # Keep the dense core and the voxels that touch it, so a thin wall next to
        # the terrace is not dropped with the crop-margin noise.
        keys_i = keys.astype(int)
        occupied = {tuple(map(int, key)) for key in keys_i[dense]}
        keep = np.zeros(len(means), dtype=bool)
        for index, key in enumerate(keys_i):
            base = (int(key[0]), int(key[1]), int(key[2]))
            if any((base[0] + dx, base[1] + dy, base[2] + dz) in occupied for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)):
                keep[index] = True
    means, averaged, keys = means[keep], averaged[keep], keys[keep]
    vertical = float((np.abs(averaged[:, 1]) <= 0.34).mean()) if len(averaged) else 0.0
    if vertical < 0.04 and len(means):
        averaged = _pca_normals(points, means, keys, voxel)
    if len(means) > 80:
        labels = _component_labels(means[:, [0, 2]], max(float(voxel) * 5.0, 400.0))
        mask = np.zeros(len(means), dtype=bool)
        for label in np.unique(labels):
            chosen = labels == label
            area = _occupied_area(means[chosen][:, [0, 2]], 400.0)
            if area >= 1_200_000 or int(chosen.sum()) >= 150:
                mask |= chosen
        if int(mask.sum()) >= 40:
            means, averaged = means[mask], averaged[mask]
    return means, _unit_rows(averaged)


def _voxel_means(points, voxel):
    keys = np.floor(np.asarray(points, float) / float(voxel)).astype(np.int64)
    _, index, inverse, counts = np.unique(keys, axis=0, return_index=True, return_inverse=True, return_counts=True)
    means = np.column_stack([np.bincount(inverse, weights=points[:, axis]) / counts for axis in range(3)])
    return means, inverse, counts, keys[index]


def _pca_normals(points, means, keys, voxel):
    buckets: dict[tuple[int, int, int], list[int]] = {}
    point_keys = np.floor(points / float(voxel)).astype(np.int64)
    for index, key in enumerate(point_keys):
        buckets.setdefault((int(key[0]), int(key[1]), int(key[2])), []).append(index)
    normals = np.tile(_UP, (len(means), 1))
    for index, key in enumerate(keys):
        chosen = []
        base = (int(key[0]), int(key[1]), int(key[2]))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    chosen.extend(buckets.get((base[0] + dx, base[1] + dy, base[2] + dz), ()))
        if len(chosen) < 8:
            continue
        samples = points[np.asarray(chosen[:800], int)]
        centered = samples - samples.mean(0)
        _, _, vt = np.linalg.svd(centered, full_matrices=False)
        normal = vt[-1]
        if normal[1] < 0:
            normal = -normal
        normals[index] = normal
    return _unit_rows(normals)


def _ground_planes(points, normals):
    """Largest horizontal support, plus at most one terrace on another level."""
    mask = np.abs(normals[:, 1]) >= 0.78
    if int(mask.sum()) < 40:
        y = float(np.percentile(points[:, 1], 8))
        return [{"y": y, "xz": points[:, [0, 2]], "area": _occupied_area(points[:, [0, 2]], 400.0), "count": len(points)}]
    horizontal = points[mask]
    y0 = float(horizontal[:, 1].min())
    bin_w = 110.0
    bins = np.floor((horizontal[:, 1] - y0) / bin_w).astype(int)
    bins = np.clip(bins, 0, None)
    counts = np.bincount(bins)
    peaks = []
    for index, count in enumerate(counts):
        if count < max(50, 0.025 * len(horizontal)):
            continue
        left = counts[index - 1] if index else 0
        right = counts[index + 1] if index + 1 < len(counts) else 0
        if count >= left and count >= right:
            peaks.append(y0 + (index + 0.5) * bin_w)
    candidates = []
    for peak in peaks:
        band = horizontal[np.abs(horizontal[:, 1] - peak) < 190.0]
        if len(band) < 40:
            continue
        components = _components_xz(band[:, [0, 2]], 420.0)
        if not components:
            continue
        best = max(components, key=len)
        taken = band[best]
        area = _occupied_area(taken[:, [0, 2]], 420.0)
        if area < 2_200_000 or len(taken) < 35:
            continue
        height = float(np.median(taken[:, 1]))
        if float(np.median(np.abs(taken[:, 1] - height))) > 130:
            continue
        below = _count_below(points, taken[:, [0, 2]], height, 420.0)
        if below > max(120, 0.28 * len(taken)):
            continue
        candidates.append({"y": height, "xz": taken[:, [0, 2]], "area": area, "count": len(taken)})
    if not candidates:
        height = float(np.percentile(points[:, 1], 8))
        return [{"y": height, "xz": points[:, [0, 2]], "area": _occupied_area(points[:, [0, 2]], 400.0), "count": len(points)}]
    candidates.sort(key=lambda item: item["area"], reverse=True)
    kept = [candidates[0]]
    for extra in candidates[1:]:
        if any(abs(extra["y"] - item["y"]) < 320 for item in kept):
            continue
        if extra["area"] < 3_200_000 or extra["area"] < 0.12 * kept[0]["area"]:
            continue
        if abs(extra["y"] - kept[0]["y"]) < 420:
            continue
        kept.append(extra)
        if len(kept) == 2:
            break
    kept.sort(key=lambda item: item["area"], reverse=True)
    return kept


def _elevated_slabs(points, normals, grounds):
    """Horizontal caps with open sky above them: roofs and wall tops, not canopies."""
    mask = np.abs(normals[:, 1]) >= 0.75
    if int(mask.sum()) < 25:
        return []
    chosen = points[mask]
    support = np.array([_support_y(point[[0, 2]], float(point[1]), grounds) for point in chosen])
    elevated = chosen[:, 1] > support + 520.0
    chosen = chosen[elevated]
    if len(chosen) < 25:
        return []
    y0 = float(chosen[:, 1].min())
    bin_w = 120.0
    bins = np.clip(np.floor((chosen[:, 1] - y0) / bin_w).astype(int), 0, None)
    counts = np.bincount(bins)
    slabs = []
    for index, count in enumerate(counts):
        if count < 20:
            continue
        left = counts[index - 1] if index else 0
        right = counts[index + 1] if index + 1 < len(counts) else 0
        if count < left or count < right:
            continue
        peak = y0 + (index + 0.5) * bin_w
        band = chosen[np.abs(chosen[:, 1] - peak) < 150.0]
        for component in _components_xz(band[:, [0, 2]], 240.0):
            if len(component) < 12:
                continue
            taken = band[component]
            area = _occupied_area(taken[:, [0, 2]], 240.0)
            if area < 650_000:
                continue
            height = float(np.median(taken[:, 1]))
            if float(np.percentile(taken[:, 1], 90) - np.percentile(taken[:, 1], 10)) > 260:
                continue
            cap = {"y": height, "xz": taken[:, [0, 2]], "area": area, "centre": taken[:, [0, 2]].mean(0)}
            if _above_fraction(points, cap) > 0.22:
                continue
            slabs.append(cap)
    slabs.sort(key=lambda item: item["area"], reverse=True)
    kept = []
    for slab in slabs:
        if any(abs(slab["y"] - other["y"]) < 200 and _mostly_inside(slab["xz"], other["xz"], margin=300) for other in kept):
            continue
        kept.append(slab)
        if len(kept) == 6:
            break
    return kept


def _above_fraction(points, cap):
    xz = cap["xz"]
    if len(xz) < 8:
        return 1.0
    origin = xz.min(0)
    cell = 280.0
    keys = {tuple(map(int, key)) for key in np.floor((xz - origin) / cell)}
    query = np.floor((points[:, [0, 2]] - origin) / cell).astype(int)
    inside = np.array([tuple(key) in keys for key in query], dtype=bool)
    height = float(cap["y"])
    slab = int(np.sum(inside & (np.abs(points[:, 1] - height) < 160)))
    above = int(np.sum(inside & (points[:, 1] > height + 220) & (points[:, 1] < height + 1800)))
    return above / max(slab, 1)


def _support_y(xz, feature_y, grounds):
    """Highest ground still clearly under this feature."""
    point = np.asarray(xz, float)
    best = None
    for ground in grounds:
        polygon = ground.get("polygon")
        if polygon is not None and len(polygon) >= 3:
            if not _polygon_contains(polygon, point) and _distance_to_polygon(polygon, point) > 1200:
                continue
        elif len(ground["xz"]):
            delta = ground["xz"] - point
            if float(np.min(np.linalg.norm(delta, axis=1))) > 1500:
                continue
        if float(ground["y"]) > feature_y - 450:
            continue
        if best is None or float(ground["y"]) > best:
            best = float(ground["y"])
    if best is None and grounds:
        return float(grounds[0]["y"])
    return 0.0 if best is None else best


def _cap_is_wall(points, normals, xz, base, top):
    """Wall tops stay under 2 m. Taller lids are canopy, and a real tall face is a sheet."""
    del points, normals, xz
    return 450 < float(top) - float(base) <= 2000


def _wall_from_cap(xz, top, base, thickness):
    if xz is None or len(xz) < 8:
        return None
    centre, axis_u, axis_w, length, width = _obb(xz)
    short = min(length, width)
    long = max(length, width)
    if long < 1300 or short > 1100 or long < short * 2.3:
        return None
    if float(top) < float(base) + 500:
        return None
    direction = axis_u if length >= width else axis_w
    direction = _unit(np.array([direction[0], 0.0, direction[1]]))
    normal = _unit(np.array([-direction[2], 0.0, direction[0]]))
    start = np.array([centre[0], float(base), centre[1]]) - direction * (long / 2.0) - normal * (float(thickness) / 2.0)
    return _box(start, direction, _UP, normal, long, float(top) - float(base), float(thickness))


def _vertical_sheets(points, normals, grounds):
    """Filled vertical faces. Ground edges and diagonal noise stay out."""
    support = np.array([_support_y(point[[0, 2]], float(point[1]), grounds) for point in points])
    mask = (np.abs(normals[:, 1]) <= 0.32) & (points[:, 1] > support + 380.0)
    if int(mask.sum()) < 40:
        return []
    selected = points[mask]
    dirs = normals[mask]
    horizontal = dirs.copy()
    horizontal[:, 1] = 0
    length = np.linalg.norm(horizontal, axis=1)
    keep = length > 0.25
    selected = selected[keep]
    horizontal = horizontal[keep] / length[keep, None]
    yaw = np.arctan2(horizontal[:, 2], horizontal[:, 0]) % np.pi
    bins = np.floor(yaw / np.radians(12)).astype(int)
    planes = []
    for bin_id in np.unique(bins):
        group = selected[bins == bin_id]
        normals_g = horizontal[bins == bin_id]
        if len(group) < 30:
            continue
        normal = _unit(np.median(normals_g, axis=0))
        offsets = group @ normal
        for peak in _peaks_1d(offsets, 80.0, 28):
            band = group[np.abs(offsets - peak) < 70.0]
            if len(band) < 28:
                continue
            plane = _measure_vertical(band, normal, peak)
            if plane is not None and _sheet_support(points, plane):
                planes.append(plane)
    return _merge_parallel_planes(planes)


def _sheet_support(points, plane):
    """A wall is a sheet. A slice through a tree fails this."""
    origin = np.asarray(plane["origin"], float)
    axis = np.asarray(plane["axis"], float)
    normal = np.asarray(plane["normal"], float)
    delta = points - origin
    along = delta @ axis
    dist = np.abs(delta @ normal)
    height = points[:, 1]
    rect = (along > -80) & (along < plane["length"] + 80) & (height > plane["y0"] - 80) & (height < plane["y1"] + 80)
    near = int(np.sum(rect & (dist < 150)))
    wide = int(np.sum(rect & (dist < 1100)))
    if wide < 20:
        return False
    return near >= 0.58 * wide


def _split_thick(xz, cell):
    if len(xz) < 8:
        return {"blob": None, "thin": xz}
    origin = xz.min(0) - cell
    keys = np.floor((xz - origin) / cell).astype(int)
    cells = {(int(i), int(j)) for i, j in keys}
    interior = set()
    for i, j in cells:
        if all((i + di, j + dj) in cells for di in (-1, 0, 1) for dj in (-1, 0, 1)):
            interior.add((i, j))
    if len(interior) < 4:
        return {"blob": None, "thin": xz}
    blob_cells = set()
    for i, j in interior:
        for di in range(-2, 3):
            for dj in range(-2, 3):
                neighbour = (i + di, j + dj)
                if neighbour in cells:
                    blob_cells.add(neighbour)
    blob = xz[np.array([tuple(key) in blob_cells for key in keys])]
    return {"blob": blob, "thin": xz[np.array([tuple(key) not in blob_cells for key in keys])]}


def _building_from_blob(xz, roof_y, base_y, thickness_mm):
    centre, axis_u, axis_w, length, width = _obb(xz)
    short = min(length, width)
    long = max(length, width)
    if short < 650 or long < 900 or short * long < 1_000_000:
        return None
    if long > short * 5.2:
        return None
    thick = min(float(thickness_mm), max(40.0, short * 0.12))
    roof_t = min(120.0, max(50.0, thick * 0.7))
    y0 = float(base_y)
    y1 = float(roof_y)
    if y1 < y0 + 850:
        return None
    corners = _rectangle(centre, axis_u, axis_w, length, width)
    parts = []
    for index in range(4):
        start = corners[index]
        end = corners[(index + 1) % 4]
        parts.append(_wall_between(start, end, y0, y1, thick, inward=True, polygon=corners))
    parts.append(_roof_box(corners, y1, roof_t))
    return {
        "kind": "building",
        "parts": parts,
        "footprint": corners,
        "width": float(long),
        "height": float(y1 - y0),
        "thickness": float(thick),
        "roofY": float(y1),
        "baseY": float(y0),
        "openings": [],
    }


def _rectangle(centre, axis_u, axis_w, length, width):
    centre = np.asarray(centre, float)
    axis_u = np.asarray(axis_u, float)
    axis_w = np.asarray(axis_w, float)
    half_u = 0.5 * float(length)
    half_w = 0.5 * float(width)
    return [
        centre - axis_u * half_u - axis_w * half_w,
        centre + axis_u * half_u - axis_w * half_w,
        centre + axis_u * half_u + axis_w * half_w,
        centre - axis_u * half_u + axis_w * half_w,
    ]


def _wall_between(start, end, y0, y1, thickness, inward, polygon):
    start = np.asarray(start, float)
    end = np.asarray(end, float)
    edge = end - start
    length = float(np.linalg.norm(edge))
    direction = edge / max(length, 1e-8)
    left = np.array([-direction[1], direction[0]])
    midpoint = (start + end) / 2.0
    # A CCW footprint has the interior on the left of each edge.
    inside = _polygon_contains(polygon, midpoint + left * 20.0)
    inward_dir = left if inside else -left
    normal = inward_dir if inward else -inward_dir
    direction3 = np.array([direction[0], 0.0, direction[1]])
    origin = np.array([start[0], y0, start[1]])
    overlap = float(thickness) if inward else 0.0
    if inward:
        # Face on the outside, thickness grows inward. Overlap the corners so the fuse is closed.
        origin = origin - direction3 * overlap
        length = length + 2.0 * overlap
    else:
        origin = origin - np.array([normal[0], 0.0, normal[1]]) * (thickness / 2.0)
    return _box(origin, direction3, _UP, np.array([normal[0], 0.0, normal[1]]), length, y1 - y0, thickness)


def _roof_box(corners, roof_y, thickness):
    start = np.asarray(corners[0], float)
    edge_u = np.asarray(corners[1] - corners[0], float)
    edge_v = np.asarray(corners[3] - corners[0], float)
    length = float(np.linalg.norm(edge_u))
    width = float(np.linalg.norm(edge_v))
    axis_u = np.array([edge_u[0] / max(length, 1e-8), 0.0, edge_u[1] / max(length, 1e-8)])
    axis_v = np.array([edge_v[0] / max(width, 1e-8), 0.0, edge_v[1] / max(width, 1e-8)])
    origin = np.array([start[0], float(roof_y) - float(thickness), start[1]])
    return _box(origin, axis_u, axis_v, _UP, length, width, thickness)


def _box(origin, axis_u, axis_v, normal, width, height, thickness):
    """Right-handed box. Thickness grows along ``normal`` and height along ``axis_v``."""
    origin = np.asarray(origin, float).copy()
    axis_u = _unit(axis_u)
    normal = _unit(normal)
    desired_v = _unit(axis_v)
    axis_v = _unit(np.cross(normal, axis_u))
    if float(np.dot(axis_v, desired_v)) < 0:
        # Reverse the long edge so the height axis matches, without flipping the thickness.
        origin = origin + axis_u * float(width)
        axis_u = -axis_u
        axis_v = _unit(np.cross(normal, axis_u))
    return {
        "kind": "box",
        "origin": origin.tolist(),
        "axisU": axis_u.tolist(),
        "axisV": axis_v.tolist(),
        "normal": normal.tolist(),
        "width": float(width),
        "height": float(height),
        "thickness": float(thickness),
    }


def _measure_vertical(points, normal, offset):
    del offset
    normal = _unit(normal)
    axis = _unit(np.array([-normal[2], 0.0, normal[0]]))
    centre = points.mean(0)
    along = (points - centre) @ axis
    y = points[:, 1]
    u0, u1 = np.percentile(along, [5, 95])
    y0, y1 = np.percentile(y, [5, 95])
    length = float(u1 - u0)
    height = float(y1 - y0)
    if length < 1100 or height < 650:
        return None
    cell = 220.0
    ui = np.floor((along - u0) / cell).astype(int)
    vi = np.floor((y - y0) / cell).astype(int)
    occupied = len(np.unique(np.column_stack([ui, vi]), axis=0))
    cells = max(1, int(np.ceil(length / cell)) * int(np.ceil(height / cell)))
    if occupied / cells < 0.22:
        return None
    point_on_plane = centre - normal * (float(centre @ normal) - float(np.median(points @ normal)))
    residual = np.abs((points - point_on_plane) @ normal)
    if float(np.median(residual)) > 65:
        return None
    rel_centre = float((point_on_plane - centre) @ axis)
    start = point_on_plane - axis * (rel_centre - float(u0))
    start[1] = float(y0)
    return {
        "origin": start,
        "axis": axis,
        "normal": normal,
        "length": length,
        "height": height,
        "y0": float(y0),
        "y1": float(y1),
        "count": int(len(points)),
        "centre": point_on_plane,
    }


def _merge_parallel_planes(planes):
    kept = []
    for plane in sorted(planes, key=lambda item: item["length"] * item["height"], reverse=True):
        if any(_same_plane(plane, other) for other in kept):
            continue
        kept.append(plane)
    return kept


def _same_plane(left, right):
    if abs(float(np.dot(left["normal"], right["normal"]))) < np.cos(np.radians(18)):
        return False
    if abs(float(left["centre"] @ left["normal"] - right["centre"] @ left["normal"])) > 220:
        return False
    return True


def _wall_from_plane(plane, thickness):
    normal = np.asarray(plane["normal"], float)
    axis = np.asarray(plane["axis"], float)
    origin = np.asarray(plane["origin"], float) - normal * (float(thickness) / 2.0)
    return _box(origin, axis, _UP, normal, plane["length"], plane["height"], float(thickness))


def _count_below(points, xz, y, cell):
    if len(xz) < 10:
        return 0
    origin = xz.min(0)
    keys = {tuple(map(int, key)) for key in np.floor((xz - origin) / cell)}
    query = np.floor((points[:, [0, 2]] - origin) / cell).astype(int)
    inside = np.fromiter((tuple(key) in keys for key in query), dtype=bool, count=len(query))
    return int(np.sum(inside & (points[:, 1] < y - 400) & (points[:, 1] > y - 4500)))


def _mostly_inside(xz, other, margin=400.0):
    if len(xz) == 0 or len(other) == 0:
        return False
    low = other.min(0) - margin
    high = other.max(0) + margin
    inside = (xz[:, 0] >= low[0]) & (xz[:, 0] <= high[0]) & (xz[:, 1] >= low[1]) & (xz[:, 1] <= high[1])
    return float(np.mean(inside)) > 0.75


def _dedupe_walls(walls):
    kept = []
    for wall in sorted(walls, key=lambda item: item["width"], reverse=True):
        if any(_walls_overlap(wall, other) for other in kept):
            continue
        kept.append(wall)
    return kept


def _walls_overlap(left, right):
    if abs(float(np.dot(left["normal"], right["normal"]))) < np.cos(np.radians(22)):
        return False
    left_c = _box_centre(left)
    right_c = _box_centre(right)
    delta = left_c - right_c
    if abs(float(np.dot(delta, left["normal"]))) > 280:
        return False
    along = abs(float(np.dot(delta, left["axisU"])))
    return along < 0.55 * (left["width"] + right["width"])


def _box_centre(box):
    origin = np.asarray(box["origin"], float)
    return origin + np.asarray(box["axisU"], float) * (box["width"] / 2) + np.asarray(box["axisV"], float) * (box["height"] / 2) + np.asarray(box["normal"], float) * (box["thickness"] / 2)


def _ground_solids(grounds):
    solids = []
    ordered = sorted(grounds, key=lambda item: item["area"], reverse=True)
    for index, ground in enumerate(ordered, start=1):
        polygon = ground.get("polygon")
        if polygon is None:
            polygon = _hull(ground["xz"], cell=480.0)
        polygon = np.asarray(polygon, float) if polygon is not None else None
        if polygon is None or len(polygon) < 3:
            continue
        name = "terreno" if index == 1 else f"terreno_{index}"
        solids.append(
            {
                "name": name,
                "role": "terreno",
                "kind": "slab",
                "polygon": polygon.tolist(),
                "y": 0.0 if index == 1 else float(ground["y"]),
                "thickness": 80.0,
                "width": float(polygon[:, 0].max() - polygon[:, 0].min()),
                "height": float(polygon[:, 1].max() - polygon[:, 1].min()),
            }
        )
    return solids


def _slab_solids(slabs):
    solids = []
    for index, slab in enumerate(slabs, start=1):
        polygon = _hull(slab["xz"])
        if polygon is None:
            continue
        solids.append(
            {
                "name": f"soletta_{index}",
                "role": "soletta",
                "kind": "slab",
                "polygon": polygon.tolist(),
                "y": float(slab["y"]),
                "thickness": 80.0,
                "width": float(polygon[:, 0].max() - polygon[:, 0].min()),
                "height": float(polygon[:, 1].max() - polygon[:, 1].min()),
            }
        )
    return solids


def _openings_for_building(points, building):
    openings = []
    parts = building["parts"]
    # The first four parts are the walls. The last is the roof.
    for index, part in enumerate(parts[:4]):
        opening = _opening_on_box(points, part, building["baseY"], building["roofY"])
        if opening is None:
            continue
        opening["wall"] = index
        openings.append(opening)
        break
    return openings


def _opening_on_box(points, box, y0, y1):
    origin = np.asarray(box["origin"], float)
    axis = np.asarray(box["axisU"], float)
    normal = np.asarray(box["normal"], float)
    length = float(box["width"])
    if length < 1100 or y1 - y0 < 1500:
        return None
    delta = points - origin
    along = delta @ axis
    height = points[:, 1] - y0
    # Distance to the outer face. Thickness grows along normal, so the face is at 0.
    face_dist = delta @ normal
    band = (np.abs(face_dist) < 160) & (along > 80) & (along < length - 80) & (height > 80) & (height < (y1 - y0) - 80)
    face = points[band]
    if len(face) < 25:
        return None
    columns = 18
    edges = np.linspace(80, length - 80, columns + 1)
    lower_cut = (y1 - y0) * 0.72
    occupied = []
    for start, end in zip(edges[:-1], edges[1:]):
        column = face[(along[band] >= start) & (along[band] < end)]
        lower = int(np.sum(column[:, 1] < y0 + lower_cut))
        upper = int(np.sum(column[:, 1] >= y0 + lower_cut))
        occupied.append((lower, upper))
    empty = [lower < 2 for lower, _upper in occupied]
    best = None
    run_start = None
    for index, is_empty in enumerate(empty + [False]):
        if is_empty and run_start is None:
            run_start = index
        if not is_empty and run_start is not None:
            run = empty[run_start:index]
            if len(run) >= 2 and run_start > 0 and index < len(empty):
                u0 = float(edges[run_start])
                u1 = float(edges[index])
                width = u1 - u0
                if 480 <= width <= 1400:
                    lintel = sum(upper for _lower, upper in occupied[run_start:index])
                    if lintel >= 3 and (best is None or width > best[0]):
                        best = (width, u0, u1)
            run_start = None
    if best is None:
        return None
    _width, u0, u1 = best
    return {
        "kind": "door",
        "wall": 0,
        "u0": round(u0, 1),
        "u1": round(u1, 1),
        "v0": 0.0,
        "v1": round(min(y1 - y0 - 80.0, max(1400.0, (y1 - y0) * 0.72)), 1),
        "widthMm": round(u1 - u0, 1),
        "heightMm": round(min(y1 - y0 - 80.0, max(1400.0, (y1 - y0) * 0.72)), 1),
    }


def _explained_mask(points, solids):
    explained = np.zeros(len(points), dtype=bool)
    for solid in solids:
        if solid["kind"] == "slab":
            polygon = np.asarray(solid["polygon"], float)
            inside = _points_in_polygon(points[:, [0, 2]], polygon)
            explained |= inside & (np.abs(points[:, 1] - solid["y"]) < 180)
        elif solid["kind"] == "box":
            explained |= _near_box(points, solid, 160)
        elif solid["kind"] == "building":
            explained |= _points_in_polygon(points[:, [0, 2]], np.asarray(solid["footprint"], float)) & (points[:, 1] < solid["roofY"] + 200)
    return explained


def _near_box(points, box, band):
    origin = np.asarray(box["origin"], float)
    axis_u = np.asarray(box["axisU"], float)
    axis_v = np.asarray(box["axisV"], float)
    normal = np.asarray(box["normal"], float)
    delta = points - origin
    u = delta @ axis_u
    v = delta @ axis_v
    w = delta @ normal
    return (u > -band) & (u < box["width"] + band) & (v > -band) & (v < box["height"] + band) & (w > -band) & (w < box["thickness"] + band)


def _residual_points(points, explained):
    leftover = points[~explained]
    dropped = []
    if len(leftover) < 40:
        return leftover, dropped
    kept = []
    for component in _components_xyz(leftover, 240.0):
        taken = leftover[component]
        if len(taken) < 40:
            dropped.append({"reason": "rumore", "points": int(len(taken))})
            continue
        extent = taken.max(0) - taken.min(0)
        footprint = float(extent[0] * extent[2])
        tall = float(extent[1]) > 700 and footprint < 500_000
        fluffy = False
        if float(extent[1]) > 1400 and footprint > 1_500_000 and len(taken) >= 40:
            bins = np.floor((taken[:, 1] - taken[:, 1].min()) / 200.0).astype(int)
            peak = int(np.bincount(bins).max()) if len(bins) else 0
            fluffy = peak < 0.4 * len(taken)
        if fluffy or (len(taken) < 180 and (footprint < 800_000 or tall)):
            dropped.append({"reason": "vegetazione o rumore", "points": int(len(taken))})
            continue
        kept.append(taken)
    if not kept:
        return np.zeros((0, 3)), dropped
    return np.vstack(kept), dropped


def _scene_dims(points, solids):
    lows = [points.min(0)]
    highs = [points.max(0)]
    for solid in solids:
        if solid["kind"] == "box":
            corners = _box_corners(solid)
            lows.append(corners.min(0))
            highs.append(corners.max(0))
        elif solid["kind"] == "building":
            for part in solid["parts"]:
                corners = _box_corners(part)
                lows.append(corners.min(0))
                highs.append(corners.max(0))
        elif solid["kind"] == "slab":
            polygon = np.asarray(solid["polygon"], float)
            y = float(solid["y"])
            lows.append(np.array([polygon[:, 0].min(), y - solid["thickness"], polygon[:, 1].min()]))
            highs.append(np.array([polygon[:, 0].max(), y, polygon[:, 1].max()]))
    low = np.min(np.vstack(lows), axis=0)
    high = np.max(np.vstack(highs), axis=0)
    # Keep the frame positive for the textured-mesh crop.
    span = np.maximum(high, 0) - np.minimum(low, 0)
    dims = {
        "length_x": float(max(span[0], 1.0)),
        "width_y": float(max(span[1], 1.0)),
        "height_z": float(max(span[2], 1.0)),
    }
    return dims, {"min": [float(v) for v in low], "max": [float(v) for v in high]}


def _box_corners(box):
    origin = np.asarray(box["origin"], float)
    axis_u = np.asarray(box["axisU"], float) * float(box["width"])
    axis_v = np.asarray(box["axisV"], float) * float(box["height"])
    normal = np.asarray(box["normal"], float) * float(box["thickness"])
    corners = []
    for i in (0.0, 1.0):
        for j in (0.0, 1.0):
            for k in (0.0, 1.0):
                corners.append(origin + axis_u * i + axis_v * j + normal * k)
    return np.vstack(corners)


def _note(solids, openings, dropped, residual) -> str:
    names = [solid["name"] for solid in solids]
    text = "Oggetti: " + (", ".join(names) if names else "nessun solido") + "."
    if openings:
        text += f" Aperture con evidenza: {len(openings)}."
    else:
        text += " Nessuna apertura: manca l'evidenza di un vano."
    if dropped:
        text += f" Scartati {len(dropped)} gruppi di vegetazione o rumore."
    if len(residual):
        text += f" Il resto ({len(residual)} punti) è un guscio a parte."
    return text


def _direction_groups(points, normals):
    horizontal = normals.copy()
    horizontal[:, 1] = 0
    length = np.linalg.norm(horizontal, axis=1)
    keep = length > 0.2
    if int(keep.sum()) < 40:
        return []
    horizontal = horizontal[keep] / length[keep, None]
    points = points[keep]
    yaw = np.arctan2(horizontal[:, 2], horizontal[:, 0]) % np.pi
    order = np.argsort(yaw)
    yaw = yaw[order]
    points = points[order]
    groups = []
    start = 0
    for index in range(1, len(yaw) + 1):
        gap = index == len(yaw) or (yaw[index] - yaw[index - 1]) > np.radians(16)
        if not gap:
            continue
        if index - start >= 40:
            groups.append(_group(points[start:index], yaw[start:index]))
        start = index
    # The cut at 0/π is the same direction.
    if len(groups) >= 2 and _angle_mod_pi(groups[0]["yaw"], groups[-1]["yaw"]) < np.radians(18):
        merged = {
            "yaw": groups[0]["yaw"],
            "count": groups[0]["count"] + groups[-1]["count"],
            "points": np.vstack([groups[0]["points"], groups[-1]["points"]]),
            "normal": groups[0]["normal"],
        }
        groups = [merged] + groups[1:-1]
    return groups


def _group(points, yaw):
    mean = float(np.arctan2(np.sin(2 * yaw).mean(), np.cos(2 * yaw).mean()) / 2) % np.pi
    normal = np.array([np.cos(mean), 0.0, np.sin(mean)])
    return {"yaw": mean, "count": int(len(points)), "points": points, "normal": normal}


def _angle_mod_pi(left, right):
    delta = abs(float(left) - float(right)) % np.pi
    return min(delta, np.pi - delta)


def _return_at_end(dominant, extra):
    axis = np.cross(_UP, dominant["normal"])
    axis = _unit(axis)
    along = dominant["points"] @ axis
    lo, hi = np.percentile(along, [6, 94])
    span = max(float(hi - lo), 1.0)
    centre = float(np.median(extra["points"] @ axis))
    at_end = centre <= lo + 0.22 * span or centre >= hi - 0.22 * span
    orthogonal = abs(_angle_mod_pi(dominant["yaw"], extra["yaw"]) - np.pi / 2) < np.radians(28)
    return bool(at_end and orthogonal)


def _separated_structures(points, cell, bridge):
    if len(points) < 80:
        return False
    labels = _component_labels(points[:, [0, 2]], cell)
    if labels.max(initial=0) <= 1:
        return False
    # Bridge a door-sized gap, then see if two masses remain apart.
    dilated = _component_labels(points[:, [0, 2]], cell, link=bridge)
    counts = np.bincount(dilated)
    order = np.argsort(counts)[::-1]
    if len(order) < 2 or counts[order[1]] < 0.18 * len(points):
        return False
    first = points[dilated == order[0]]
    second = points[dilated == order[1]]
    gap = float(np.linalg.norm(np.median(first[:, [0, 2]], axis=0) - np.median(second[:, [0, 2]], axis=0)))
    return gap > bridge * 1.3


def _component_labels(xz, cell, link=None):
    link = cell if link is None else link
    keys = np.floor(xz / cell).astype(int)
    unique, inverse = np.unique(keys, axis=0, return_inverse=True)
    parent = np.arange(len(unique))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    lookup = {tuple(key): index for index, key in enumerate(unique)}
    reach = max(1, int(round(link / cell)))
    for index, key in enumerate(unique):
        for dx in range(-reach, reach + 1):
            for dz in range(-reach, reach + 1):
                other = lookup.get((int(key[0]) + dx, int(key[1]) + dz))
                if other is None:
                    continue
                left, right = find(index), find(other)
                if left != right:
                    parent[right] = left
    labels = np.array([find(index) for index in inverse], int)
    _compact = {old: new for new, old in enumerate(np.unique(labels))}
    return np.array([_compact[label] for label in labels], int)


def _components_xz(xz, cell):
    if len(xz) == 0:
        return []
    labels = _component_labels(xz, cell)
    return [np.flatnonzero(labels == label) for label in np.unique(labels)]


def _components_xyz(points, cell):
    if len(points) == 0:
        return []
    keys = np.floor(points / cell).astype(np.int64)
    unique, inverse = np.unique(keys, axis=0, return_inverse=True)
    parent = np.arange(len(unique))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    lookup = {tuple(int(v) for v in key): index for index, key in enumerate(unique)}
    for index, key in enumerate(unique):
        base = tuple(int(v) for v in key)
        for delta in ((1, 0, 0), (0, 1, 0), (0, 0, 1)):
            other = lookup.get((base[0] + delta[0], base[1] + delta[1], base[2] + delta[2]))
            if other is None:
                continue
            left, right = find(index), find(other)
            if left != right:
                parent[right] = left
    labels = np.array([find(index) for index in inverse], int)
    return [np.flatnonzero(labels == label) for label in np.unique(labels)]


def _occupied_area(xz, cell):
    keys = np.unique(np.floor(xz / cell).astype(int), axis=0)
    return float(len(keys) * cell * cell)


def _obb(xz):
    centre = xz.mean(0)
    centered = xz - centre
    cov = centered.T @ centered
    values, vectors = np.linalg.eigh(cov)
    axis_u = vectors[:, int(np.argmax(values))]
    axis_w = np.array([-axis_u[1], axis_u[0]])
    along_u = centered @ axis_u
    along_w = centered @ axis_w
    u0, u1 = np.percentile(along_u, [3, 97])
    w0, w1 = np.percentile(along_w, [3, 97])
    centre = centre + axis_u * ((u0 + u1) / 2) + axis_w * ((w0 + w1) / 2)
    return centre, _unit(axis_u), _unit(axis_w), float(u1 - u0), float(w1 - w0)


def _covered_by_building(plane, footprints):
    centre = np.asarray(plane["centre"], float)[[0, 2]]
    return _near_footprint(centre, footprints, margin=500)


def _near_footprint(centre, footprints, margin):
    point = np.asarray(centre, float)
    for footprint in footprints:
        polygon = np.asarray(footprint, float)
        if _polygon_contains(polygon, point):
            return True
        if _distance_to_polygon(polygon, point) < margin:
            return True
    return False


def _hull(xz, cell=0.0):
    xz = np.asarray(xz, float)
    if cell and len(xz) > 12:
        keys = np.unique(np.floor(xz / float(cell)).astype(int), axis=0)
        xz = (keys + 0.5) * float(cell)
    if len(xz) < 3:
        return None
    try:
        from scipy.spatial import ConvexHull

        hull = ConvexHull(xz)
        polygon = xz[hull.vertices]
    except Exception:
        return None
    if _shoelace(polygon) < 0:
        polygon = polygon[::-1]
    return polygon


def _shoelace(polygon):
    x = polygon[:, 0]
    y = polygon[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def _polygon_contains(polygon, point):
    polygon = np.asarray(polygon, float)
    x, y = float(point[0]), float(point[1])
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def _points_in_polygon(xz, polygon):
    if len(polygon) < 3:
        return np.zeros(len(xz), dtype=bool)
    mask = np.zeros(len(xz), dtype=bool)
    # Bounding box first.
    x0, z0 = polygon.min(0)
    x1, z1 = polygon.max(0)
    candidates = np.flatnonzero((xz[:, 0] >= x0) & (xz[:, 0] <= x1) & (xz[:, 1] >= z0) & (xz[:, 1] <= z1))
    for index in candidates:
        mask[index] = _polygon_contains(polygon, xz[index])
    return mask


def _distance_to_polygon(polygon, point):
    best = 1e12
    for index in range(len(polygon)):
        start = polygon[index]
        end = polygon[(index + 1) % len(polygon)]
        edge = end - start
        length2 = float(edge @ edge)
        if length2 < 1e-8:
            dist = float(np.linalg.norm(point - start))
        else:
            t = float(np.clip(((point - start) @ edge) / length2, 0.0, 1.0))
            dist = float(np.linalg.norm(point - (start + edge * t)))
        best = min(best, dist)
    return best


def _peaks_1d(values, width, minimum):
    if len(values) < minimum:
        return []
    low = float(values.min())
    bins = np.floor((values - low) / width).astype(int)
    counts = np.bincount(bins)
    peaks = []
    for index, count in enumerate(counts):
        if count < minimum:
            continue
        left = counts[index - 1] if index else 0
        right = counts[index + 1] if index + 1 < len(counts) else 0
        if count >= left and count >= right:
            peaks.append(low + (index + 0.5) * width)
    return peaks


def _unit(vector):
    vector = np.asarray(vector, float)
    length = float(np.linalg.norm(vector))
    if length < 1e-8:
        return np.zeros(3)
    return vector / length


def _unit_rows(normals):
    normals = np.asarray(normals, float)
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.maximum(length, 1e-12)
