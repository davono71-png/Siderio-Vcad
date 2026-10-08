"""Facade capture: a wall the cameras look at, not a closed room.

Phone gravity is up. The camera sensor axis confirms it when they agree, and
does not replace it when a portrait JPEG leaves that axis horizontal. The
cloud is leveled so Y is up before any plane is classified. The background
slab is the largest vertical plane facing the cameras; relief of about 60 mm
stays on that same wall. Its extent follows the wall-face points, including a
sparse wing. A door is a gap down to the floor with wall on both sides and
above. A window is a hole inside the face with points seen through it or a
reveal around it. An empty patch with none of that is a lacuna, not a cut.
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
    aligned = leveled @ yaw.T
    aligned_normals = leveled_normals @ yaw.T
    aligned_cameras = leveled_cameras @ yaw.T if len(leveled_cameras) else leveled_cameras
    # Gravity can leave the floor sloping along the facade. A floor within 5°
    # of horizontal becomes the level, so the slab and the return wall are plumb.
    floor_rotation = _floor_level_rotation(aligned, aligned_normals, mm_per_unit, span)
    if floor_rotation is not None:
        aligned = aligned @ floor_rotation.T
        aligned_normals = aligned_normals @ floor_rotation.T
        if len(aligned_cameras):
            aligned_cameras = aligned_cameras @ floor_rotation.T
        rotation = floor_rotation @ rotation
        refined = _largest_vertical_normal(aligned, aligned_normals, aligned_cameras, mm_per_unit, span)
        yaw_again = None if refined is None else _yaw_to_wall(refined)
        if yaw_again is not None:
            aligned = aligned @ yaw_again.T
            aligned_normals = aligned_normals @ yaw_again.T
            rotation = yaw_again @ rotation
    if float(rotation[1] @ up) < 0.95:
        raise RuntimeError("Non trovo un piano di fondo abbastanza esteso.")
    background, shift = _background_plane(aligned, aligned_normals, mm_per_unit, span, wall_thickness_mm)
    aligned = aligned + shift
    openings, lacune, door_mask = _find_openings(aligned, aligned_normals, background, mm_per_unit, span)
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
    _assign_steps(planes)
    _snap_orthogonal(planes)
    move = _park_on_ground(planes)
    move = move + _seat_floor(planes)
    _raise_wall_to_floor(planes)
    _shift_openings(list(openings) + list(lacune), move)
    corners = _join_corner(planes, mm_per_unit, span)
    floor_y = float(background["origin"][1])
    for item in openings:
        if item.get("kind") == "door":
            # The head stays where it was measured. A door near 2.0–2.1 m is not rounded.
            item["y0"] = floor_y
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
        "lacune": lacune,
        "corners": corners,
        "note": _note(fronts, skipped, openings, lacune),
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
            "step": plane.get("step", "walls" if plane.get("role") in ("background", "terreno", "ritorno") else "extra"),
        }

    def opening_mm(item):
        x0 = round(float(item["x0"]) * scale, 1)
        x1 = round(float(item["x1"]) * scale, 1)
        y0 = round(float(item["y0"]) * scale, 1)
        y1 = round(float(item["y1"]) * scale, 1)
        converted = {
            "kind": item.get("kind", "door"),
            "x0": x0,
            "x1": x1,
            "y0": y0,
            "y1": y1,
            "widthMm": round(x1 - x0, 1),
            "heightMm": round(y1 - y0, 1),
        }
        if item.get("reason"):
            converted["reason"] = item["reason"]
        return converted

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
        "lacune": [opening_mm(item) for item in scene.get("lacune") or []],
        "corners": [dict(item) for item in scene.get("corners") or []],
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
    agreement = float(ground @ up)
    if agreement >= np.cos(np.radians(5)):
        # Averaging a small tilt leaves the floor sloping in the CAD frame.
        return ground, source + "+terreno"
    if agreement >= np.cos(np.radians(25)):
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
        fitted = _fitted_normal(points, normals, normal, plane, mm_per_unit, span)
        if fitted is not None:
            normal = fitted
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


def _fitted_normal(points, normals, normal, plane, mm_per_unit, span):
    """Plane of the points, not the average of noisy normals."""
    band = _mu(50, mm_per_unit, span)
    centre = np.asarray(plane["center"], float)
    offset = float(centre @ normal)
    selected = (normals @ normal > 0.75) & (np.abs(points @ normal - offset) < band)
    if int(selected.sum()) < 80:
        return None
    samples = points[selected]
    centered = samples - samples.mean(0)
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    fitted = vt[-1]
    if float(fitted @ normal) < 0:
        fitted = -fitted
    length = float(np.linalg.norm(fitted))
    if length < 1e-8:
        return None
    return fitted / length


def _floor_level_rotation(points, normals, mm_per_unit, span):
    """Rotation that lays a slightly tilted floor onto +Y, or None."""
    mask = np.abs(normals[:, 1]) >= _HORIZONTAL
    if int(mask.sum()) < 80:
        return None
    band = _mu(60, mm_per_unit, span)
    peaks = _peak_positions(points[mask, 1], _mu(40, mm_per_unit, span), 40)
    normal = None
    for peak in sorted(peaks, key=lambda item: item["pos"]):
        selected = mask & (np.abs(points[:, 1] - float(peak["pos"])) < band)
        if int(selected.sum()) < 80:
            continue
        samples = points[selected]
        centered = samples - samples.mean(0)
        _, _, vt = np.linalg.svd(centered, full_matrices=False)
        fitted = vt[-1]
        if fitted[1] < 0:
            fitted = -fitted
        fitted = fitted / np.linalg.norm(fitted)
        if float(fitted[1]) < np.cos(np.radians(15)):
            continue
        axis_u, axis_v = _inplane(fitted)
        relative = samples - samples.mean(0)
        spans = []
        for axis in (axis_u, axis_v):
            coords = relative @ axis
            spans.append(float(np.percentile(coords, 98) - np.percentile(coords, 2)))
        if min(spans) < _mu(600, mm_per_unit, span) or max(spans) < _mu(1500, mm_per_unit, span):
            continue
        normal = fitted
        break
    if normal is None:
        return None
    vertical = float(normal @ np.array([0.0, 1.0, 0.0]))
    if vertical > np.cos(np.radians(0.25)):
        return None
    if vertical < np.cos(np.radians(5)):
        return None
    return _rotation_from_to(normal, np.array([0.0, 1.0, 0.0]))


def _rotation_from_to(source, target) -> np.ndarray:
    """Rows map ``source`` onto ``target``."""
    source = np.asarray(source, float)
    target = np.asarray(target, float)
    source = source / np.linalg.norm(source)
    target = target / np.linalg.norm(target)
    cross = np.cross(source, target)
    cosine = float(np.dot(source, target))
    sine = float(np.linalg.norm(cross))
    if sine < 1e-10:
        return np.eye(3)
    axis = cross / sine
    skew = np.array(
        [[0.0, -axis[2], axis[1]], [axis[2], 0.0, -axis[0]], [-axis[1], axis[0], 0.0]],
        float,
    )
    return np.eye(3) + skew * sine + (skew @ skew) * (1.0 - cosine)


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
        candidates.append((measured, selected))
    if not candidates and int(mask.sum()) >= 40:
        offsets = points[mask, 2]
        spread = float(np.percentile(offsets, 95) - np.percentile(offsets, 5))
        if spread <= band:
            selected = mask & (np.abs(points[:, 2] - float(np.median(offsets))) < band)
            measured = _measure(points, selected, np.array([0.0, 0.0, 1.0]), mm_per_unit, span, minimum_mm=400, minimum_points=40)
            if measured is not None:
                candidates.append((measured, selected))
    if not candidates:
        raise RuntimeError("Non trovo un piano di fondo abbastanza esteso.")
    measured, selected = max(candidates, key=lambda item: item[0]["width"] * item[0]["height"])
    # Point-count percentiles shrink a sparse but real wing of the wall.
    # Each occupied cell votes once, so a thin strip of wall-face points stays inside.
    _cover_wall_face(measured, points, selected, mm_per_unit, span)
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


def _robust_span(values, bin_w, sparse_low=False):
    """Extent of the wall face.

    Along the facade, a sparse wing that still has points in every bin stays
    inside. The far end is a percentile of the dense run, so a handful of
    outliers does not stretch the slab. The coordinates are the points
    themselves, not histogram edges.
    """
    values = np.asarray(values, float)
    if len(values) < 30:
        low, high = np.percentile(values, [1, 99])
        return float(low), float(high)
    low = float(np.min(values))
    high = float(np.max(values))
    if high - low <= bin_w:
        return low, high
    edges = np.arange(low, high + bin_w, bin_w)
    hist, edges = np.histogram(values, edges)
    occupied = hist[hist > 0]
    if len(occupied) == 0:
        low, high = np.percentile(values, [1, 99])
        return float(low), float(high)
    typical = float(np.median(occupied))
    strong = hist >= max(5.0, 0.04 * typical)
    start, end = _true_run(strong, bridge=1)
    if start is None:
        low, high = np.percentile(values, [1, 99])
        return float(low), float(high)
    core = (values >= float(edges[start])) & (values <= float(edges[min(end, len(edges) - 1)]))
    minimum = max(12.0, 0.004 * typical)
    ext_start = _extend_sparse(hist, start, -1, minimum)
    ext_end = _extend_sparse(hist, end - 1, 1, minimum) + 1
    right = float(edges[min(ext_end, len(edges) - 1)])
    chosen = (values >= float(edges[ext_start])) & (values <= right)
    if int(chosen.sum()) < 30 or int(core.sum()) < 30:
        low, high = np.percentile(values, [1, 99])
        return float(low), float(high)
    if sparse_low:
        low = float(np.min(values[chosen]))
        high = float(np.percentile(values[core], 99.5))
    else:
        low, high = np.percentile(values[chosen], [0.3, 99.5])
    return float(low), float(high)


def _true_run(flags, bridge):
    best = None
    start = None
    gap = 0
    padded = list(flags) + [False] * (bridge + 1)
    for index, flag in enumerate(padded):
        if flag:
            if start is None:
                start = index
            gap = 0
            continue
        if start is None:
            continue
        gap += 1
        if gap > bridge:
            end = index - gap + 1
            if best is None or end - start > best[1] - best[0]:
                best = (start, end)
            start = None
            gap = 0
    return (None, None) if best is None else best


def _extend_sparse(hist, index, step, minimum):
    """Include a connected sparse wing. Stop when the bins go empty."""
    cursor = index
    while True:
        nxt = cursor + step
        if nxt < 0 or nxt >= len(hist) or hist[nxt] < minimum:
            break
        cursor = nxt
    return cursor


def _cover_wall_face(measured, points, selected, mm_per_unit, span):
    samples = points[selected]
    if len(samples) < 40:
        return
    bin_w = _mu(50, mm_per_unit, span)
    x0, x1 = _robust_span(samples[:, 0], bin_w, sparse_low=True)
    y0, y1 = _robust_span(samples[:, 1], bin_w, sparse_low=False)
    if x1 - x0 < _mu(400, mm_per_unit, span) or y1 - y0 < _mu(400, mm_per_unit, span):
        return
    depth = float(np.median(samples[:, 2]))
    measured["width"] = float(x1 - x0)
    measured["height"] = float(y1 - y0)
    measured["origin"] = [float(x0), float(y0), depth]
    measured["center"] = [float((x0 + x1) / 2), float((y0 + y1) / 2), depth]
    measured["support"] = int(len(samples))


def _find_openings(points, normals, background, mm_per_unit, span):
    # Outside the relief band, so brick or tile on the wall is not a second door.
    band = _mu(70, mm_per_unit, span)
    recess = (normals[:, 2] > 0.72) & (points[:, 2] < -band) & (points[:, 2] > -_mu(500, mm_per_unit, span))
    proud = (normals[:, 2] > 0.72) & (points[:, 2] > band) & (points[:, 2] < _mu(400, mm_per_unit, span))
    found = []
    door_mask = np.zeros(len(points), dtype=bool)
    for mask in (recess, proud):
        opening = _bounds_if_door(points, mask, background, mm_per_unit, span)
        if opening is None:
            continue
        if opening["x0"] <= _mu(200, mm_per_unit, span) or opening["x1"] >= float(background["width"]) - _mu(200, mm_per_unit, span):
            continue
        found.append(opening)
        door_mask |= mask
        break
    occupied, width, height = _opening_grid(points, normals, background, mm_per_unit, span)
    extra, lacune = _grid_openings(occupied, width, height, background, points, normals, mm_per_unit, span)
    for opening in extra:
        if any(_overlaps(opening, other) for other in found):
            continue
        found.append(opening)
        door_mask |= _opening_points(points, opening, band)
    lacune = [item for item in lacune if not any(_overlaps(item, other) for other in found)]
    return found, lacune, door_mask


def _opening_points(points, opening, band):
    inside = (
        (points[:, 0] > float(opening["x0"]))
        & (points[:, 0] < float(opening["x1"]))
        & (points[:, 1] > float(opening["y0"]))
        & (points[:, 1] < float(opening["y1"]))
        & (np.abs(points[:, 2]) > band)
    )
    return inside


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


def _grid_openings(occupied, width, height, background, points, normals, mm_per_unit, span):
    ny, nx = occupied.shape
    openings = []
    lacune = []
    # A door is an empty, door-sized gap that reaches the floor, with wall on
    # both sides and a head above it. The gap may start a few hundred
    # millimetres up: a sill is not a reason to drop the opening. Points seen
    # through it are not required.
    near = max(1, int(round(_mu(500, mm_per_unit, span) / height * ny)))
    min_rows = max(4, int(round(_mu(1500, mm_per_unit, span) / height * ny)))
    head_rows = max(2, int(round(_mu(180, mm_per_unit, span) / height * ny)))
    door_span = [_door_gap(occupied[:, index], near, min_rows, head_rows) for index in range(nx)]
    expanded = [span_item is not None for span_item in door_span]
    core = _longest_run(expanded)
    if core is not None and core[1] - core[0] >= 3:
        core_spans = [door_span[index] for index in range(core[0], core[1]) if door_span[index] is not None]
        gap_y0 = int(np.median([item[0] for item in core_spans]))
        gap_y1 = int(np.median([item[1] for item in core_spans]))
        start, stop = core
        while start > 0 and _mostly_open(occupied[gap_y0:gap_y1, start - 1]):
            start -= 1
        while stop < nx and _mostly_open(occupied[gap_y0:gap_y1, stop]):
            stop += 1
        flanked = (
            start > 0
            and stop < nx
            and float(occupied[gap_y0:gap_y1, start - 1].mean()) >= 0.4
            and float(occupied[gap_y0:gap_y1, stop].mean()) >= 0.4
        )
        y1 = gap_y1 / ny * height
        opening = _accept_door(start / nx * width, stop / nx * width, 0.0, y1, background, mm_per_unit, span) if flanked else None
        if opening is not None:
            openings.append(opening)
    gaps = [_column_gaps(occupied[:, index]) for index in range(nx)]
    used = np.zeros(nx, dtype=bool)
    for index in range(nx):
        if used[index] or not gaps[index]:
            continue
        seed = max(gaps[index], key=lambda gap: gap[1] - gap[0])
        columns = [index]
        spans = [seed]
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
            spans.append(match)
            used[other] = True
            y0 = min(y0, match[0])
            y1 = max(y1, match[1])
        if len(columns) < 3 or y1 - y0 < 3:
            continue
        # The shared band, not the union. One column that runs out to the
        # ceiling must not erase the interior hole or paint over wall.
        core_y0 = int(np.median([item[0] for item in spans]))
        core_y1 = int(np.median([item[1] for item in spans]))
        if core_y1 - core_y0 < 3:
            continue
        patch = occupied[core_y0:core_y1, columns[0] : columns[-1] + 1]
        if patch.size == 0 or float(patch.mean()) > 0.25:
            continue
        x0 = columns[0] / nx * width
        x1 = (columns[-1] + 1) / nx * width
        gy0 = core_y0 / ny * height
        gy1 = core_y1 / ny * height
        margin = _mu(150, mm_per_unit, span)
        inside = x0 >= margin and gy0 >= margin and x1 <= width - margin and gy1 <= height - margin
        # A gap on the outer edge is the wall ending, not a hole in the data.
        if not inside:
            continue
        opening = _accept_window(x0, x1, gy0, gy1, background, mm_per_unit, span)
        if opening is not None and _has_opening_evidence(points, normals, x0, x1, gy0, gy1, mm_per_unit, span):
            openings.append(opening)
            continue
        if x1 - x0 >= _mu(400, mm_per_unit, span) and gy1 - gy0 >= _mu(300, mm_per_unit, span):
            lacune.append({"kind": "lacuna", "x0": float(x0), "x1": float(x1), "y0": float(gy0), "y1": float(gy1), "reason": "dati mancanti"})
    return openings, lacune


def _has_opening_evidence(points, normals, x0, x1, y0, y1, mm_per_unit, span) -> bool:
    """A hole is an opening only when something shows it is not missing data.

    Points seen through it, behind the wall, or a reveal set back around the
    frame. Empty cells by themselves are a lacuna.
    """
    inset = _mu(30, mm_per_unit, span)
    inside = (
        (points[:, 0] > x0 + inset)
        & (points[:, 0] < x1 - inset)
        & (points[:, 1] > y0 + inset)
        & (points[:, 1] < y1 - inset)
    )
    behind = inside & (normals[:, 2] > 0.45) & (points[:, 2] < -_mu(60, mm_per_unit, span)) & (points[:, 2] > -_mu(700, mm_per_unit, span))
    if int(behind.sum()) >= 20:
        return True
    band = _mu(160, mm_per_unit, span)
    # Past the wall relief. A point 50 mm off the face is brick or noise, not a jamb.
    near = (np.abs(points[:, 2]) > _mu(80, mm_per_unit, span)) & (np.abs(points[:, 2]) < _mu(280, mm_per_unit, span)) & (normals[:, 2] > 0.45)
    # A frame goes around the hole. A picture or a shelf on one side does not.
    sides = (
        near & (points[:, 0] > x0 - band) & (points[:, 0] < x0) & (points[:, 1] > y0) & (points[:, 1] < y1),
        near & (points[:, 0] > x1) & (points[:, 0] < x1 + band) & (points[:, 1] > y0) & (points[:, 1] < y1),
        near & (points[:, 1] > y0 - band) & (points[:, 1] < y0) & (points[:, 0] > x0) & (points[:, 0] < x1),
        near & (points[:, 1] > y1) & (points[:, 1] < y1 + band) & (points[:, 0] > x0) & (points[:, 0] < x1),
    )
    return sum(int(side.sum()) >= 8 for side in sides) >= 3


def _door_gap(column, near, min_rows, head_rows):
    """Tallest empty run that starts near the floor and has wall above it."""
    best = None
    for y0, y1 in _empty_runs(column):
        if y0 > near or y1 - y0 < min_rows or y1 >= len(column) - 1:
            continue
        head = column[y1 : y1 + head_rows]
        if len(head) < head_rows or float(head.mean()) < 0.5:
            continue
        if best is None or y1 - y0 > best[1] - best[0]:
            best = (y0, y1)
    return best


def _mostly_open(column) -> bool:
    if len(column) == 0:
        return False
    return float(np.mean(column)) <= 0.45


def _empty_runs(column):
    """Empty runs of at least two cells, including a run that touches the floor."""
    runs = []
    start = None
    for index, flag in enumerate(column):
        if not flag and start is None:
            start = index
        elif flag and start is not None:
            if index - start >= 2:
                runs.append((start, index))
            start = None
    if start is not None and len(column) - start >= 2:
        runs.append((start, len(column)))
    return runs


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


def _column_gaps(column):
    """Empty runs that do not touch the floor. A run open at the top is included."""
    gaps = []
    start = None
    for index, flag in enumerate(column):
        if not flag and start is None:
            start = index
        elif flag and start is not None:
            if start > 0 and index - start >= 2:
                gaps.append((start, index))
            start = None
    if start is not None and start > 0 and len(column) - start >= 2:
        gaps.append((start, len(column)))
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
    normal = normal / length
    # Canonicalizing the major axis can point the normal away from the points.
    raw = chosen[keys == best].mean(0)
    if float(raw @ normal) < 0:
        normal = -normal
    return normal


def _orient_front(normal: np.ndarray) -> np.ndarray:
    normal = normal / np.linalg.norm(normal)
    if abs(float(normal[1])) >= 0.7:
        return normal if normal[1] > 0 else -normal
    # A side wall is mostly along X. Flipping it because of a small Z
    # component turns the normal away from its points.
    if abs(float(normal[2])) >= 0.7 and float(normal[2]) < 0:
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


def _snap_orthogonal(planes, limit_deg=5.0):
    """Near-axis slabs become exact boxes. A 2° floor or return is not a CAD tilt."""
    limit = float(np.cos(np.radians(limit_deg)))
    for plane in planes:
        normal = np.asarray(plane["normal"], float)
        length = float(np.linalg.norm(normal))
        if length < 1e-8:
            continue
        normal = normal / length
        axis = int(np.argmax(np.abs(normal)))
        if abs(float(normal[axis])) < limit:
            continue
        snapped = np.zeros(3)
        snapped[axis] = 1.0 if normal[axis] >= 0 else -1.0
        corners = np.vstack(_face_corners(plane))
        centre = corners.mean(0)
        axis_u, axis_v = _inplane(snapped)
        relative = corners - centre
        coords_u = relative @ axis_u
        coords_v = relative @ axis_v
        u0, u1 = float(coords_u.min()), float(coords_u.max())
        v0, v1 = float(coords_v.min()), float(coords_v.max())
        origin = centre + axis_u * u0 + axis_v * v0
        plane["normal"] = [float(v) for v in snapped]
        plane["axisU"] = [float(v) for v in axis_u]
        plane["axisV"] = [float(v) for v in axis_v]
        plane["width"] = u1 - u0
        plane["height"] = v1 - v0
        plane["origin"] = [float(v) for v in origin]
        plane["center"] = [float(v) for v in origin + axis_u * ((u1 - u0) / 2.0) + axis_v * ((v1 - v0) / 2.0)]


def _seat_floor(planes):
    """Put the ground face on Y=0. The wall then stands on that slab."""
    floors = [plane for plane in planes if plane.get("role") == "terreno"]
    if not floors:
        return np.zeros(3)
    corners = np.vstack([corner for plane in floors for corner in _face_corners(plane)])
    move = np.array([0.0, -float(np.median(corners[:, 1])), 0.0])
    if abs(float(move[1])) < 1e-6:
        return np.zeros(3)
    for plane in planes:
        origin = np.asarray(plane["origin"], float) + move
        center = np.asarray(plane["center"], float) + move
        plane["origin"] = [float(v) for v in origin]
        plane["center"] = [float(v) for v in center]
    return move


def _solid_frame(plane):
    """Box frame: back corner, then edges along U, V and the outward normal."""
    origin = np.asarray(plane["origin"], float)
    normal = np.asarray(plane["normal"], float)
    thickness = float(plane["thickness"])
    back = origin - normal * thickness
    edges = [
        np.asarray(plane["axisU"], float) * float(plane["width"]),
        np.asarray(plane["axisV"], float) * float(plane["height"]),
        normal * thickness,
    ]
    return back, edges


def _aabb_from_frame(back, edges):
    corners = []
    for u in (0.0, 1.0):
        for v in (0.0, 1.0):
            for t in (0.0, 1.0):
                corners.append(back + edges[0] * u + edges[1] * v + edges[2] * t)
    stacked = np.vstack(corners)
    return stacked.min(0), stacked.max(0)


def _solid_aabb(plane):
    return _aabb_from_frame(*_solid_frame(plane))


def _write_frame(plane, back, edges):
    width = float(np.linalg.norm(edges[0]))
    height = float(np.linalg.norm(edges[1]))
    thickness = float(np.linalg.norm(edges[2]))
    if width < 1e-6 or height < 1e-6 or thickness < 1e-6:
        return
    axis_u = edges[0] / width
    axis_v = edges[1] / height
    normal = edges[2] / thickness
    origin = back + edges[2]
    plane["origin"] = [float(v) for v in origin]
    plane["axisU"] = [float(v) for v in axis_u]
    plane["axisV"] = [float(v) for v in axis_v]
    plane["normal"] = [float(v) for v in normal]
    plane["width"] = width
    plane["height"] = height
    plane["thickness"] = thickness
    center = origin + axis_u * (width / 2.0) + axis_v * (height / 2.0)
    plane["center"] = [float(v) for v in center]


def _retarget_solid(plane, x=None, y=None, z=None):
    """Move one side of an axis-aligned slab. The other two axes stay put."""
    back, edges = _solid_frame(plane)
    for axis, span in enumerate((x, y, z)):
        if span is None:
            continue
        lo, hi = float(span[0]), float(span[1])
        if hi < lo:
            lo, hi = hi, lo
        index = max(range(3), key=lambda i: abs(float(edges[i][axis])))
        edge = edges[index]
        if abs(float(edge[axis])) < 1e-8:
            continue
        sign = 1.0 if edge[axis] >= 0 else -1.0
        edges[index] = edge * ((hi - lo) / abs(float(edge[axis])))
        back = back.copy()
        back[axis] = lo if sign > 0 else hi
    _write_frame(plane, back, edges)


def snap_scene_corners(scene_mm) -> list:
    """Close corners on an exported millimetre scene. Returns the pre-snap gaps."""
    planes = scene_mm.get("planes") or []
    linked = []
    for plane in planes:
        if "originMm" not in plane:
            continue
        linked.append((plane, _plane_from_mm(plane)))
    corners = _join_corner([item[1] for item in linked], 1.0, 8000.0)
    for plane, internal in linked:
        _plane_to_mm(plane, internal)
    return corners


def _plane_from_mm(plane) -> dict:
    return {
        "role": plane.get("role"),
        "step": plane.get("step"),
        "type": plane.get("type"),
        "width": float(plane["widthMm"]),
        "height": float(plane["heightMm"]),
        "thickness": float(plane["thicknessMm"]),
        "origin": [float(v) for v in plane["originMm"]],
        "center": [float(v) for v in plane.get("centerMm") or plane["originMm"]],
        "axisU": [float(v) for v in plane["axisU"]],
        "axisV": [float(v) for v in plane["axisV"]],
        "normal": [float(v) for v in plane["normal"]],
    }


def _plane_to_mm(plane, internal):
    plane["widthMm"] = round(float(internal["width"]), 1)
    plane["heightMm"] = round(float(internal["height"]), 1)
    plane["thicknessMm"] = round(float(internal["thickness"]), 1)
    plane["originMm"] = [round(float(v), 1) for v in internal["origin"]]
    plane["centerMm"] = [round(float(v), 1) for v in internal["center"]]
    plane["axisU"] = [round(float(v), 6) for v in internal["axisU"]]
    plane["axisV"] = [round(float(v), 6) for v in internal["axisV"]]
    plane["normal"] = [round(float(v), 6) for v in internal["normal"]]


def _join_corner(planes, mm_per_unit, span):
    """Close the corner: return flush with the wall end, both standing on Y=0.

    The gate is only that the return is the perpendicular wall at that end and
    its near face is within about 600 mm. Lengths use the cloud scale, so a
    150 mm slab is never rejected for being thinner than one model unit.
    Bottoms go to the floor. Heights within about 100 mm share the taller one.
    The floor then runs from the wall start to the return's outer face and at
    least as deep as the return.
    """
    background = next((plane for plane in planes if plane.get("role") == "background"), None)
    if background is None:
        return []
    ritorno = next((plane for plane in planes if plane.get("role") == "ritorno" and plane.get("step") == "walls"), None)
    corners = []
    if ritorno is not None and _return_at_end(background, ritorno, _mu(600.0, mm_per_unit, span)):
        corners.append(_corner_report(background, ritorno, mm_per_unit))
        _flush_return(background, ritorno)
    _seat_wall_bottom(background)
    if ritorno is not None:
        _seat_wall_bottom(ritorno)
        _match_wall_heights(background, ritorno, _mu(100.0, mm_per_unit, span))
    _span_floor(planes, background, ritorno)
    return corners


def _return_at_end(background, ritorno, tolerance) -> bool:
    bg0, bg1 = _solid_aabb(background)
    rt0, rt1 = _solid_aabb(ritorno)
    dist_right = abs(float(rt0[0] - bg1[0]))
    dist_left = abs(float(rt1[0] - bg0[0]))
    return min(dist_right, dist_left) <= tolerance


def _corner_report(background, ritorno, mm_per_unit) -> dict:
    """Gap and Z offset before the slabs are moved, in millimetres."""
    scale = float(mm_per_unit) if mm_per_unit and float(mm_per_unit) > 0 else 1.0
    bg0, bg1 = _solid_aabb(background)
    rt0, rt1 = _solid_aabb(ritorno)
    dist_right = abs(float(rt0[0] - bg1[0]))
    dist_left = abs(float(rt1[0] - bg0[0]))
    if dist_right <= dist_left:
        end = "right"
        gap = max(0.0, float(rt0[0] - bg1[0]))
    else:
        end = "left"
        gap = max(0.0, float(bg0[0] - rt1[0]))
    # Wall face is the camera side. A positive offset means the return starts in front of it.
    offset = max(0.0, float(rt0[2] - bg1[2]))
    return {
        "end": end,
        "gapMm": round(gap * scale, 1),
        "offsetMm": round(offset * scale, 1),
        "action": "snapped",
    }


def _flush_return(background, ritorno):
    bg0, bg1 = _solid_aabb(background)
    rt0, rt1 = _solid_aabb(ritorno)
    dist_right = abs(float(rt0[0] - bg1[0]))
    dist_left = abs(float(rt1[0] - bg0[0]))
    thick = float(rt1[0] - rt0[0])
    if thick <= 1e-9:
        return
    if dist_right <= dist_left:
        outer = float(rt1[0])
        _retarget_solid(background, x=(float(bg0[0]), outer))
        _retarget_solid(ritorno, x=(outer - thick, outer))
    else:
        outer = float(rt0[0])
        _retarget_solid(background, x=(outer, float(bg1[0])))
        _retarget_solid(ritorno, x=(outer, outer + thick))
    bg0, bg1 = _solid_aabb(background)
    rt0, rt1 = _solid_aabb(ritorno)
    # The return must pass through the wall thickness, not stop in front of the face.
    if float(rt0[2] + rt1[2]) >= float(bg0[2] + bg1[2]):
        _retarget_solid(ritorno, z=(min(float(rt0[2]), float(bg0[2])), float(rt1[2])))
    else:
        _retarget_solid(ritorno, z=(float(rt0[2]), max(float(rt1[2]), float(bg1[2]))))


def _seat_wall_bottom(plane):
    """The slab stands on the floor. The measured top stays."""
    lo, hi = _solid_aabb(plane)
    if float(hi[1]) <= 0.0:
        return
    _retarget_solid(plane, y=(0.0, float(hi[1])))


def _match_wall_heights(background, ritorno, tolerance):
    bg0, bg1 = _solid_aabb(background)
    rt0, rt1 = _solid_aabb(ritorno)
    bg_h = float(bg1[1] - bg0[1])
    rt_h = float(rt1[1] - rt0[1])
    if abs(bg_h - rt_h) > tolerance:
        return
    top = max(float(bg1[1]), float(rt1[1]))
    _retarget_solid(background, y=(0.0, top))
    _retarget_solid(ritorno, y=(0.0, top))


def _span_floor(planes, background, ritorno):
    floor = next((plane for plane in planes if plane.get("role") == "terreno"), None)
    if floor is None:
        return
    bg0, bg1 = _solid_aabb(background)
    f0, f1 = _solid_aabb(floor)
    x0, x1 = float(bg0[0]), float(bg1[0])
    z0, z1 = float(f0[2]), float(f1[2])
    if ritorno is not None:
        rt0, rt1 = _solid_aabb(ritorno)
        mid = 0.5 * (x0 + x1)
        if float(rt1[0]) >= mid:
            x1 = max(x1, float(rt1[0]))
        else:
            x0 = min(x0, float(rt0[0]))
        z0 = min(z0, float(rt0[2]), float(bg0[2]))
        z1 = max(z1, float(rt1[2]), float(bg1[2]))
    _retarget_solid(floor, x=(x0, x1), z=(z0, z1))


def _raise_wall_to_floor(planes):
    """The facade stands on the floor. Noise below Y=0 is not part of the slab."""
    wall = next(plane for plane in planes if plane.get("role") == "background")
    bottom = float(wall["origin"][1])
    if bottom >= -1e-6:
        return
    wall["origin"][1] = 0.0
    wall["height"] = max(1.0, float(wall["height"]) + bottom)
    wall["center"][1] = float(wall["height"]) / 2.0


def _shift_openings(items, move):
    for item in items:
        item["x0"] = float(item["x0"]) + float(move[0])
        item["x1"] = float(item["x1"]) + float(move[0])
        item["y0"] = float(item["y0"]) + float(move[1])
        item["y1"] = float(item["y1"]) + float(move[1])


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


def _assign_steps(planes):
    """walls.step is the facade, an optional return, and the ground. The rest is extra."""
    background = next(plane for plane in planes if plane.get("role") == "background")
    wall_w = float(background["width"])
    wall_h = float(background["height"])
    for plane in planes:
        role = plane.get("role")
        if role in ("background", "terreno"):
            plane["step"] = "walls"
            continue
        plane["step"] = "extra"
    # One return, at an end. A second tall plane there is a jamb or a cabinet.
    returns = [plane for plane in planes if _return_wall(plane, wall_w, wall_h)]
    returns.sort(key=lambda plane: float(plane["width"]) * float(plane["height"]), reverse=True)
    if returns:
        chosen = returns[0]
        chosen["role"] = "ritorno"
        chosen["thickness"] = background["thickness"]
        chosen["thicknessSource"] = "parete"
        chosen["step"] = "walls"


def _return_wall(plane, wall_w, wall_h) -> bool:
    if plane.get("type") != "verticale":
        return False
    normal = np.asarray(plane["normal"], float)
    if abs(float(normal[0])) < 0.75 or abs(float(normal[2])) > 0.45:
        return False
    vertical = _vertical_extent(plane)
    if vertical < 0.75 * wall_h:
        return False
    xs = [float(corner[0]) for corner in _face_corners(plane)]
    x_min, x_max = min(xs), max(xs)
    if x_max - x_min > 0.35 * wall_w:
        return False
    return x_min < 0.25 * wall_w or x_max > 0.75 * wall_w


def _vertical_extent(plane) -> float:
    ys = [float(corner[1]) for corner in _face_corners(plane)]
    return max(ys) - min(ys)


def _note(fronts, skipped, openings, lacune=()) -> str:
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
    if lacune:
        text += f" {len(lacune)} lacune nei dati, non tagliate."
    if skipped:
        skipped_noun = "superficie scartata" if len(skipped) == 1 else "superfici scartate"
        text += f" {len(skipped)} {skipped_noun}."
    return text
