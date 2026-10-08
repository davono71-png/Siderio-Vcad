"""Simplified walls as a STEP solid. Interior faces are the measured planes; thickness grows outward."""

from __future__ import annotations


def export_step(room: dict, out_step: str, mm_per_unit: float, thickness_mm: float, floor_slab_mm: float, ceiling_slab_mm: float, cut: str):
    import cadquery as cq

    scale = float(mm_per_unit)
    length = room["dims"]["length_x"] * scale
    width = room["dims"]["width_y"] * scale
    height = room["dims"]["height_z"] * scale
    thickness = float(thickness_mm)
    outer = cq.Workplane("XY").box(length + 2 * thickness, width + 2 * thickness, height, centered=(False, False, False)).translate((-thickness, -thickness, 0))
    inner = cq.Workplane("XY").box(length, width, height, centered=(False, False, False))
    walls = outer.cut(inner)
    cut_list = []
    if cut != "none":
        for opening in room.get("openings") or []:
            kind = str(opening.get("kind_guess") or "")
            if cut == "doors" and not kind.startswith("door"):
                continue
            u0, u1, z0, z1 = (float(opening[key]) * scale for key in ("u0", "u1", "z0", "z1"))
            z0 = max(z0, 0.0)
            z1 = min(z1, height)
            if u1 - u0 < 50 or z1 - z0 < 50:
                continue
            if opening["wall"] in ("S_ymin", "N_ymax"):
                y = -thickness - 1 if opening["wall"] == "S_ymin" else width - 1
                cutter = cq.Workplane("XY").box(u1 - u0, thickness + 2, z1 - z0, centered=(False, False, False)).translate((u0, y, z0))
            else:
                x = -thickness - 1 if opening["wall"] == "W_xmin" else length - 1
                cutter = cq.Workplane("XY").box(thickness + 2, u1 - u0, z1 - z0, centered=(False, False, False)).translate((x, u0, z0))
            walls = walls.cut(cutter)
            cut_list.append((opening["wall"], kind.split()[0], round(u1 - u0, 1), round(z1 - z0, 1)))
    if floor_slab_mm > 0:
        slab = cq.Workplane("XY").box(length + 2 * thickness, width + 2 * thickness, floor_slab_mm, centered=(False, False, False))
        walls = walls.union(slab.translate((-thickness, -thickness, -floor_slab_mm)))
    if ceiling_slab_mm > 0:
        slab = cq.Workplane("XY").box(length + 2 * thickness, width + 2 * thickness, ceiling_slab_mm, centered=(False, False, False))
        walls = walls.union(slab.translate((-thickness, -thickness, height)))
    cq.exporters.export(walls, out_step)
    return {
        "units": "mm",
        "lengthMm": round(length, 1),
        "widthMm": round(width, 1),
        "heightMm": round(height, 1),
        "thicknessMm": thickness,
        "openings": cut_list,
        "step": out_step,
    }


def export_facade_step(scene_mm: dict, out_step: str):
    """Slabs for a facade. Each plane is already in millimetres.

    The visible face is the detected plane. Thickness grows behind that face
    (away from the camera for the background wall, below a desk top, toward
    the wall for a face parallel to it). Separate solids stay a compound:
    nothing is fused into a room.
    """
    import cadquery as cq

    shapes = []
    exported = []
    for plane in scene_mm.get("planes") or []:
        width = float(plane["widthMm"])
        height = float(plane["heightMm"])
        thickness = float(plane["thicknessMm"])
        if width < 1 or height < 1 or thickness <= 0:
            continue
        origin = _vec(plane["originMm"])
        axis_u = _vec(plane["axisU"])
        normal = _vec(plane["normal"])
        back = tuple(origin[i] - normal[i] * thickness for i in range(3))
        workplane = cq.Workplane(cq.Plane(back, tuple(axis_u), tuple(normal)))
        solid = workplane.box(width, height, thickness, centered=(False, False, False)).val()
        if plane.get("role") == "background":
            for opening in scene_mm.get("openings") or []:
                x0, x1 = float(opening["x0"]), float(opening["x1"])
                y0, y1 = float(opening["y0"]), float(opening["y1"])
                if x1 - x0 < 50 or y1 - y0 < 50:
                    continue
                cutter = (
                    cq.Workplane("XY")
                    .box(x1 - x0, y1 - y0, thickness + 40, centered=(False, False, False))
                    .translate((x0, y0, -thickness - 10))
                    .val()
                )
                solid = solid.cut(cutter)
        shapes.append(solid)
        exported.append(
            {
                "role": plane.get("role"),
                "type": plane.get("type"),
                "widthMm": round(width, 1),
                "heightMm": round(height, 1),
                "thicknessMm": round(thickness, 1),
            }
        )
    if not shapes:
        raise RuntimeError("Nessun piano da scrivere nello STEP della facciata.")
    compound = cq.Compound.makeCompound(shapes)
    cq.exporters.export(compound, out_step)
    return {"units": "mm", "solids": exported, "step": out_step}


def _vec(values):
    return tuple(float(v) for v in values)
