#!/usr/bin/env python3
"""Dump a COLMAP model to npz (points, colors, camera centres, rotations, names) + gravity 'UP' (COLMAP frame) from
the app's phone-orientation data (R_colmap_to_enu.npy fitted by pose_check.py), used by room_planes.py as up prior."""
import sys, os, numpy as np, pycolmap as p
r = p.Reconstruction(sys.argv[1])
P = np.array([pt.xyz for pt in r.points3D.values()]); Cc = np.array([pt.color for pt in r.points3D.values()])
E = np.array([pt.error for pt in r.points3D.values()]); T = np.array([pt.track.length() for pt in r.points3D.values()])
names = [i.name for i in r.images.values()]; C = np.array([i.projection_center() for i in r.images.values()])
R = np.array([i.cam_from_world().rotation.matrix() for i in r.images.values()])
extra = {}
if len(sys.argv) > 3 and os.path.exists(sys.argv[3]): extra['UP'] = np.load(sys.argv[3]).T @ np.array([0, 0, 1.0])
np.savez(sys.argv[2], P=P, colors=Cc, err=E, track=T, names=names, C=C, R=R, **extra)
print(sys.argv[1], 'reg', r.num_reg_images(), 'pts', len(P), 'reproj %.3f' % r.compute_mean_reprojection_error(), 'UP' in extra)
