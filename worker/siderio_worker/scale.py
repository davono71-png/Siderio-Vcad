"""Triangulate named points and fit one scale (millimetres per model unit).

Observations follow the capture app: ``rawX``/``rawY`` are pixels of the stored
JPEG (no EXIF rotation). COLMAP sees that same raster divided by the integer
downscale factor. ``x``/``y`` are the upright frame and are not used for SfM.
"""

from __future__ import annotations

import numpy as np


class Ray:
    def __init__(self, name, centre, direction, project, uv):
        self.name = name
        self.centre = np.asarray(centre, float)
        self.direction = np.asarray(direction, float)
        self.project = project
        self.uv = np.asarray(uv, float)


def triangulate(rays: list[Ray]):
    if len(rays) < 2:
        raise ValueError("Servono almeno due raggi.")
    accum = np.zeros((3, 3))
    rhs = np.zeros(3)
    for ray in rays:
        direction = np.asarray(ray.direction, float)
        direction = direction / max(float(np.linalg.norm(direction)), 1e-12)
        proj = np.eye(3) - np.outer(direction, direction)
        accum += proj
        rhs += proj @ np.asarray(ray.centre, float)
    try:
        seed = np.linalg.solve(accum, rhs)
    except np.linalg.LinAlgError:
        seed = np.linalg.lstsq(accum, rhs, rcond=1e-8)[0]
    if not np.all(np.isfinite(seed)):
        raise ValueError("Raggi paralleli.")

    def residual(xyz):
        rows = []
        for ray in rays:
            px = ray.project(xyz)
            if px is None:
                rows.append(np.array([1e3, 1e3]))
            else:
                rows.append(np.asarray(px, float) - ray.uv)
        return np.concatenate(rows)

    solved = np.asarray(seed, float)
    try:
        from scipy.optimize import least_squares

        refined = least_squares(residual, seed, method="lm").x
        seed_cost = float(np.dot(residual(seed), residual(seed)))
        refined_cost = float(np.dot(residual(refined), residual(refined)))
        if np.all(np.isfinite(refined)) and refined_cost <= seed_cost * 1.05 + 1.0:
            solved = np.asarray(refined, float)
    except Exception:
        solved = np.asarray(seed, float)
    gaps = []
    for ray in rays:
        delta = solved - ray.centre
        gaps.append(float(np.linalg.norm(delta - np.dot(delta, ray.direction) * ray.direction)))
    angle = 0.0
    if len(rays) > 1:
        angle = max(
            float(np.degrees(np.arccos(np.clip(abs(np.dot(a.direction, b.direction)), -1, 1))))
            for i, a in enumerate(rays)
            for b in rays[i + 1 :]
        )
    reproj = []
    for ray in rays:
        px = ray.project(solved)
        reproj.append(None if px is None else float(np.linalg.norm(np.asarray(px) - ray.uv)))
    return solved, {"triAngleDeg": round(angle, 2), "rayGap": [round(g, 5) for g in gaps], "reprojPx": [None if v is None else round(v, 2) for v in reproj]}


def fit_scale(distance_mu, distance_mm):
    """Least squares s minimising sum (s * d - D)^2. Returns s, residuals, rms."""
    d = np.asarray(distance_mu, float)
    measured = np.asarray(distance_mm, float)
    if len(d) == 0 or float(d @ d) <= 0:
        raise ValueError("Nessuna quota utilizzabile per la scala.")
    scale = float(d @ measured / (d @ d))
    residual = scale * d - measured
    rms = float(np.sqrt(np.mean(residual ** 2)))
    return scale, residual, rms


def _label_of(point_id: str, points: list[dict]) -> str:
    for point in points:
        if point.get("id") == point_id:
            return point.get("label") or point_id
    return point_id


def measurement_ends(measurement: dict, points: list[dict]):
    """Prefer the human labels. Fall back to pointA/pointB ids."""
    label_a = measurement.get("labelA") or _label_of(measurement.get("pointA"), points)
    label_b = measurement.get("labelB") or _label_of(measurement.get("pointB"), points)
    return label_a, label_b


