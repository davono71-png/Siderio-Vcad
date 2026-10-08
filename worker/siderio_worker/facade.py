"""Facade capture: a wall the cameras look at, not a closed room.

Phone gravity is up. The camera sensor axis confirms it when they agree, and
does not replace it when a portrait JPEG leaves that axis horizontal. The
cloud is leveled so Y is up before any plane is classified. The background
slab is the largest vertical plane facing the cameras; relief of about 60 mm
stays on that same wall. A door-sized gap is cut out of the slab, and a
rectangular hole that does not touch the ground is a window.
"""

from __future__ import annotations

import numpy as np

from .room import _mu, _peaks

# Front faces are a single visible side. 20 mm is only enough to make a solid.
FRONT_SLAB_MM = 20.0
_VERTICAL = 0.34  # |n · up| below this is a vertical plane (~20° off vertical)
_HORIZONTAL = 0.90  # |n · up| above this is a horizontal plane (~25° off horizontal)
_RELIEF_MM = 60.0  # tile or brick relief still belongs to the same wall
_CONVENTION = (
    "Asse verticale: Y. X è orizzontale sulla facciata, Z punta verso la camera. "
    "Il piano di fondo è Z=0; lo spessore cresce verso Z negativo."
)


def detect_facade(
    points,
    normals,
    cameras=None,
    mm_per_unit=None,
    up_prior=None,
    wall_thickness_mm=150.0,
    slab_thickness_mm=FRONT_SLAB_MM,
    camera_ups=None,
):
    cloud = np.asarray(points, float)
    norms = _unit_rows(np.asarray(normals, float))
    if len(cloud) < 80:
        raise RuntimeError("Non trovo un piano di fondo abbastanza esteso.")
    span = float(np.linalg.norm(np.percentile(cloud, 95, axis=0) - np.percentile(cloud, 5, axis=0)))
    cameras_arr = np.asarray(cameras, float).reshape(-1, 3) if cameras is not None and len(cameras) else np.zeros((0, 3))
    up, up_source = _estimate_up(cloud, norms, cameras_arr, camera_ups, up_prior, mm_per_unit, span)
    # Level first. From here on, Y is up and every later test can use that axis.
    level = _level_rotation(up)
    centre = cameras_arr.mean(0) if len(cameras_arr) else cloud.mean(0)
    leveled = (cloud - centre) @ level.T
    leveled_normals = norms @ level.T
    leveled_cameras = (cameras_arr - centre) @ level.T if len(cameras_arr) else cameras_arr
    background_normal = _largest_vertical_normal(leveled, leveled_normals, leveled_cameras, mm_per_unit, span)
    yaw = None if background_normal is None else _yaw_to_wall(background_normal)
    if yaw is None:
        raise RuntimeError("Non trovo un piano di fondo abbastanza esteso.")
    rotation = yaw @ level
    if float(rotation[1] @ up) < 0.95:
        raise RuntimeError("Non trovo un piano di fondo abbastanza esteso.")
    aligned = leveled @ yaw.T
    aligned_normals = leveled_normals @ yaw.T
    background, shift = _background_plane(aligned, aligned_normals, mm_per_unit, span, wall_thickness_mm)
    aligned = aligned + shift
    openings, door_mask = _find_openings(aligned, aligned_normals, background, mm_per_unit, span)
    fronts, skipped = _front_planes(
        aligned,
        aligned_normals,
        mm_per_unit,
        span,
        slab_thickness_mm,
        background["support"],
        extra_used=door_mask,
    )
    planes = [background] + fronts
    move = _park_on_ground(planes)
    for item in openings:
        item["x0"] = float(item["x0"]) + float(move[0])
        item["x1"] = float(item["x1"]) + float(move[0])
        item["y0"] = float(item["y0"]) + float(move[1])
        item["y1"] = float(item["y1"]) + float(move[1])
    dims = _dims(planes)
    transform = np.eye(4)
    transform[:3, :3] = rotation
    transform[:3, 3] = -rotation @ centre + shift + move
    return {
        "units": "model",
        "mode": "facciata",
        "mm_per_unit": mm_per_unit,
        "upSource": up_source,
        "upAxis": "Y",
        "transform_colmap_to_room": transform.tolist(),
        "convention": _CONVENTION,
        "dims": dims,
        "planes": planes,
        "skipped": skipped,
        "openings": openings,
        "note": _note(fronts, skipped, openings),
    }


