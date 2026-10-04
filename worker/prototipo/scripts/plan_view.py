#!/usr/bin/env python3
"""2D plan of the simplified walls with dimensions (model units + ratios), from room.json. Usage: plan_view.py ROOM_JSON OUT_PNG [thickness]"""
import sys, json, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Polygon
room = json.load(open(sys.argv[1])); L, W, H = (room['dims'][k] for k in ('length_x', 'width_y', 'height_z'))
s = room.get('mm_per_unit'); unit = 'mm' if s else 'u'
t = float(sys.argv[3]) if len(sys.argv) > 3 else 0.055 * H
fig, ax = plt.subplots(figsize=(10, 9))
ax.add_patch(Polygon([[-t, -t], [L + t, -t], [L + t, W + t], [-t, W + t]], closed=True, fc='#9aa4b1', ec='k'))
ax.add_patch(Polygon([[0, 0], [L, 0], [L, W], [0, W]], closed=True, fc='white', ec='k'))
for o in room['openings']:
    u0, u1 = o['u0'], o['u1']; col = '#e07b39' if o['kind_guess'].startswith('door') else '#4aa3df'
    if o['wall'] == 'S_ymin': ax.add_patch(Rectangle((u0, -t), u1 - u0, t, fc=col)); ax.text((u0+u1)/2, -2.2*t, f"{o['kind_guess'].split()[0]} w={o['width']:.2f} h={o['height']:.2f} sill={o['z0']:.2f}", ha='center', fontsize=8, color=col)
    if o['wall'] == 'N_ymax': ax.add_patch(Rectangle((u0, W), u1 - u0, t, fc=col)); ax.text((u0+u1)/2, W + 2.0*t, f"{o['kind_guess'].split()[0]} w={o['width']:.2f} h={o['height']:.2f}", ha='center', fontsize=8, color=col)
    if o['wall'] == 'W_xmin': ax.add_patch(Rectangle((-t, u0), t, u1 - u0, fc=col))
    if o['wall'] == 'E_xmax': ax.add_patch(Rectangle((L, u0), t, u1 - u0, fc=col))
ax.annotate('', (0, W * 0.5), (L, W * 0.5), arrowprops=dict(arrowstyle='<->')); ax.text(L / 2, W * 0.5 + 0.3, f'Lx = {L:.2f} {unit}', ha='center')
ax.annotate('', (L * 0.5, 0), (L * 0.5, W), arrowprops=dict(arrowstyle='<->')); ax.text(L * 0.5 + 0.3, W * 0.3, f'Wy = {W:.2f} {unit}', rotation=90, va='center')
ax.text(L * 0.05, W * 0.9, f'H (floor-ceiling) = {H:.2f} {unit}\nratios Lx:Wy:H = {L/H:.3f} : {W/H:.3f} : 1\nwall t = {t:.2f} {unit} (placeholder)', fontsize=9, va='top')
for lab, x, y in [('S wall (window)', L / 2, t * 0.6), ('N wall (door, painting)', L / 2, W - t * 1.2), ('W wall (wardrobe, bed head)', t * 0.4, W / 2), ('E wall (desk)', L - t * 0.4, W / 2)]:
    ax.text(x, y, lab, ha='center', va='center', fontsize=8, color='gray', rotation=90 if 'W wall' in lab or 'E wall' in lab else 0)
cams = room['detection'].get('cameras_room_frame', [])
if cams: ax.plot([c[0] for c in cams], [c[1] for c in cams], 'r^', ms=5, label='photo positions'); ax.legend(loc='lower right', fontsize=8)
ax.set_aspect('equal'); ax.set_xlim(-4 * t, L + 4 * t); ax.set_ylim(-4 * t, W + 4 * t); ax.grid(alpha=0.3)
ax.set_title(f'Simplified walls - plan view (Z up, floor Z=0), units: {unit}'); ax.set_xlabel('X'); ax.set_ylabel('Y')
plt.tight_layout(); plt.savefig(sys.argv[2], dpi=110); print('wrote', sys.argv[2])