def _reproj_median(extra) -> float:
    values = [value for value in (extra or {}).get("reprojPx") or [] if value is not None]
    if not values:
        return 1e9
    return float(np.median(values))


def _triangulate_robust(rays):
    """Locate a point that has at least two registered views.

    The full set is used when the clicks agree. One bad view must not drop a
    point that the other registered views still triangulate.
    """
    if len(rays) < 2:
        return None

    def attempt(group):
        try:
            xyz, extra = triangulate(group)
        except (np.linalg.LinAlgError, ValueError):
            return None
        if not np.all(np.isfinite(xyz)):
            return None
        return xyz, extra, _reproj_median(extra)

    full = attempt(rays)
    best = full
    if len(rays) > 2 and (full is None or full[2] > 12.0):
        for index in range(len(rays)):
            trial = attempt([ray for position, ray in enumerate(rays) if position != index])
            if trial is None:
                continue
            if best is None or trial[2] + 0.5 < best[2]:
                best = trial
    if best is None or best[2] > 80.0:
        return None
    return best


def triangulate_project(project: dict, ray_fn):
    """ray_fn(photo_id, raw_x, raw_y) -> Ray | None.

    A registered view is one photo with a pose. Two clicks on the same photo
    are one view. A point is located from two or more registered views.
    """
    located = {}
    report = []
    for point in project.get("points") or []:
        label = point.get("label") or point.get("id")
        observations = point.get("observations") or []
        by_photo = {}
        order = []
        missing = []
        for obs in observations:
            raw_x = obs.get("rawX", obs.get("x"))
            raw_y = obs.get("rawY", obs.get("y"))
            try:
                ray = ray_fn(obs["photoId"], float(raw_x), float(raw_y))
            except (TypeError, ValueError, KeyError):
                ray = None
            if ray is None:
                missing.append(obs.get("photoId"))
                continue
            photo = obs["photoId"]
            if photo not in by_photo:
                order.append(photo)
            by_photo[photo] = ray
        rays = [by_photo[photo] for photo in order]
        info = {
            "label": label,
            "id": point.get("id"),
            "nObs": len(observations),
            "nRegistered": len(rays),
            "unregistered": missing,
        }
        found = _triangulate_robust(rays) if len(rays) >= 2 else None
        if found is not None:
            xyz, extra, median = found
            located[label] = xyz
            info.update(
                {
                    "method": "triangulated",
                    "xyz": xyz.tolist(),
                    "reprojMedianPx": round(float(median), 2),
                    **extra,
                }
            )
        elif len(rays) >= 2:
            info["method"] = "non usabile (triangolazione non riuscita)"
        else:
            info["method"] = f"non usabile ({len(rays)} viste registrate su {info['nObs']} osservazioni)"
        report.append(info)
    return located, report