def to_millimetres(scene: dict, mm_per_unit: float) -> dict:
    scale = float(mm_per_unit)
    dims = scene["dims"]

    def plane_mm(plane):
        return {
            "role": plane["role"],
            "type": plane["type"],
            "widthMm": round(float(plane["width"]) * scale, 1),
            "heightMm": round(float(plane["height"]) * scale, 1),
            "thicknessMm": round(float(plane["thickness"]) * scale, 1),
            "thicknessSource": plane["thicknessSource"],
            "support": int(plane["support"]),
            "originMm": [round(float(v) * scale, 1) for v in plane["origin"]],
            "axisU": [round(float(v), 6) for v in plane["axisU"]],
            "axisV": [round(float(v), 6) for v in plane["axisV"]],
            "normal": [round(float(v), 6) for v in plane["normal"]],
            "centerMm": [round(float(v) * scale, 1) for v in plane["center"]],
        }

    def opening_mm(item):
        x0 = round(float(item["x0"]) * scale, 1)
        x1 = round(float(item["x1"]) * scale, 1)
        y0 = round(float(item["y0"]) * scale, 1)
        y1 = round(float(item["y1"]) * scale, 1)
        return {
            "kind": item.get("kind", "door"),
            "x0": x0,
            "x1": x1,
            "y0": y0,
            "y1": y1,
            "widthMm": round(x1 - x0, 1),
            "heightMm": round(y1 - y0, 1),
        }

    return {
        "units": "mm",
        "mode": "facciata",
        "mm_per_unit": scale,
        "upSource": scene.get("upSource"),
        "upAxis": scene.get("upAxis", "Y"),
        "convention": scene["convention"],
        "note": scene["note"],
        "dims": {
            "length_x": round(float(dims["length_x"]) * scale, 1),
            "width_y": round(float(dims["width_y"]) * scale, 1),
            "height_z": round(float(dims["height_z"]) * scale, 1),
        },
        "planes": [plane_mm(plane) for plane in scene["planes"]],
        "skipped": list(scene.get("skipped") or []),
        "openings": [opening_mm(item) for item in scene.get("openings") or []],
        "transform_colmap_to_room_mm": (np.diag([scale, scale, scale, 1.0]) @ np.asarray(scene["transform_colmap_to_room"], float)).tolist(),
    }


def _unit(vector) -> np.ndarray | None:
    if vector is None:
        return None
    vector = np.asarray(vector, float)
    length = float(np.linalg.norm(vector))
    if length < 1e-9:
        return None
    return vector / length


def _unit_rows(normals: np.ndarray) -> np.ndarray:
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.clip(lengths, 1e-9, None)


def _robust_direction(vectors) -> np.ndarray | None:
    if vectors is None or len(vectors) < 3:
        return None
    rows = _unit_rows(np.asarray(vectors, float))
    mean = rows.mean(0)
    length = float(np.linalg.norm(mean))
    if length < 1e-6:
        return None
    mean = mean / length
    rows = rows.copy()
    rows[rows @ mean < 0] *= -1
    mean = rows.mean(0)
    length = float(np.linalg.norm(mean))
    if length < 0.45:
        # The cameras do not agree (mixed portrait/landscape, or no gravity).
        return None
    mean = mean / length
    agree = rows @ mean > np.cos(np.radians(30))
    if int(agree.sum()) < 3:
        return mean
    refined = rows[agree].mean(0)
    length = float(np.linalg.norm(refined))
    return None if length < 1e-6 else refined / length


def _clusters(normals, min_count, limit=8):
    major = np.argmax(np.abs(normals), axis=1)
    canonical = normals.copy()
    canonical[canonical[np.arange(len(canonical)), major] < 0] *= -1
    quantized = np.round(canonical * 4).astype(np.int16)
    keys = quantized[:, 0].astype(np.int32) * 100000 + quantized[:, 1].astype(np.int32) * 1000 + quantized[:, 2].astype(np.int32)
    values, counts = np.unique(keys, return_counts=True)
    order = np.argsort(-counts)
    groups = []
    for index in order:
        if int(counts[index]) < min_count or len(groups) >= limit:
            break
        selected = keys == values[index]
        normal = canonical[selected].mean(0)
        length = float(np.linalg.norm(normal))
        if length < 1e-8:
            continue
        groups.append((normal / length, selected))
    return groups


def _toward_cameras(normal, points, mask, cameras):
    if cameras is not None and len(np.asarray(cameras)):
        target = np.asarray(cameras, float).reshape(-1, 3).mean(0)
    else:
        return normal
    if float(normal @ (target - points[mask].mean(0))) < 0:
        return -normal
    return normal


