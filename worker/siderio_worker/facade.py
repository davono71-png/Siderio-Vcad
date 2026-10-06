"""Facade / object-against-a-wall capture.

A room needs a floor and a ceiling. A facade does not: the useful solid is the
dominant background plane (the wall), plus planar faces in front of it that are
large enough to trust (desk top, monitor). Anything smaller is listed as skipped
and is not turned into geometry.
"""

from __future__ import annotations

import numpy as np

from .room import _mu, _peaks

# Front faces are a single visible side. 20 mm is only enough to make a solid.
FRONT_SLAB_MM = 20.0


def detect_facade(points, normals, cameras=None, mm_per_unit=None, up_prior=None, wall_thickness_mm=150.0, slab_thickness_mm=FRONT_SLAB_MM):
    cloud = np.asarray(points, float)
    norms = _unit_rows(np.asarray(normals, float))
    if len(cloud) < 80:
        raise RuntimeError("Non trovo un piano di fondo abbastanza esteso.")
    span = float(np.linalg.norm(np.percentile(cloud, 95, axis=0) - np.percentile(cloud, 5, axis=0)))
    facing = _facing_direction(cloud, cameras)
    # A desk top faces a camera that looks down. The wall is the vertical plane
    # behind it, so the search first ignores the component along gravity.
    background_normal = _dominant_facing_normal(norms, _horizontal_facing(facing, up_prior))
    if background_normal is None:
        background_normal = _dominant_facing_normal(norms, facing)
    if background_normal is None:
        raise RuntimeError("Non trovo un piano di fondo abbastanza esteso.")
    rotation = _frame_axes(background_normal, up_prior)
    centre = np.asarray(cameras, float).reshape(-1, 3).mean(0) if cameras is not None and len(cameras) else cloud.mean(0)
    aligned = (cloud - centre) @ rotation.T
    aligned_normals = norms @ rotation.T
    background, shift = _background_plane(aligned, aligned_normals, mm_per_unit, span, wall_thickness_mm)
    aligned = aligned + shift
    fronts, skipped = _front_planes(aligned, aligned_normals, mm_per_unit, span, slab_thickness_mm)
    planes = [background] + fronts
    _park_on_ground(planes)
    dims = _dims(planes)
    transform = np.eye(4)
    transform[:3, :3] = rotation
    transform[:3, 3] = -rotation @ centre + shift
    note = _note(len(fronts), skipped)
    return {
        "units": "model",
        "mode": "facciata",
        "mm_per_unit": mm_per_unit,
        "transform_colmap_to_room": transform.tolist(),
        "convention": "X orizzontale sulla facciata, Y in alto, Z verso la camera. Il piano di fondo è Z=0; lo spessore cresce verso Z negativo.",
        "dims": dims,
        "planes": planes,
        "skipped": skipped,
        "note": note,
        "openings": [],
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

    return {
        "units": "mm",
        "mode": "facciata",
        "mm_per_unit": scale,
        "convention": scene["convention"],
        "note": scene["note"],
        "dims": {
            "length_x": round(float(dims["length_x"]) * scale, 1),
            "width_y": round(float(dims["width_y"]) * scale, 1),
            "height_z": round(float(dims["height_z"]) * scale, 1),
        },
        "planes": [plane_mm(plane) for plane in scene["planes"]],
        "skipped": list(scene.get("skipped") or []),
        "openings": [],
        "transform_colmap_to_room_mm": (np.diag([scale, scale, scale, 1.0]) @ np.asarray(scene["transform_colmap_to_room"], float)).tolist(),
    }


def _unit_rows(normals: np.ndarray) -> np.ndarray:
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.clip(lengths, 1e-9, None)


def _facing_direction(points, cameras) -> np.ndarray:
    """Unit vector that points from the scene back toward the cameras."""
    centre = np.median(points, axis=0)
    if cameras is not None and len(cameras):
        origin = np.asarray(cameras, float).reshape(-1, 3).mean(0)
        direction = origin - centre
    else:
        direction = np.array([0.0, 0.0, 1.0])
    length = float(np.linalg.norm(direction))
    if length < 1e-6:
        return np.array([0.0, 0.0, 1.0])
    return direction / length


def _horizontal_facing(facing, up_prior) -> np.ndarray:
    up = np.array([0.0, 0.0, 1.0]) if up_prior is None else np.asarray(up_prior, float)
    up_length = float(np.linalg.norm(up))
    up = up / up_length if up_length > 1e-9 else np.array([0.0, 0.0, 1.0])
    horizontal = facing - up * float(facing @ up)
    length = float(np.linalg.norm(horizontal))
    if length < 0.25:
        return facing
    return horizontal / length


def _dominant_facing_normal(normals, facing) -> np.ndarray | None:
    score = normals @ facing
    mask = np.abs(score) > 0.72
    if int(mask.sum()) < 50:
        mask = np.abs(score) > 0.55
    if int(mask.sum()) < 40:
        return None
    chosen = normals[mask].copy()
    chosen[chosen @ facing < 0] *= -1
    normal = chosen.mean(0)
    length = float(np.linalg.norm(normal))
    if length < 1e-8:
        return None
    normal = normal / length
    if float(normal @ facing) < 0:
        normal = -normal
    return normal


def _frame_axes(normal, up_prior) -> np.ndarray:
    """Rows are X (horizontal), Y (up), Z (toward the camera)."""
    axis_z = normal / np.linalg.norm(normal)
    up = np.array([0.0, 0.0, 1.0]) if up_prior is None else np.asarray(up_prior, float)
    up_length = float(np.linalg.norm(up))
    up = up / up_length if up_length > 1e-9 else np.array([0.0, 0.0, 1.0])
    axis_y = up - axis_z * float(up @ axis_z)
    if float(np.linalg.norm(axis_y)) < 0.25:
        axis_y = np.array([1.0, 0.0, 0.0]) - axis_z * float(axis_z[0])
    axis_y = axis_y / np.linalg.norm(axis_y)
    axis_x = np.cross(axis_y, axis_z)
    axis_x = axis_x / np.linalg.norm(axis_x)
    return np.stack([axis_x, axis_y, axis_z])


def _background_plane(points, normals, mm_per_unit, span, wall_thickness_mm):
    band = _mu(35, mm_per_unit, span)
    mask = normals[:, 2] > 0.78
    peaks = _peaks(points[mask, 2], _mu(40, mm_per_unit, span), 40)
    candidates = []
    for peak in peaks:
        selected = mask & (np.abs(points[:, 2] - peak["pos"]) < band)
        measured = _measure(points, selected, np.array([0.0, 0.0, 1.0]), mm_per_unit, span, minimum_mm=300, minimum_points=50)
        if measured is None:
            continue
        measured["role"] = "background"
        measured["type"] = "facciata"
        measured["thickness"] = _mu(wall_thickness_mm, mm_per_unit, span)
        measured["thicknessSource"] = "parete"
        candidates.append(measured)
    if not candidates:
        raise RuntimeError("Non trovo un piano di fondo abbastanza esteso.")
    # Toward the camera is +Z, so the background is the farthest qualified plane.
    chosen = min(candidates, key=lambda plane: plane["center"][2])
    origin = np.asarray(chosen["origin"], float)
    shift = np.array([-origin[0], -origin[1], -origin[2]])
    chosen["origin"] = [0.0, 0.0, 0.0]
    chosen["center"] = [chosen["width"] / 2.0, chosen["height"] / 2.0, 0.0]
    return chosen, shift


def _front_planes(points, normals, mm_per_unit, span, slab_thickness_mm):
    band = _mu(35, mm_per_unit, span)
    used = (normals[:, 2] > 0.78) & (np.abs(points[:, 2]) < band)
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
        peaks = _peaks(points[free] @ normal, _mu(40, mm_per_unit, span), 20)
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
            center_z = float(measured["center"][2])
            if center_z < -_mu(40, mm_per_unit, span):
                skipped.append({"reason": "dietro il piano di fondo", "support": support})
                continue
            if abs(float(normal[2])) > 0.9 and abs(center_z) < _mu(40, mm_per_unit, span):
                skipped.append({"reason": "coincide con il piano di fondo", "support": support})
                continue
            measured["role"] = "front"
            measured["type"] = _plane_type(normal)
            measured["thickness"] = _mu(slab_thickness_mm, mm_per_unit, span)
            measured["thicknessSource"] = "nominale"
            found.append(measured)
        if not consumed.any():
            match = free & (normals @ normal > 0.78)
            if int(match.sum()) < 20:
                break
            skipped.append({"reason": "non planare", "support": int(match.sum())})
            used |= match
            continue
        used |= consumed
    found.sort(key=lambda plane: plane["support"], reverse=True)
    if len(found) > 5:
        for extra in found[5:]:
            skipped.append({"reason": "superficie minore, non esportata", "support": extra["support"]})
        found = found[:5]
    return found, skipped


def _largest_normal(normals, mask) -> np.ndarray | None:
    chosen = normals[mask]
    major = np.argmax(np.abs(chosen), axis=1)
    canonical = chosen.copy()
    flip = canonical[np.arange(len(canonical)), major] < 0
    canonical[flip] *= -1
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
    # A desk top should face up. A face parallel to the wall should face the camera.
    if abs(float(normal[1])) >= 0.7:
        return normal if normal[1] > 0 else -normal
    if float(normal[2]) < 0:
        return -normal
    return normal


def _plane_type(normal: np.ndarray) -> str:
    if abs(float(normal[1])) > 0.85:
        return "orizzontale"
    if abs(float(normal[2])) > 0.85:
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
        return
    for plane in planes:
        origin = np.asarray(plane["origin"], float) + move
        center = np.asarray(plane["center"], float) + move
        plane["origin"] = [float(v) for v in origin]
        plane["center"] = [float(v) for v in center]


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


def _note(front_count: int, skipped) -> str:
    if front_count == 0:
        return "Solo il piano di fondo è affidabile: non ci sono altre superfici piane abbastanza estese."
    noun = "superficie" if front_count == 1 else "superfici"
    text = f"Piano di fondo e {front_count} {noun} davanti."
    if skipped:
        skipped_noun = "superficie scartata" if len(skipped) == 1 else "superfici scartate"
        text += f" {len(skipped)} {skipped_noun}."
    return text