def scale_report(project: dict, located: dict, ray_fn=None, monte_carlo: int = 0) -> dict:
    points = project.get("points") or []
    seen = set()
    measurements = []
    for item in project.get("measurements") or []:
        label_a, label_b = measurement_ends(item, points)
        distance = float(item["distanceMm"])
        key = (frozenset((label_a, label_b)), round(distance, 3))
        duplicate = key in seen
        seen.add(key)
        if label_a in located and label_b in located:
            model = float(np.linalg.norm(located[label_a] - located[label_b]))
        else:
            model = None
        measurements.append(
            {
                "pair": f"{label_a}-{label_b}",
                "labelA": label_a,
                "labelB": label_b,
                "pointA": item.get("pointA"),
                "pointB": item.get("pointB"),
                "mm": distance,
                "note": item.get("note") or "",
                "duplicate": duplicate,
                "dMu": model,
            }
        )
    # Every non-duplicate quote whose ends both triangulated. Each end needs
    # at least two registered views. Two tapes of the same pair with different
    # lengths both count; an exact repeat does not.
    used = [m for m in measurements if not m["duplicate"] and m["dMu"] and m["dMu"] > 1e-8 and m["mm"] > 0]
    if not used:
        raise RuntimeError("Nessuna quota collega due punti triangolati. Servono almeno due viste per punto e una distanza in millimetri.")
    scale, residual, rms = fit_scale([m["dMu"] for m in used], [m["mm"] for m in used])
    for measure in measurements:
        if measure["dMu"]:
            measure["modelMm"] = round(measure["dMu"] * scale, 1)
            measure["residMm"] = round(measure["dMu"] * scale - measure["mm"], 1)
            measure["residPct"] = round(100.0 * (measure["dMu"] * scale - measure["mm"]) / measure["mm"], 2)
    leave = []
    if len(used) >= 2:
        d = np.array([m["dMu"] for m in used])
        measured = np.array([m["mm"] for m in used], float)
        for i in range(len(used)):
            keep = [j for j in range(len(used)) if j != i]
            alt, _, _ = fit_scale(d[keep], measured[keep])
            leave.append(
                {
                    "leftOut": used[i]["pair"],
                    "scale": round(float(alt), 4),
                    "predictedMm": round(float(d[i] * alt), 1),
                    "errMm": round(float(d[i] * alt - measured[i]), 1),
                }
            )
    report = {
        "mm_per_unit": scale,
        "rms_resid_mm": rms,
        "max_abs_resid_mm": float(np.max(np.abs(residual))),
        "n_used": len(used),
        "measurements": measurements,
        "leave_one_out": leave,
        "points": [],
        "points_mm_colmap_frame": {k: (v * scale).tolist() for k, v in located.items()},
    }
    # point reports are attached by the caller when it has them; keep the key.
    if monte_carlo and ray_fn is not None and len(used) >= 1:
        report["monte_carlo_click_noise_2px_std_mm"] = _monte_carlo(project, ray_fn, used, scale, monte_carlo)
    report["warning"] = consistency_warning(report)
    return report


def consistency_warning(report: dict, threshold_pct: float = 5.0) -> str | None:
    """Flag leave-one-out disagreement the app can show next to the scale.

    A click on the wrong pixel moves one distance by much more than the
    residual of a single least-squares fit. Leaving each measurement out
    shows that: if the held-out tape and the scale from the others differ
    by more than ``threshold_pct``, the quotes are inconsistent.
    """
    measurements = {item["pair"]: item for item in report.get("measurements") or [] if not item.get("duplicate")}
    worst_pct = 0.0
    worst = None
    for item in report.get("leave_one_out") or []:
        pair = item.get("leftOut")
        err = item.get("errMm")
        if err is None or pair is None:
            continue
        measured = (measurements.get(pair) or {}).get("mm")
        if not measured:
            predicted = item.get("predictedMm")
            if predicted is None:
                continue
            measured = float(predicted) - float(err)
        if not measured:
            continue
        pct = abs(float(err)) / float(measured) * 100.0
        if pct > worst_pct:
            worst_pct = pct
            worst = (pair, float(err), pct)
    if worst is None or worst_pct <= float(threshold_pct):
        return None
    pair, err, pct = worst
    return f"Quote incoerenti: lasciando fuori {pair} l'errore è {err:+.0f} mm ({pct:.1f}%)."


def _monte_carlo(project, ray_fn, used, scale, draws):
    rng = np.random.default_rng(0)
    observations = {p.get("label") or p.get("id"): p.get("observations") or [] for p in project.get("points") or []}
    samples = {m["pair"]: [] for m in used}
    for _ in range(int(draws)):
        located = {}
        for label, obs_list in observations.items():
            rays = []
            for obs in obs_list:
                noisy_x = float(obs.get("rawX", obs.get("x"))) + float(rng.normal(0, 2.0))
                noisy_y = float(obs.get("rawY", obs.get("y"))) + float(rng.normal(0, 2.0))
                ray = ray_fn(obs["photoId"], noisy_x, noisy_y)
                if ray is not None:
                    rays.append(ray)
            if len(rays) >= 2:
                located[label] = triangulate(rays)[0]
        for measure in used:
            a, b = measure["labelA"], measure["labelB"]
            if a in located and b in located:
                samples[measure["pair"]].append(float(np.linalg.norm(located[a] - located[b]) * scale))
    return {key: round(float(np.std(values)), 1) if values else None for key, values in samples.items()}