def _peak_positions(values, bin_w, min_count):
    """Peaks plus the fullest bin.

    Smoothing in ``_peaks`` can hide a plane that sits on the edge of the
    histogram, which is exactly where the background wall usually is.
    """
    found = list(_peaks(values, bin_w, min_count))
    if len(values) < min_count:
        return found
    lo, hi = float(np.min(values)), float(np.max(values))
    if hi - lo < bin_w:
        pos = float(np.median(values))
    else:
        edges = np.arange(lo - bin_w, hi + 2 * bin_w, bin_w)
        hist, edges = np.histogram(values, edges)
        index = int(np.argmax(hist))
        if int(hist[index]) < min_count:
            return found
        pos = float((edges[index] + edges[index + 1]) / 2)
    if not any(abs(item["pos"] - pos) <= bin_w for item in found):
        found.append({"pos": pos, "support": int(len(values))})
    return found


def _measure_peaks(points, normals, mask, normal, mm_per_unit, span, minimum_mm, minimum_points):
    band = _mu(45, mm_per_unit, span)
    found = []
    peaks = _peak_positions(points[mask] @ normal, _mu(40, mm_per_unit, span), minimum_points)
    for peak in peaks:
        selected = mask & (np.abs(points @ normal - peak["pos"]) < band) & (normals @ normal > 0.72)
        measured = _measure(points, selected, normal, mm_per_unit, span, minimum_mm, minimum_points)
        if measured is not None:
            found.append(measured)
    return found


def _estimate_up(points, normals, cameras, camera_ups, up_prior, mm_per_unit, span):
    """Up is phone gravity, confirmed by the cameras only when they agree with it.

    COLMAP camera Y is image-down. Portrait JPEGs are stored without the EXIF
    rotation, so that axis is often horizontal. It must not replace a gravity
    prior it disagrees with.
    """
    prior = _unit(up_prior)
    cameras_up = _robust_direction(camera_ups)
    if prior is not None and cameras_up is not None and float(prior @ cameras_up) >= np.cos(np.radians(25)):
        up = prior + cameras_up
        up = up / np.linalg.norm(up)
        source = "camere+gravita"
    elif prior is not None:
        up = prior
        source = "gravita"
    elif cameras_up is not None:
        up = cameras_up
        source = "camere"
    else:
        up = np.array([0.0, 0.0, 1.0])
        source = "default"
    ground = _ground_normal(points, normals, cameras, up, mm_per_unit, span)
    if ground is None:
        return up, source
    if float(ground @ up) >= np.cos(np.radians(25)):
        blended = up + ground
        return blended / np.linalg.norm(blended), source + "+terreno"
    cameras_confirm = cameras_up is not None and float(cameras_up @ up) >= np.cos(np.radians(25))
    cameras_with_ground = cameras_up is not None and float(cameras_up @ ground) >= np.cos(np.radians(25))
    if (not cameras_confirm) or cameras_with_ground:
        return ground, "terreno"
    return up, source


def _ground_normal(points, normals, cameras, up, mm_per_unit, span):
    """Largest plane that behaves like ground relative to ``up``, or that should replace it."""
    best_match = None
    best_override = None
    band = _mu(200, mm_per_unit, span)
    for normal, mask in _clusters(normals, 60):
        normal = _toward_cameras(normal, points, mask, cameras)
        measured = _measure_peaks(points, normals, mask, normal, mm_per_unit, span, 600, 60)
        if not measured:
            continue
        plane = max(measured, key=lambda item: item["width"] * item["height"])
        area = plane["width"] * plane["height"]
        alignment = float(normal @ up)
        center = np.asarray(plane["center"], float)
        above = int(np.sum(points @ normal > float(center @ normal) + band))
        if alignment >= np.cos(np.radians(30)) and (best_match is None or area > best_match[0]):
            best_match = (area, normal)
        # Override only when many points stand on this plane and the current up does not.
        if alignment < np.cos(np.radians(40)) and above > 0.25 * len(points) and area > _mu(1500, mm_per_unit, span) ** 2:
            if best_override is None or above * area > best_override[0]:
                best_override = (above * area, normal)
    if best_match is not None:
        return best_match[1]
    if best_override is not None:
        return best_override[1]
    return None


def _level_rotation(up) -> np.ndarray:
    """Rows map world vectors into a frame whose Y axis is ``up``."""
    axis_y = np.asarray(up, float)
    axis_y = axis_y / np.linalg.norm(axis_y)
    reference = np.array([1.0, 0.0, 0.0]) - axis_y * float(axis_y[0])
    if float(np.linalg.norm(reference)) < 0.25:
        reference = np.array([0.0, 0.0, 1.0]) - axis_y * float(axis_y[2])
    axis_x = reference / np.linalg.norm(reference)
    axis_z = np.cross(axis_x, axis_y)
    axis_z = axis_z / np.linalg.norm(axis_z)
    return np.stack([axis_x, axis_y, axis_z])


