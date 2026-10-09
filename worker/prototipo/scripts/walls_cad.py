#!/usr/bin/env python3
"""Parametric simplified walls (CadQuery) from room.json -> STEP (+STL for previews).

Walls are solids built OUTSIDE the interior box [0,Lx]x[0,Ly]x[0,H] (interior faces = measured planes),
corners are filled (outer box minus inner box), openings from room.json are cut through.

Units: if --mm-per-unit (or room.json mm_per_unit) is given, everything is output in millimetres and the
wall thickness default is 150 mm. Without a scale the model stays in model units and the default
thickness is 0.055*H (~150 mm for a typical 2.70 m ceiling) - a placeholder.

Usage: walls_cad.py ROOM_JSON OUT_STEP [--thickness T] [--mm-per-unit S] [--no-openings] [--min-confidence all|high]
"""
import argparse, json, cadquery as cq

ap = argparse.ArgumentParser(); ap.add_argument('room'); ap.add_argument('out')
ap.add_argument('--thickness', type=float, default=None, help='wall thickness in output units (mm if scaled)')
ap.add_argument('--mm-per-unit', type=float, default=None)
ap.add_argument('--no-openings', action='store_true')
ap.add_argument('--openings', default='all', choices=['all', 'doors'], help="'doors' skips low-confidence windows")
ap.add_argument('--floor-slab', type=float, default=0.0, help='optional floor slab thickness (0 = none)')
ap.add_argument('--ceiling-slab', type=float, default=0.0, help='optional ceiling slab thickness (0 = none)')
a = ap.parse_args()
room = json.load(open(a.room))
s = a.mm_per_unit or room.get('mm_per_unit') or 1.0
scaled = (a.mm_per_unit or room.get('mm_per_unit')) is not None
L, W, H = (room['dims'][k] * s for k in ('length_x', 'width_y', 'height_z'))
t = a.thickness if a.thickness is not None else (150.0 if scaled else 0.055 * H)

outer = cq.Workplane('XY').box(L + 2 * t, W + 2 * t, H, centered=(False, False, False)).translate((-t, -t, 0))
inner = cq.Workplane('XY').box(L, W, H, centered=(False, False, False))
walls = outer.cut(inner)
cut_list = []
if not a.no_openings:
    for o in room.get('openings', []):
        if a.openings == 'doors' and not o['kind_guess'].startswith('door'): continue
        u0, u1, z0, z1 = (o[k] * s for k in ('u0', 'u1', 'z0', 'z1'))
        z0 = max(z0, 0.0); z1 = min(z1, H)
        # through-cutter, a bit thicker than the wall
        if o['wall'] in ('S_ymin', 'N_ymax'):
            y = -t - 1 if o['wall'] == 'S_ymin' else W - 1
            c = cq.Workplane('XY').box(u1 - u0, t + 2, z1 - z0, centered=(False, False, False)).translate((u0, y, z0))
        else:
            x = -t - 1 if o['wall'] == 'W_xmin' else L - 1
            c = cq.Workplane('XY').box(t + 2, u1 - u0, z1 - z0, centered=(False, False, False)).translate((x, u0, z0))
        walls = walls.cut(c); cut_list.append((o['wall'], o['kind_guess'].split()[0], round(u1 - u0, 3), round(z1 - z0, 3)))
if a.floor_slab > 0:
    walls = walls.union(cq.Workplane('XY').box(L + 2 * t, W + 2 * t, a.floor_slab, centered=(False, False, False)).translate((-t, -t, -a.floor_slab)))
if a.ceiling_slab > 0:
    walls = walls.union(cq.Workplane('XY').box(L + 2 * t, W + 2 * t, a.ceiling_slab, centered=(False, False, False)).translate((-t, -t, H)))
cq.exporters.export(walls, a.out)
stl = a.out.rsplit('.', 1)[0] + '.stl'
cq.exporters.export(walls, stl, tolerance=0.01 * max(L, W), angularTolerance=0.2)
print(dict(units='mm' if scaled else 'model units', L=round(L, 3), W=round(W, 3), H=round(H, 3), thickness=round(t, 3), openings=cut_list, step=a.out, stl=stl))