def _unlocated_reason(measure: dict, points: list) -> str:
    """Say how many registered views each end has. Two stored clicks can still be one photo."""
    by_label = {point.get("label"): point for point in points}
    missing = []
    for label in (measure.get("labelA"), measure.get("labelB")):
        if not label:
            continue
        info = by_label.get(label)
        if info is None:
            missing.append(f"{label}: nessuna osservazione")
            continue
        registered = int(info.get("nRegistered") or 0)
        observed = int(info.get("nObs") or 0)
        if registered >= 2 and str(info.get("method", "")).startswith("triangulated"):
            continue
        missing.append(f"{label}: {registered} viste registrate su {observed} osservazioni")
    if not missing:
        return "punti non triangolati"
    return "; ".join(missing)


def render_markdown(report: dict) -> str:
    lines = [
        "# Scala",
        "",
        f"- Millimetri per unità del modello: **{report['mm_per_unit']:.4f}**",
        f"- RMS dei residui: **{report['rms_resid_mm']:.2f} mm**",
        f"- Residuo massimo: **{report['max_abs_resid_mm']:.2f} mm**",
        f"- Quote usate (i duplicati non contano): {report['n_used']}",
        "",
    ]
    if report.get("warning"):
        lines += [f"- **Attenzione:** {report['warning']}", ""]
    lines += [
        "| quota | misura mm | modello mm | residuo mm | residuo % |",
        "|---|---:|---:|---:|---:|",
    ]
    for measure in report["measurements"]:
        if measure.get("duplicate"):
            lines.append(f"| {measure['pair']} | {measure['mm']:.1f} | | | duplicato |")
            continue
        if measure.get("modelMm") is None:
            lines.append(f"| {measure['pair']} | {measure['mm']:.1f} | | | {_unlocated_reason(measure, report.get('points') or [])} |")
            continue
        lines.append(
            f"| {measure['pair']} | {measure['mm']:.1f} | {measure['modelMm']:.1f} | {measure['residMm']:+.1f} | {measure['residPct']:+.2f} |"
        )
    if report.get("leave_one_out"):
        lines += ["", "## Lasciane una fuori", ""]
        for item in report["leave_one_out"]:
            lines.append(f"- senza {item['leftOut']}: scala {item['scale']:.3f}, errore sulla quota esclusa {item['errMm']:+.1f} mm")
    if report.get("monte_carlo_click_noise_2px_std_mm"):
        lines += ["", "## Rumore di click (2 px, deviazione standard)", ""]
        for key, value in report["monte_carlo_click_noise_2px_std_mm"].items():
            lines.append(f"- {key}: {value} mm")
    lines.append("")
    return "\n".join(lines)


def rays_from_reconstruction(reconstruction, rows_by_photo: dict):
    """Build a ray function from a pycolmap reconstruction and images.csv rows."""

    by_name = {image.name: image for image in reconstruction.images.values()}

    def ray_fn(photo_id, raw_x, raw_y):
        row = rows_by_photo.get(photo_id)
        if row is None:
            return None
        image = by_name.get(row["name"])
        if image is None or not image.has_pose:
            return None
        factor = float(row["factor"])
        camera = reconstruction.cameras[image.camera_id]
        uv = np.array([float(raw_x) / factor, float(raw_y) / factor], float)
        normalised = np.asarray(camera.cam_from_img(uv)).ravel()[:2]
        pose = image.cam_from_world()
        rotation = np.asarray(pose.rotation.matrix(), float)
        translation = np.asarray(pose.translation, float).ravel()
        centre = -rotation.T @ translation
        direction = rotation.T @ np.array([normalised[0], normalised[1], 1.0])
        direction = direction / np.linalg.norm(direction)

        def project(xyz):
            local = rotation @ xyz + translation
            if local[2] <= 1e-8:
                return None
            return np.asarray(camera.img_from_cam(local)).ravel()[:2]

        return Ray(row["name"], centre, direction, project, uv)

    return ray_fn