def _yaw_to_wall(normal) -> np.ndarray | None:
    """Rows yaw a Y-up frame so Z is the wall normal, toward the cameras."""
    axis_z = np.asarray(normal, float)
    axis_z = np.array([axis_z[0], 0.0, axis_z[2]])
    if float(np.linalg.norm(axis_z)) < 0.25:
        return None
    axis_z = axis_z / np.linalg.norm(axis_z)
    axis_y = np.array([0.0, 1.0, 0.0])
    axis_x = np.cross(axis_y, axis_z)
    axis_x = axis_x / np.linalg.norm(axis_x)
    return np.stack([axis_x, axis_y, axis_z])


def _largest_vertical_normal(points, normals, cameras, mm_per_unit, span):
    """Largest vertical plane in a frame where Y is already up.

    Neighbouring normal bins are one wall when they face the same way and sit
    within the relief band. Tile tilt of a few tens of millimetres does not
    split the facade.
    """
    up = np.array([0.0, 1.0, 0.0])
    relief = _mu(_RELIEF_MM, mm_per_unit, span)
    groups = []
    for normal, mask in _clusters(normals, 40):
        if abs(float(normal[1])) > _VERTICAL:
            continue
        normal = _toward_cameras(normal, points, mask, cameras)
        if abs(float(normal[1])) > _VERTICAL:
            continue
        offset = float(np.median(points[mask] @ normal))
        groups.append({"normal": normal, "mask": mask, "offset": offset, "count": int(mask.sum())})
    groups.sort(key=lambda item: item["count"], reverse=True)
    best = None
    consumed = [False] * len(groups)
    for index, group in enumerate(groups):
        if consumed[index]:
            continue
        merged = group["mask"].copy()
        normal = group["normal"]
        offset = group["offset"]
        consumed[index] = True
        for other_index, other in enumerate(groups):
            if consumed[other_index]:
                continue
            if float(normal @ other["normal"]) < np.cos(np.radians(22)):
                continue
            if abs(offset - other["offset"]) > relief:
                continue
            merged |= other["mask"]
            consumed[other_index] = True
        # The plane comes from the points. Averaging tile normals tilts a long
        # wall by a degree or two and turns one edge into a fake recess.
        samples = points[merged]
        centered = samples - samples.mean(0)
        _, _, vt = np.linalg.svd(centered, full_matrices=False)
        mean = vt[-1]
        mean = mean - up * float(mean @ up)
        if float(np.linalg.norm(mean)) < 1e-6:
            continue
        mean = mean / np.linalg.norm(mean)
        if float(mean @ normal) < 0:
            mean = -mean
        mean = _toward_cameras(mean, points, merged, cameras)
        if abs(float(mean[1])) > _VERTICAL:
            continue
        centre = float(np.median(points[merged] @ mean))
        inliers = (np.abs(normals @ up) <= 0.45) & (normals @ mean > 0.70) & (np.abs(points @ mean - centre) <= relief)
        if int(inliers.sum()) < 40:
            continue
        measured = _measure(points, inliers, mean, mm_per_unit, span, 400, 40)
        if measured is None:
            continue
        area = measured["width"] * measured["height"]
        if best is None or area > best[0]:
            best = (area, mean)
    return None if best is None else best[1]


def _background_plane(points, normals, mm_per_unit, span, wall_thickness_mm):
    band = _mu(_RELIEF_MM, mm_per_unit, span)
    mask = normals[:, 2] > 0.70
    peaks = sorted(_peak_positions(points[mask, 2], _mu(40, mm_per_unit, span), 40), key=lambda item: item["pos"])
    groups = []
    for peak in peaks:
        if groups and peak["pos"] - groups[-1]["pos"] <= band:
            count = groups[-1]["n"]
            groups[-1]["pos"] = (groups[-1]["pos"] * count + peak["pos"]) / (count + 1)
            groups[-1]["n"] = count + 1
        else:
            groups.append({"pos": peak["pos"], "n": 1})
    candidates = []
    for group in groups:
        selected = mask & (np.abs(points[:, 2] - group["pos"]) < band)
        measured = _measure(points, selected, np.array([0.0, 0.0, 1.0]), mm_per_unit, span, minimum_mm=400, minimum_points=40)
        if measured is None:
            continue
        candidates.append(measured)
    if not candidates and int(mask.sum()) >= 40:
        offsets = points[mask, 2]
        spread = float(np.percentile(offsets, 95) - np.percentile(offsets, 5))
        if spread <= band:
            selected = mask & (np.abs(points[:, 2] - float(np.median(offsets))) < band)
            measured = _measure(points, selected, np.array([0.0, 0.0, 1.0]), mm_per_unit, span, minimum_mm=400, minimum_points=40)
            if measured is not None:
                candidates.append(measured)
    if not candidates:
        raise RuntimeError("Non trovo un piano di fondo abbastanza esteso.")
    measured = max(candidates, key=lambda item: item["width"] * item["height"])
    measured["role"] = "background"
    measured["type"] = "facciata"
    measured["thickness"] = _mu(wall_thickness_mm, mm_per_unit, span)
    measured["thicknessSource"] = "parete"
    origin = np.asarray(measured["origin"], float)
    shift = np.array([-origin[0], -origin[1], -origin[2]])
    measured["origin"] = [0.0, 0.0, 0.0]
    measured["center"] = [measured["width"] / 2.0, measured["height"] / 2.0, 0.0]
    measured["axisU"] = [1.0, 0.0, 0.0]
    measured["axisV"] = [0.0, 1.0, 0.0]
    measured["normal"] = [0.0, 0.0, 1.0]
    return measured, shift


