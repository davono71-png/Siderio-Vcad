"""Floor, ceiling and wall planes.

The prototype picked the largest vertical plane on each side, so a wardrobe front
and a painting won over the real walls. Here the room shell is the outer edge of
the floor and of the ceiling (a narrow leak through a door is ignored). A vertical
plane is accepted only when it sits on that edge and covers a real fraction of
the wall. Furniture inset from the shell is reported and discarded.

Overrides, when present, are positions in the aligned frame before the origin
shift (the same frame as ``worker/prototipo/room_config.json``).
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

# Lengths below are millimetres. They are converted with mm_per_unit when the
# survey has a scale, otherwise with the scene diameter so a facade still runs.


def _mu(mm: float, mm_per_unit: float | None, span: float) -> float:
    if mm_per_unit and mm_per_unit > 0:
        return mm / mm_per_unit
    return (mm / 4000.0) * max(span, 1e-6)


def orient_normals(points: np.ndarray, normals: np.ndarray, origin: np.ndarray) -> np.ndarray:
    out = np.array(normals, dtype=np.float64, copy=True)
    flip = np.sum(out * (origin - points), axis=1) < 0
    out[flip] *= -1
    return out


def align_frame(points, normals, cameras, up_prior=None):
    """Return points in a Z-up, Manhattan-aligned frame (origin still arbitrary)."""
    P = np.asarray(points, float)
    N = np.asarray(normals, float)
    C = np.asarray(cameras, float).reshape(-1, 3) if cameras is not None and len(cameras) else np.zeros((0, 3))
    centre = C.mean(0) if len(C) else P.mean(0)
    N = orient_normals(P, N, centre)
    if up_prior is None:
        up = np.array([0.0, 0.0, 1.0])
    else:
        up = np.asarray(up_prior, float)
        nrm = np.linalg.norm(up)
        up = up / nrm if nrm > 1e-9 else np.array([0.0, 0.0, 1.0])
    prior = up.copy()
    for _ in range(4):
        mask = np.abs(N @ up) > np.cos(np.radians(20))
        if int(mask.sum()) < 40:
            break
        _, eigvecs = np.linalg.eigh(N[mask].T @ N[mask])
        refined = eigvecs[:, -1]
        up = refined * np.sign(refined @ up)

    # Reference +X is the horizontal projection of world +X, so an already
    # axis-aligned room keeps its length on X. The 4-fold yaw then stays inside
    # ±45° and cannot swap the two wall directions.
    ref = np.array([1.0, 0.0, 0.0])
    ref = ref - up * float(ref @ up)
    if np.linalg.norm(ref) < 0.25:
        ref = np.array([0.0, 1.0, 0.0])
        ref = ref - up * float(ref @ up)
    e1 = ref / np.linalg.norm(ref)
    e2 = np.cross(up, e1)
    e2 /= np.linalg.norm(e2)
    horizontal = np.abs(N @ up) < np.sin(np.radians(18))
    yaw = 0.0
    strength = 0.0
    if int(horizontal.sum()) >= 40:
        Nh = N[horizontal] - np.outer(N[horizontal] @ up, up)
        theta = np.arctan2(Nh @ e2, Nh @ e1)
        mean = np.exp(4j * theta).mean()
        strength = float(abs(mean))
        yaw = float(np.angle(mean) / 4.0)
    ex = np.cos(yaw) * e1 + np.sin(yaw) * e2
    ey = np.cross(up, ex)
    rotation = np.stack([ex, ey, up])
    aligned = (P - centre) @ rotation.T
    aligned_normals = N @ rotation.T
    aligned_cams = (C - centre) @ rotation.T if len(C) else C
    return {
        "points": aligned,
        "normals": aligned_normals,
        "cameras": aligned_cams,
        "rotation": rotation,
        "centre": centre,
        "up": up,
        "up_prior": prior,
        "yaw": yaw,
        "manhattan_strength": strength,
    }


def _peaks(values: np.ndarray, bin_w: float, min_count: int):
    if len(values) < min_count:
        return []
    lo, hi = float(values.min()), float(values.max())
    if hi - lo < bin_w:
        return [{"pos": float(np.median(values)), "support": int(len(values))}]
    edges = np.arange(lo - bin_w, hi + 2 * bin_w, bin_w)
    hist, edges = np.histogram(values, edges)
    smooth = ndimage.uniform_filter1d(hist.astype(float), 3)
    centres = (edges[:-1] + edges[1:]) / 2
    found = []
    for i in range(1, len(smooth) - 1):
        if smooth[i] >= smooth[i - 1] and smooth[i] >= smooth[i + 1] and hist[i] >= min_count:
            found.append({"pos": float(centres[i]), "support": int(hist[i])})
    if not found:
        i = int(np.argmax(hist))
        found.append({"pos": float(centres[i]), "support": int(hist[i])})
    return found


def _extent_ok(xy: np.ndarray, scene_min, scene_max, frac=0.28) -> bool:
    if len(xy) < 30:
        return False
    span = np.maximum(scene_max - scene_min, 1e-6)
    width = np.percentile(xy, 95, axis=0) - np.percentile(xy, 5, axis=0)
    return bool(np.all(width >= frac * span))


def _height_ok(low, high, mm_per_unit, span) -> bool:
    gap = float(high) - float(low)
    return _mu(800, mm_per_unit, span) < gap <= _mu(5000, mm_per_unit, span)


def _surface_candidates(points, normals, sign, mm_per_unit, span, cos, min_count):
    scene_min = np.percentile(points[:, :2], 5, axis=0)
    scene_max = np.percentile(points[:, :2], 95, axis=0)
    bin_w = _mu(40, mm_per_unit, span)
    mask = normals[:, 2] * sign > cos
    out = []
    for peak in _peaks(points[mask, 2], bin_w, min_count):
        sel = mask & (np.abs(points[:, 2] - peak["pos"]) < _mu(50, mm_per_unit, span))
        xy = points[sel, :2]
        out.append(
            {
                "pos": peak["pos"],
                "support": int(sel.sum()),
                "large": _extent_ok(xy, scene_min, scene_max),
            }
        )
    return out


def _prefer_plane(candidates, want_low):
    """Large plane if one exists, otherwise the outermost peak."""
    if not candidates:
        return None, None
    large = [c for c in candidates if c["large"]]
    pool = large or candidates
    chosen = min(pool, key=lambda c: c["pos"]) if want_low else max(pool, key=lambda c: c["pos"])
    return float(chosen["pos"]), ("plane" if chosen["large"] else "fallback-peak")


def _fallback_level(points, cameras, anchor, want_high, mm_per_unit, span):
    """Percentile of the cloud, then camera centres. Both must leave a real room height."""
    percentile = 98.0 if want_high else 2.0
    z = float(np.percentile(points[:, 2], percentile))
    if want_high:
        far_enough = (z - anchor) >= _mu(2000, mm_per_unit, span)
        plausible = _height_ok(anchor, z, mm_per_unit, span)
    else:
        far_enough = (anchor - z) >= _mu(2000, mm_per_unit, span)
        plausible = _height_ok(z, anchor, mm_per_unit, span)
    if far_enough and plausible:
        return z, "fallback-percentile"
    if cameras is not None and len(cameras):
        margin = _mu(200, mm_per_unit, span)
        z = float(np.max(cameras[:, 2]) + margin) if want_high else float(np.min(cameras[:, 2]) - margin)
        plausible = _height_ok(anchor, z, mm_per_unit, span) if want_high else _height_ok(z, anchor, mm_per_unit, span)
        if plausible:
            return z, "fallback-cameras"
    return None, None


def _floor_ceiling(points, normals, cameras, mm_per_unit, span):
    # Strict peaks first. A phone that barely sees the ceiling has too few
    # downward normals for that pass, so a looser one still counts as a peak.
    floors = _surface_candidates(points, normals, +1, mm_per_unit, span, 0.82, 25)
    ceilings = _surface_candidates(points, normals, -1, mm_per_unit, span, 0.82, 25)
    floors_loose = _surface_candidates(points, normals, +1, mm_per_unit, span, 0.55, 8)
    ceilings_loose = _surface_candidates(points, normals, -1, mm_per_unit, span, 0.55, 8)
    floor, floor_method = _prefer_plane(floors, want_low=True)
    ceiling, ceiling_method = _prefer_plane(ceilings, want_low=False)
    if floor is None:
        floor, floor_method = _prefer_plane(floors_loose, want_low=True)
    if ceiling is None:
        ceiling, ceiling_method = _prefer_plane(ceilings_loose, want_low=False)
    # A small downward patch under a piece of furniture is not a ceiling.
    # Drop it and try the cloud height, then the cameras.
    if floor is not None and ceiling is not None and not _height_ok(floor, ceiling, mm_per_unit, span):
        if floor_method != "plane":
            floor, floor_method = None, None
        if ceiling_method != "plane":
            ceiling, ceiling_method = None, None
    if floor is not None and ceiling is None:
        ceiling, ceiling_method = _fallback_level(points, cameras, floor, True, mm_per_unit, span)
    elif ceiling is not None and floor is None:
        floor, floor_method = _fallback_level(points, cameras, ceiling, False, mm_per_unit, span)
    if floor is None or ceiling is None or not _height_ok(floor, ceiling, mm_per_unit, span):
        raise RuntimeError("Non trovo un pavimento e un soffitto abbastanza estesi.")
    return float(floor), float(ceiling), floor_method, ceiling_method, floors or floors_loose, ceilings or ceilings_loose


def _shell_edge(xy, axis, want_min, orth_span, cell, cover=0.34):
    """Outer edge whose strip covers a real fraction of the wall, not a door leak."""
    if len(xy) < 25 or orth_span <= cell:
        return None
    coord = xy[:, axis]
    other = xy[:, 1 - axis]
    lo = float(np.percentile(coord, 0.4))
    hi = float(np.percentile(coord, 99.6))
    if hi - lo < cell:
        return float(lo if want_min else hi)
    edges = np.arange(lo - cell, hi + 2 * cell, cell)
    which = np.clip(np.digitize(coord, edges) - 1, 0, len(edges) - 2)
    order = range(len(edges) - 1) if want_min else range(len(edges) - 2, -1, -1)
    orth_bins = max(6, int(round(orth_span / cell)))
    for i in order:
        sel = which == i
        if int(sel.sum()) < 12:
            continue
        covered = np.percentile(other[sel], 95) - np.percentile(other[sel], 5)
        # A door leak is a narrow tongue. Require the strip to span the room.
        occupied = len(np.unique(np.clip(np.digitize(other[sel], np.linspace(other.min(), other.max() + cell, orth_bins + 1)) - 1, 0, orth_bins - 1)))
        wide = covered >= cover * orth_span
        tongue = occupied >= max(3, int(0.45 * orth_bins)) and covered >= 0.22 * orth_span
        if wide or tongue:
            return float(edges[i] if want_min else edges[i + 1])
    return float(lo if want_min else hi)


def _merge_edge(a, b, want_min, tol):
    if a is None:
        return b
    if b is None:
        return a
    outer = min(a, b) if want_min else max(a, b)
    inner = max(a, b) if want_min else min(a, b)
    # Small disagreement: one surface is hidden by furniture, trust the outer one.
    # Large disagreement: a leak survived, trust the inner one.
    if abs(a - b) <= tol:
        return outer
    return inner


def _footprint(points, normals, floor, ceiling, mm_per_unit, span):
    band = _mu(80, mm_per_unit, span)
    floor_pts = points[np.abs(points[:, 2] - floor) < band, :2]
    ceil_pts = points[np.abs(points[:, 2] - ceiling) < band, :2]
    both = np.vstack([floor_pts, ceil_pts]) if len(floor_pts) and len(ceil_pts) else (floor_pts if len(floor_pts) else ceil_pts)
    if len(both) < 30:
        both = points[:, :2]
    span_x = float(np.percentile(both[:, 0], 98) - np.percentile(both[:, 0], 2))
    span_y = float(np.percentile(both[:, 1], 98) - np.percentile(both[:, 1], 2))
    cell = _mu(80, mm_per_unit, span)
    tol = _mu(450, mm_per_unit, span)
    edges = {}
    for key, axis, want_min, orth in (
        ("xmin", 0, True, span_y),
        ("xmax", 0, False, span_y),
        ("ymin", 1, True, span_x),
        ("ymax", 1, False, span_x),
    ):
        a = _shell_edge(floor_pts, axis, want_min, orth, cell) if len(floor_pts) else None
        b = _shell_edge(ceil_pts, axis, want_min, orth, cell) if len(ceil_pts) else None
        edges[key] = float(_merge_edge(a, b, want_min, tol))
    if edges["xmax"] - edges["xmin"] <= _mu(600, mm_per_unit, span) or edges["ymax"] - edges["ymin"] <= _mu(600, mm_per_unit, span):
        raise RuntimeError("L'impronta di pavimento e soffitto non descrive una stanza.")
    return edges


def _coverage(values, lo, hi, bins):
    if hi <= lo or len(values) == 0:
        return 0.0
    hist, _ = np.histogram(values, bins=np.linspace(lo, hi, bins + 1))
    return float(np.mean(hist > 0))


def _snap_wall(points, normals, axis, want_min, edge, floor, ceiling, along0, along1, mm_per_unit, span):
    """Snap to a vertical plane on the shell. Inset furniture is not eligible."""
    inward = 1.0 if want_min else -1.0
    outside = _mu(70, mm_per_unit, span)
    inside = _mu(220, mm_per_unit, span)
    coord = points[:, axis]
    if want_min:
        band = (coord >= edge - outside) & (coord <= edge + inside)
    else:
        band = (coord <= edge + outside) & (coord >= edge - inside)
    along_axis = 1 - axis
    mask = (
        band
        & (normals[:, axis] * inward > 0.7)
        & (points[:, 2] > floor + _mu(40, mm_per_unit, span))
        & (points[:, 2] < ceiling - _mu(40, mm_per_unit, span))
        & (points[:, along_axis] > along0)
        & (points[:, along_axis] < along1)
    )
    rejected = []
    if int(mask.sum()) < 40:
        return float(edge), {"method": "impronta pavimento/soffitto", "support": int(mask.sum()), "rejected": rejected}

    bin_w = _mu(35, mm_per_unit, span)
    peaks = _peaks(coord[mask], bin_w, 20)
    qualified = []
    height = ceiling - floor
    length = max(along1 - along0, 1e-6)
    for peak in peaks:
        sel = mask & (np.abs(coord - peak["pos"]) < _mu(50, mm_per_unit, span))
        if int(sel.sum()) < 30:
            continue
        vc = _coverage(points[sel, 2], floor, ceiling, 8)
        hc = _coverage(points[sel, along_axis], along0, along1, 8)
        inset = (peak["pos"] - edge) if want_min else (edge - peak["pos"])
        inset_mm = inset * mm_per_unit if mm_per_unit else inset / max(span, 1e-6) * 4000.0
        info = {
            "pos": round(float(peak["pos"]), 4),
            "support": int(sel.sum()),
            "verticalCoverage": round(vc, 3),
            "horizontalCoverage": round(hc, 3),
            "insetMm": round(float(inset_mm), 1),
        }
        # A painting is short. A wardrobe inset more than ~22 cm is outside the band.
        if vc < 0.34 or hc < 0.2:
            info["reason"] = "estensione insufficiente (mobile o quadro)"
            rejected.append(info)
            continue
        score = (vc ** 2) * (max(hc, 0.05) ** 1.2) * np.log1p(sel.sum()) * np.exp(-max(0.0, inset_mm) / 160.0)
        info["score"] = round(float(score), 3)
        qualified.append(info)
    if not qualified:
        return float(edge), {"method": "impronta pavimento/soffitto", "support": int(mask.sum()), "rejected": rejected}
    best = max(q["score"] for q in qualified)
    # Outermost plane that is still a real wall, not the single biggest plane.
    outer = [q for q in qualified if q["score"] >= 0.4 * best]
    chosen = min(outer, key=lambda q: q["insetMm"])
    for q in qualified:
        if q is not chosen and q not in outer:
            q["reason"] = "piano più interno"
            rejected.append(q)
    sel = mask & (np.abs(coord - chosen["pos"]) < _mu(50, mm_per_unit, span))
    position = float(np.median(coord[sel])) if int(sel.sum()) else float(chosen["pos"])
    return position, {"method": "piano verticale sul bordo", "chosen": chosen, "support": int(sel.sum()), "rejected": rejected, "height": round(float(height), 3), "length": round(float(length), 3)}


def _detect_openings(points, cameras, x0, x1, y0, y1, floor, ceiling, mm_per_unit, span):
    """Doors only, and only where points are visible beyond the wall (not a wardrobe)."""
    if cameras is None or len(cameras) == 0:
        return []
    margin = _mu(180, mm_per_unit, span)
    zok = (points[:, 2] > floor + _mu(80, mm_per_unit, span)) & (points[:, 2] < ceiling - _mu(80, mm_per_unit, span))
    outside = zok & ((points[:, 0] < x0 - margin) | (points[:, 0] > x1 + margin) | (points[:, 1] < y0 - margin) | (points[:, 1] > y1 + margin))
    if int(outside.sum()) < 60:
        return []
    walls = {
        "S_ymin": (1, y0, 0, x0, x1),
        "N_ymax": (1, y1, 0, x0, x1),
        "W_xmin": (0, x0, 1, y0, y1),
        "E_xmax": (0, x1, 1, y0, y1),
    }
    eye = np.asarray(cameras, float).mean(0)
    hits = {name: [] for name in walls}
    # Subsample so a dense leak cannot dominate the runtime.
    idx = np.flatnonzero(outside)
    if len(idx) > 8000:
        rng = np.random.default_rng(0)
        idx = rng.choice(idx, 8000, replace=False)
    for p in points[idx]:
        direction = p - eye
        best = None
        for name, (axis, value, along, lo, hi) in walls.items():
            if abs(direction[axis]) < 1e-8:
                continue
            t = (value - eye[axis]) / direction[axis]
            if not (0 < t < 1):
                continue
            hit = eye + t * direction
            if lo <= hit[along] <= hi and floor <= hit[2] <= ceiling and (best is None or t < best[0]):
                best = (t, name, hit[along], hit[2])
        if best:
            hits[best[1]].append((best[2], best[3]))
    cell = _mu(80, mm_per_unit, span)
    openings = []
    height = ceiling - floor
    for name, pts in hits.items():
        if len(pts) < 40:
            continue
        axis, value, along, lo, hi = walls[name]
        arr = np.asarray(pts, float)
        gu = np.arange(lo, hi + cell, cell)
        gz = np.arange(floor, ceiling + cell, cell)
        if len(gu) < 3 or len(gz) < 3:
            continue
        hist, _, _ = np.histogram2d(arr[:, 0], arr[:, 1], [gu, gz])
        occ = ndimage.binary_closing(hist >= 2, iterations=1)
        labels, count = ndimage.label(occ)
        for i in range(1, count + 1):
            cells = np.argwhere(labels == i)
            if len(cells) < 12:
                continue
            u0 = float(gu[cells[:, 0].min()])
            u1 = float(gu[cells[:, 0].max() + 1])
            z0 = float(gz[cells[:, 1].min()])
            z1 = float(gz[cells[:, 1].max() + 1])
            width = u1 - u0
            hh = z1 - z0
            width_mm = width * mm_per_unit if mm_per_unit else width / max(span, 1e-6) * 4000
            height_mm = hh * mm_per_unit if mm_per_unit else hh / max(height, 1e-6) * 2700
            reaches_floor = (z0 - floor) < _mu(180, mm_per_unit, span)
            if not reaches_floor or not (550 <= width_mm <= 1400) or height_mm < 1600 or hh > 0.92 * height:
                continue
            if width > 0.55 * (hi - lo):
                continue
            openings.append(
                {
                    "wall": name,
                    "kind_guess": "door",
                    "u0": u0,
                    "u1": u1,
                    "z0": floor,
                    "z1": z1,
                    "n_points": int(len(cells)),
                }
            )
    # One door per wall: the tallest.
    kept = []
    for name in walls:
        group = [o for o in openings if o["wall"] == name]
        if group:
            kept.append(max(group, key=lambda o: o["z1"] - o["z0"]))
    return kept


def detect_room(points, normals, cameras=None, mm_per_unit=None, overrides=None, up_prior=None, colors=None):
    overrides = dict(overrides or {})
    frame = align_frame(points, normals, cameras if cameras is not None else np.zeros((0, 3)), up_prior=up_prior)
    Q = frame["points"]
    NQ = frame["normals"]
    span = float(np.linalg.norm(np.percentile(Q, 95, axis=0) - np.percentile(Q, 5, axis=0)))
    floor, ceiling, floor_method, ceiling_method, floor_cands, ceil_cands = _floor_ceiling(
        Q, NQ, frame["cameras"], mm_per_unit, span
    )
    if "floor" in overrides:
        floor = float(overrides["floor"])
        floor_method = "override"
    if "ceiling" in overrides:
        ceiling = float(overrides["ceiling"])
        ceiling_method = "override"
    footprint = _footprint(Q, NQ, floor, ceiling, mm_per_unit, span)
    notes = {}
    for key, axis, want_min in (("xmin", 0, True), ("xmax", 0, False), ("ymin", 1, True), ("ymax", 1, False)):
        if key in overrides:
            footprint[key] = float(overrides[key])
            notes[key] = {"method": "override", "pos": footprint[key]}
            continue
        along = 1 - axis
        if axis == 0:
            a0, a1 = footprint["ymin"], footprint["ymax"]
        else:
            a0, a1 = footprint["xmin"], footprint["xmax"]
        pos, info = _snap_wall(Q, NQ, axis, want_min, footprint[key], floor, ceiling, a0, a1, mm_per_unit, span)
        footprint[key] = pos
        notes[key] = info
    x0, x1 = footprint["xmin"], footprint["xmax"]
    y0, y1 = footprint["ymin"], footprint["ymax"]
    if x1 <= x0 or y1 <= y0 or ceiling <= floor:
        raise RuntimeError("Le pareti rilevate non formano un volume.")
    openings = _detect_openings(Q, frame["cameras"], x0, x1, y0, y1, floor, ceiling, mm_per_unit, span)
    shift = np.array([-x0, -y0, -floor])
    transform = np.eye(4)
    transform[:3, :3] = frame["rotation"]
    transform[:3, 3] = -frame["rotation"] @ frame["centre"] + shift
    length, width, height = x1 - x0, y1 - y0, ceiling - floor
    shifted = []
    for opening in openings:
        along_is_x = opening["wall"] in ("S_ymin", "N_ymax")
        off = -x0 if along_is_x else -y0
        u0 = opening["u0"] + off
        u1 = opening["u1"] + off
        z0 = opening["z0"] - floor
        z1 = opening["z1"] - floor
        shifted.append(
            {
                "wall": opening["wall"],
                "kind_guess": opening["kind_guess"],
                "u0": round(float(u0), 4),
                "u1": round(float(u1), 4),
                "z0": round(float(z0), 4),
                "z1": round(float(z1), 4),
                "width": round(float(u1 - u0), 4),
                "height": round(float(z1 - z0), 4),
            }
        )
    up_angle = float(np.degrees(np.arccos(np.clip(abs(frame["up"] @ frame["up_prior"]), -1, 1))))
    return {
        "units": "model",
        "mode": "stanza",
        "mm_per_unit": mm_per_unit,
        "transform_colmap_to_room": transform.tolist(),
        "convention": "Z up, floor Z=0, interior [0,Lx]x[0,Ly]x[0,H]; S=y0 N=y=Ly W=x0 E=x=Lx",
        "floor_polygon": [[0, 0], [length, 0], [length, width], [0, width]],
        "dims": {"length_x": round(float(length), 4), "width_y": round(float(width), 4), "height_z": round(float(height), 4)},
        "walls": {
            "S_ymin": {"length": round(float(length), 4), "plane": "y=0"},
            "N_ymax": {"length": round(float(length), 4), "plane": f"y={width:.4f}"},
            "W_xmin": {"length": round(float(width), 4), "plane": "x=0"},
            "E_xmax": {"length": round(float(width), 4), "plane": f"x={length:.4f}"},
        },
        "openings": shifted,
        "rejected_openings": [],
        "detection": {
            "up": [round(float(v), 5) for v in frame["up"]],
            "up_prior": [round(float(v), 5) for v in frame["up_prior"]],
            "up_vs_prior_deg": round(up_angle, 2),
            "yaw_deg": round(float(np.degrees(frame["yaw"])), 3),
            "manhattan_strength": round(float(frame["manhattan_strength"]), 3),
            "raw_planes": {"floor": floor, "ceiling": ceiling, **{k: footprint[k] for k in ("xmin", "xmax", "ymin", "ymax")}},
            "overrides": overrides,
            "walls": notes,
            "floorMethod": floor_method,
            "ceilingMethod": ceiling_method,
            "floor_candidates": floor_cands,
            "ceiling_candidates": ceil_cands,
            "n_points_used": int(len(Q)),
        },
    }


def to_millimetres(room: dict, mm_per_unit: float) -> dict:
    s = float(mm_per_unit)
    dims = room["dims"]
    length = dims["length_x"] * s
    width = dims["width_y"] * s
    height = dims["height_z"] * s

    def opening_mm(item):
        out = dict(item)
        for key in ("u0", "u1", "z0", "z1", "width", "height"):
            if key in out:
                out[key] = round(float(out[key]) * s, 1)
        return out

    walls = {}
    for name, wall in room["walls"].items():
        walls[name] = {"length": round(float(wall["length"]) * s, 1), "plane": wall["plane"]}
    return {
        "units": "mm",
        "mode": room.get("mode", "stanza"),
        "mm_per_unit": s,
        "convention": "Z su, pavimento Z=0, interno [0,Lx] x [0,Ly] x [0,H] in millimetri. S=y0, N=y=Ly, W=x0, E=x=Lx.",
        "dims": {
            "length_x": round(length, 1),
            "width_y": round(width, 1),
            "height_z": round(height, 1),
            "floor_area_m2": round(length * width / 1e6, 3),
        },
        "floor_polygon": [[round(x * s, 1), round(y * s, 1)] for x, y in room["floor_polygon"]],
        "walls": walls,
        "openings": [opening_mm(o) for o in room.get("openings") or []],
        "detection": room.get("detection"),
        "transform_colmap_to_room_mm": (np.diag([s, s, s, 1.0]) @ np.asarray(room["transform_colmap_to_room"], float)).tolist(),
    }


def apply_openings_mm(room: dict, openings_mm: list, mm_per_unit: float) -> dict:
    """Replace detected openings. Coordinates are millimetres in the room frame."""
    s = float(mm_per_unit)
    replaced = []
    for item in openings_mm:
        wall = item["wall"]
        if wall not in ("S_ymin", "N_ymax", "W_xmin", "E_xmax"):
            raise ValueError(f"Parete apertura sconosciuta: {wall}")
        u0, u1 = float(item["u0"]) / s, float(item["u1"]) / s
        z0, z1 = float(item["z0"]) / s, float(item["z1"]) / s
        kind = str(item.get("kind") or item.get("kind_guess") or "door")
        replaced.append(
            {
                "wall": wall,
                "kind_guess": kind,
                "u0": u0,
                "u1": u1,
                "z0": z0,
                "z1": z1,
                "width": u1 - u0,
                "height": z1 - z0,
            }
        )
    room = dict(room)
    room["openings"] = replaced
    return room
