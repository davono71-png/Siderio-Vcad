"""Tiny numpy z-buffer point splatter for previews (no OpenGL needed)."""
import numpy as np
def look_at(eye, target, up=(0, 0, 1)):
    eye = np.asarray(eye, float); f = np.asarray(target, float) - eye; f /= np.linalg.norm(f)
    r = np.cross(f, up); r /= np.linalg.norm(r); u = np.cross(r, f)
    R = np.stack([r, -u, f])  # camera x right, y down, z forward
    return R, -R @ eye
def render(P, C, R, t, W=900, H=700, f=450, radius=1, bg=255, ortho_scale=None):
    X = P @ R.T + t
    if ortho_scale is None:
        m = X[:, 2] > 0.05; X = X[m]; Cc = C[m]
        u = f * X[:, 0] / X[:, 2] + W / 2; v = f * X[:, 1] / X[:, 2] + H / 2
    else:
        Cc = C; u = X[:, 0] * ortho_scale + W / 2; v = X[:, 1] * ortho_scale + H / 2
    z = X[:, 2]
    img = np.full((H, W, 3), bg, np.uint8); zb = np.full((H, W), np.inf)
    order = np.argsort(-z)  # far to near, later writes win
    u = u[order]; v = v[order]; z = z[order]; Cc = Cc[order]
    for dx in range(-radius, radius + 1):
        for dy in range(-radius, radius + 1):
            ui = np.round(u).astype(int) + dx; vi = np.round(v).astype(int) + dy
            ok = (ui >= 0) & (ui < W) & (vi >= 0) & (vi < H)
            ui, vi, zz, cc = ui[ok], vi[ok], z[ok], Cc[ok]
            closer = zz < zb[vi, ui]
            # since sorted far->near, simple assignment keeps nearest
            img[vi[closer], ui[closer]] = cc[closer]; zb[vi[closer], ui[closer]] = zz[closer]
    return img