def _find_openings(points, normals, background, mm_per_unit, span):
    # Outside the relief band, so brick or tile on the wall is not a second door.
    band = _mu(70, mm_per_unit, span)
    recess = (normals[:, 2] > 0.72) & (points[:, 2] < -band) & (points[:, 2] > -_mu(500, mm_per_unit, span))
    proud = (normals[:, 2] > 0.72) & (points[:, 2] > band) & (points[:, 2] < _mu(400, mm_per_unit, span))
    found = []
    door_mask = None
    for mask in (recess, proud):
        opening = _bounds_if_door(points, mask, background, mm_per_unit, span)
        if opening is not None:
            found.append(opening)
            door_mask = mask
            break
    occupied, width, height = _opening_grid(points, normals, background, mm_per_unit, span)
    for opening in _grid_openings(occupied, width, height, background, mm_per_unit, span):
        if any(_overlaps(opening, other) for other in found):
            continue
        found.append(opening)
    return found, door_mask


def _bounds_if_door(points, mask, background, mm_per_unit, span):
    if int(np.count_nonzero(mask)) < 40:
        return None
    samples = points[mask]
    x0, x1 = (float(v) for v in np.percentile(samples[:, 0], [2, 98]))
    y0, y1 = (float(v) for v in np.percentile(samples[:, 1], [2, 98]))
    cell = _mu(150, mm_per_unit, span)
    nx = max(1, int(round(max(x1 - x0, cell) / cell)))
    ny = max(1, int(round(max(y1 - y0, cell) / cell)))
    if nx * ny >= 6:
        ix = np.clip(((samples[:, 0] - x0) / max(x1 - x0, 1.0) * nx).astype(int), 0, nx - 1)
        iy = np.clip(((samples[:, 1] - y0) / max(y1 - y0, 1.0) * ny).astype(int), 0, ny - 1)
        covered = len(set(zip(ix.tolist(), iy.tolist())))
        if covered < 0.45 * nx * ny:
            return None
    return _accept_door(x0, x1, y0, y1, background, mm_per_unit, span)


def _accept_door(x0, x1, y0, y1, background, mm_per_unit, span):
    width = x1 - x0
    height = y1 - y0
    # 500 mm leaves room for a 600 mm door after the occupancy grid snaps.
    if not (_mu(450, mm_per_unit, span) <= width <= _mu(1500, mm_per_unit, span)):
        return None
    if not (_mu(1600, mm_per_unit, span) <= height <= _mu(2700, mm_per_unit, span)):
        return None
    if y0 > _mu(400, mm_per_unit, span):
        return None
    if y1 > float(background["height"]) + _mu(300, mm_per_unit, span):
        return None
    if width > 0.72 * float(background["width"]):
        return None
    return {"kind": "door", "x0": x0, "x1": x1, "y0": y0, "y1": y1}


def _accept_window(x0, x1, y0, y1, background, mm_per_unit, span):
    width = x1 - x0
    height = y1 - y0
    if not (_mu(400, mm_per_unit, span) <= width <= _mu(2000, mm_per_unit, span)):
        return None
    if not (_mu(400, mm_per_unit, span) <= height <= _mu(1600, mm_per_unit, span)):
        return None
    if y0 < _mu(400, mm_per_unit, span):
        return None
    if y1 > float(background["height"]) + _mu(150, mm_per_unit, span):
        return None
    if width > 0.72 * float(background["width"]):
        return None
    return {"kind": "window", "x0": float(x0), "x1": float(x1), "y0": float(y0), "y1": float(y1)}


def _opening_grid(points, normals, background, mm_per_unit, span):
    cell = _mu(80, mm_per_unit, span)
    band = _mu(70, mm_per_unit, span)
    wall = (normals[:, 2] > 0.65) & (np.abs(points[:, 2]) < band)
    width = max(float(background["width"]), cell)
    height = max(float(background["height"]), cell)
    nx = max(6, int(np.ceil(width / cell)))
    ny = max(6, int(np.ceil(height / cell)))
    occupied = np.zeros((ny, nx), dtype=bool)
    if int(wall.sum()) >= 20:
        ix = np.clip(np.floor(points[wall, 0] / width * nx).astype(int), 0, nx - 1)
        iy = np.clip(np.floor(points[wall, 1] / height * ny).astype(int), 0, ny - 1)
        occupied[iy, ix] = True
    return occupied, width, height


