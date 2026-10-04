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