def _grid_openings(occupied, width, height, background, mm_per_unit, span):
    ny, nx = occupied.shape
    openings = []
    head = min(ny, max(4, int(round(_mu(2000, mm_per_unit, span) / height * ny))))
    low_cut = max(3, int(round(_mu(1400, mm_per_unit, span) / height * ny)))
    door_column = []
    for index in range(nx):
        door_column.append(_door_column(occupied[:, index], head, low_cut))
    expanded = door_column[:]
    for index in range(nx):
        if expanded[index]:
            continue
        touches = (index > 0 and door_column[index - 1]) or (index + 1 < nx and door_column[index + 1])
        if touches and float(occupied[:low_cut, index].mean()) < 0.45 and bool(occupied[:, index].any()):
            expanded[index] = True
    run = _longest_run(expanded)
    if run is not None and run[1] - run[0] >= 3:
        start, stop = run
        tops = [_gap_top(occupied[:, index], head) for index in range(start, stop)]
        y1 = float(np.median(tops)) / ny * height
        opening = _accept_door(start / nx * width, stop / nx * width, 0.0, y1, background, mm_per_unit, span)
        if opening is not None:
            openings.append(opening)
    gaps = [_interior_gaps(occupied[:, index]) for index in range(nx)]
    used = np.zeros(nx, dtype=bool)
    for index in range(nx):
        if used[index] or not gaps[index]:
            continue
        seed = max(gaps[index], key=lambda gap: gap[1] - gap[0])
        columns = [index]
        y0, y1 = seed
        used[index] = True
        for other in range(index + 1, nx):
            match = None
            for gap in gaps[other]:
                overlap = min(y1, gap[1]) - max(y0, gap[0])
                shorter = max(1, min(y1 - y0, gap[1] - gap[0]))
                if overlap >= 0.5 * shorter:
                    match = gap
                    break
            if match is None:
                break
            columns.append(other)
            used[other] = True
            y0 = min(y0, match[0])
            y1 = max(y1, match[1])
        if len(columns) < 3 or y1 - y0 < 3:
            continue
        opening = _accept_window(
            columns[0] / nx * width,
            (columns[-1] + 1) / nx * width,
            y0 / ny * height,
            y1 / ny * height,
            background,
            mm_per_unit,
            span,
        )
        if opening is not None:
            openings.append(opening)
    return openings


def _door_column(column, head, low_cut) -> bool:
    if head < 4 or not column.any():
        return False
    low = column[: min(low_cut, len(column))]
    high = column[head:] if head < len(column) else column[-2:]
    if len(low) == 0 or float(low.mean()) >= 0.2:
        return False
    return len(high) > 0 and float(np.mean(high)) >= 0.3


def _gap_top(column, head) -> int:
    """Last row of a door gap, ignoring a single occupied noise cell."""
    occupied_run = 0
    last_empty = 0
    limit = min(head + 2, len(column))
    for row in range(limit):
        if column[row]:
            occupied_run += 1
            if occupied_run >= 2:
                return max(0, row - 1)
        else:
            occupied_run = 0
            last_empty = row
    return last_empty


def _interior_gaps(column):
    gaps = []
    start = None
    for index, flag in enumerate(column):
        if not flag and start is None:
            start = index
        elif flag and start is not None:
            if start > 0 and index - start >= 2:
                gaps.append((start, index))
            start = None
    return gaps


def _overlaps(left, right) -> bool:
    return not (left["x1"] < right["x0"] or right["x1"] < left["x0"] or left["y1"] < right["y0"] or right["y1"] < left["y0"])


def _longest_run(flags):
    best = None
    start = None
    for index, flag in enumerate(list(flags) + [False]):
        if flag and start is None:
            start = index
        elif not flag and start is not None:
            if best is None or index - start > best[1] - best[0]:
                best = (start, index)
            start = None
    return best


def _front_planes(points, normals, mm_per_unit, span, slab_thickness_mm, background_support, extra_used=None):
    band = _mu(_RELIEF_MM, mm_per_unit, span)
    used = (normals[:, 2] > 0.70) & (np.abs(points[:, 2]) < _mu(70, mm_per_unit, span))
    if extra_used is not None:
        used = used | extra_used
    found = []
    skipped = []
    for _ in range(8):
        free = ~used
        if int(free.sum()) < 20:
            break
        normal = _largest_normal(normals, free)
        if normal is None:
            break
        normal = _orient_front(normal)
        peaks = _peak_positions(points[free] @ normal, _mu(40, mm_per_unit, span), 20)
        consumed = np.zeros(len(points), dtype=bool)
        for peak in peaks:
            selected = free & ~consumed & (np.abs(points @ normal - peak["pos"]) < band) & (normals @ normal > 0.78)
            support = int(selected.sum())
            if support < 20:
                continue
            consumed |= selected
            if support < 30:
                skipped.append({"reason": "troppo pochi punti", "support": support})
                continue
            measured = _measure(points, selected, normal, mm_per_unit, span, minimum_mm=150, minimum_points=30)
            if measured is None:
                skipped.append({"reason": "estensione insufficiente", "support": support})
                continue
            if not _keep_front(points, selected, normal, mm_per_unit, span, slab_thickness_mm, background_support, found, skipped):
                continue
        if not consumed.any():
            match = free & (normals @ normal > 0.70)
            count = int(match.sum())
            if count < 20:
                break
            offsets = points[match] @ normal
            spread = float(np.percentile(offsets, 95) - np.percentile(offsets, 5))
            relief = _mu(_RELIEF_MM, mm_per_unit, span)
            if count >= 30 and spread <= relief:
                centre = float(np.median(offsets))
                selected = match & (np.abs(points @ normal - centre) <= relief)
                kept = _keep_front(points, selected, normal, mm_per_unit, span, slab_thickness_mm, background_support, found, skipped)
                used |= selected if kept else match
                continue
            skipped.append({"reason": "non planare", "support": count})
            used |= match
            continue
        used |= consumed
    terrain = [plane for plane in found if plane["role"] == "terreno"]
    others = [plane for plane in found if plane["role"] != "terreno"]
    if len(terrain) > 1:
        terrain.sort(key=lambda plane: plane["width"] * plane["height"], reverse=True)
        for extra in terrain[1:]:
            skipped.append({"reason": "superficie minore, non esportata", "support": extra["support"]})
        terrain = terrain[:1]
    others.sort(key=lambda plane: plane["support"], reverse=True)
    if len(others) > 4:
        for extra in others[4:]:
            skipped.append({"reason": "superficie minore, non esportata", "support": extra["support"]})
        others = others[:4]
    return terrain + others, skipped


def _keep_front(points, selected, normal, mm_per_unit, span, slab_thickness_mm, background_support, found, skipped) -> bool:
    support = int(np.count_nonzero(selected))
    if support < 30:
        skipped.append({"reason": "troppo pochi punti", "support": support})
        return False
    measured = _measure(points, selected, normal, mm_per_unit, span, minimum_mm=150, minimum_points=30)
    if measured is None:
        skipped.append({"reason": "estensione insufficiente", "support": support})
        return False
    kind = _plane_type(normal)
    if kind == "verticale" and min(measured["width"], measured["height"]) < _mu(300, mm_per_unit, span):
        skipped.append({"reason": "estensione insufficiente", "support": support})
        return False
    if kind == "inclinato":
        area = measured["width"] * measured["height"]
        large = area >= _mu(1500, mm_per_unit, span) ** 2 and support >= max(800, int(0.12 * background_support))
        if not large:
            skipped.append({"reason": "inclinato", "support": support})
            return False
    center_z = float(measured["center"][2])
    if center_z < -_mu(40, mm_per_unit, span) and kind != "orizzontale":
        skipped.append({"reason": "dietro il piano di fondo", "support": support})
        return False
    if abs(float(normal[2])) > 0.9 and abs(center_z) < _mu(50, mm_per_unit, span):
        skipped.append({"reason": "coincide con il piano di fondo", "support": support})
        return False
    measured["role"] = "front"
    measured["type"] = kind
    if kind == "orizzontale" and float(measured["center"][1]) <= _mu(300, mm_per_unit, span):
        measured["role"] = "terreno"
    measured["thickness"] = _mu(slab_thickness_mm, mm_per_unit, span)
    measured["thicknessSource"] = "nominale"
    found.append(measured)
    return True


def _largest_normal(normals, mask) -> np.ndarray | None:
    chosen = normals[mask]
    major = np.argmax(np.abs(chosen), axis=1)
    canonical = chosen.copy()
    canonical[canonical[np.arange(len(canonical)), major] < 0] *= -1
    quantized = np.round(canonical * 5).astype(np.int16)
    keys = quantized[:, 0].astype(np.int32) * 100000 + quantized[:, 1].astype(np.int32) * 1000 + quantized[:, 2].astype(np.int32)
    values, counts = np.unique(keys, return_counts=True)
    if int(counts.max()) < 20:
        return None
    best = values[int(np.argmax(counts))]
    group = canonical[keys == best]
    normal = group.mean(0)
    length = float(np.linalg.norm(normal))
    if length < 1e-8:
        return None
    return normal / length


def _orient_front(normal: np.ndarray) -> np.ndarray:
    normal = normal / np.linalg.norm(normal)
    if abs(float(normal[1])) >= 0.7:
        return normal if normal[1] > 0 else -normal
    if float(normal[2]) < 0:
        return -normal
    return normal


def _plane_type(normal: np.ndarray) -> str:
    alignment = abs(float(normal[1]))
    if alignment >= _HORIZONTAL:
        return "orizzontale"
    if alignment <= _VERTICAL:
        return "verticale"
    return "inclinato"


def _measure(points, selected, normal, mm_per_unit, span, minimum_mm, minimum_points):
    support = int(np.count_nonzero(selected))
    if support < minimum_points:
        return None
    normal = normal / np.linalg.norm(normal)
    axis_u, axis_v = _inplane(normal)
    samples = points[selected]
    anchor = samples.mean(0)
    anchor = anchor - normal * float(anchor @ normal - np.median(samples @ normal))
    relative = samples - anchor
    coords_u = relative @ axis_u
    coords_v = relative @ axis_v
    u0, u1 = np.percentile(coords_u, [1, 99])
    v0, v1 = np.percentile(coords_v, [1, 99])
    width = float(u1 - u0)
    height = float(v1 - v0)
    if width < _mu(minimum_mm, mm_per_unit, span) or height < _mu(minimum_mm, mm_per_unit, span):
        return None
    origin = anchor + axis_u * float(u0) + axis_v * float(v0)
    center = origin + axis_u * (width / 2.0) + axis_v * (height / 2.0)
    return {
        "width": width,
        "height": height,
        "support": support,
        "origin": [float(v) for v in origin],
        "center": [float(v) for v in center],
        "axisU": [float(v) for v in axis_u],
        "axisV": [float(v) for v in axis_v],
        "normal": [float(v) for v in normal],
    }


def _inplane(normal: np.ndarray):
    up = np.array([0.0, 1.0, 0.0])
    axis_v = up - normal * float(normal @ up)
    if float(np.linalg.norm(axis_v)) < 0.3:
        axis_v = np.array([0.0, 0.0, 1.0]) - normal * float(normal[2])
    axis_v = axis_v / np.linalg.norm(axis_v)
    axis_u = np.cross(axis_v, normal)
    axis_u = axis_u / np.linalg.norm(axis_u)
    return axis_u, axis_v


def _park_on_ground(planes):
    """Keep the background face on Z=0 and pull a negative X/Y back to the origin."""
    corners = []
    for plane in planes:
        corners.extend(_face_corners(plane))
    stacked = np.vstack(corners)
    move = np.array([-min(0.0, float(stacked[:, 0].min())), -min(0.0, float(stacked[:, 1].min())), 0.0])
    if float(np.linalg.norm(move)) < 1e-9:
        return move
    for plane in planes:
        origin = np.asarray(plane["origin"], float) + move
        center = np.asarray(plane["center"], float) + move
        plane["origin"] = [float(v) for v in origin]
        plane["center"] = [float(v) for v in center]
    return move


def _face_corners(plane):
    origin = np.asarray(plane["origin"], float)
    axis_u = np.asarray(plane["axisU"], float) * float(plane["width"])
    axis_v = np.asarray(plane["axisV"], float) * float(plane["height"])
    return [origin, origin + axis_u, origin + axis_v, origin + axis_u + axis_v]


def _dims(planes):
    corners = np.vstack([corner for plane in planes for corner in _face_corners(plane)])
    length = max(float(corners[:, 0].max()), 1.0)
    width = max(float(corners[:, 1].max()), 1.0)
    depth = max(float(corners[:, 2].max()), 1.0)
    return {"length_x": round(length, 4), "width_y": round(width, 4), "height_z": round(depth, 4)}


def _note(fronts, skipped, openings) -> str:
    front_count = len(fronts)
    if front_count == 0:
        text = "Solo il piano di fondo è affidabile: non ci sono altre superfici piane abbastanza estese."
    else:
        noun = "superficie" if front_count == 1 else "superfici"
        text = f"Piano di fondo e {front_count} {noun} davanti."
    doors = [item for item in openings if item.get("kind") == "door"]
    windows = [item for item in openings if item.get("kind") == "window"]
    if doors:
        text += " Apertura porta sul piano di fondo."
    if len(windows) == 1:
        text += " Finestra sul piano di fondo."
    elif len(windows) > 1:
        text += f" {len(windows)} finestre sul piano di fondo."
    if skipped:
        skipped_noun = "superficie scartata" if len(skipped) == 1 else "superfici scartate"
        text += f" {len(skipped)} {skipped_noun}."
    return text
