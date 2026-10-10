"""All planar surfaces, plus a mesh of whatever is left.

``pareti`` never calls this. ``completa`` keeps the snapped walls in
``walls.step`` and writes the extra files beside them.

The slabs are 20 mm thick and follow the inlier footprint (an alpha shape,
simplified), in the same millimetre frame as ``walls.step``. ``completo.glb``
is that scene with Y up, so the viewer and a facade STEP share one frame.
A room's STEP stays Z-up, like ``walls.step``; the GLB rotates it.
"""

from __future__ import annotations

import os

import numpy as np

SLAB_MM = 20.0
MIN_EXTENT_MM = 100.0
MIN_SUPPORT = 40
PLANE_DIST_MM = 25.0
NORMAL_COS = 0.84  # about 33°
VOXEL_MM = 20.0
ALPHA_MM = 90.0
SIMPLIFY_MM = 22.0
MAX_PLANES = 120
MAX_FAILS = 36
MESH_FACE_CAP = 120_000
STEP_MESH_FACE_CAP = 40_000
STEP_MESH_MAX_BYTES = 50 * 1024 * 1024

ROLES = ("parete", "pavimento", "soffitto", "orizzontale", "verticale", "inclinata")
ROLE_LABEL = {
    "parete": "Parete",
    "pavimento": "Pavimento",
    "soffitto": "Soffitto",
    "orizzontale": "Piano orizzontale",
    "verticale": "Superficie verticale",
    "inclinata": "Piano inclinato",
}


def scene_up(mode: str) -> np.ndarray:
    if mode == "facciata":
        return np.array([0.0, 1.0, 0.0])
    return np.array([0.0, 0.0, 1.0])


def to_scene_mm(points, normals, transform, mm_per_unit: float):
    """COLMAP points to the millimetre frame of walls.step."""
    matrix = np.asarray(transform, float)
    scale = float(mm_per_unit)
    rotation = matrix[:3, :3]
    xyz = (points @ rotation.T + matrix[:3, 3]) * scale
    dirs = normals @ rotation.T
    length = np.linalg.norm(dirs, axis=1, keepdims=True)
    dirs = dirs / np.maximum(length, 1e-12)
    return xyz, dirs


def segment_surfaces(points, normals, up) -> tuple[list[dict], np.ndarray]:
    """Iterative planes. Inclined ones are kept. Tiny patches stay residual."""
    found, residual, _cloud, _dirs = _segment_voxel(points, normals, up)
    return found, residual


def export_complete(points, normals, up, mode: str, out_dir: str) -> dict:
    """Write completo.step, completo.glb, oggetti.stl and oggetti.obj."""
    os.makedirs(out_dir, exist_ok=True)
    surfaces, residual_mask, voxel_points, voxel_normals = _segment_voxel(points, normals, up)
    step_path = os.path.join(out_dir, "completo.step")
    glb_path = os.path.join(out_dir, "completo.glb")
    stl_path = os.path.join(out_dir, "oggetti.stl")
    obj_path = os.path.join(out_dir, "oggetti.obj")
    written = _write_step(surfaces, step_path)
    mesh_info = _write_residual(voxel_points[residual_mask], voxel_normals[residual_mask], stl_path, obj_path)
    step_note = _try_mesh_in_step(step_path, written, mesh_info.get("mesh"))
    _write_glb(written, mesh_info.get("mesh"), up, glb_path)
    listed = []
    for surface in written:
        listed.append(
            {
                "role": surface["role"],
                "name": surface["name"],
                "widthMm": round(float(surface["width"]), 1),
                "heightMm": round(float(surface["height"]), 1),
                "areaMm2": round(float(surface["area"]), 1),
                "normal": [round(float(v), 5) for v in surface["normal"]],
                "support": int(surface["support"]),
                "thicknessMm": SLAB_MM,
                "step": "completo",
            }
        )
    return {
        "geometry": "completa",
        "upAxis": "Y" if abs(float(np.asarray(up, float)[1])) > 0.9 else ("Z" if abs(float(np.asarray(up, float)[2])) > 0.9 else "altro"),
        "mode": mode,
        "surfaces": listed,
        "surfaceCount": len(listed),
        "residual": {
            "points": int(residual_mask.sum()),
            "faces": mesh_info.get("faces", 0),
            "stl": os.path.basename(stl_path) if mesh_info.get("wrote") else None,
            "obj": os.path.basename(obj_path) if mesh_info.get("wrote") else None,
            "step": step_note,
        },
        "files": {
            "completo.step": _size(step_path),
            "completo.glb": _size(glb_path),
            "oggetti.stl": _size(stl_path),
            "oggetti.obj": _size(obj_path),
        },
    }


def _segment_voxel(points, normals, up):
    cloud = np.asarray(points, float)
    dirs = _unit_rows(np.asarray(normals, float))
    keep = _voxel_indices(cloud, VOXEL_MM)
    cloud = cloud[keep]
    dirs = dirs[keep]
    vertical = np.asarray(up, float)
    vertical = vertical / max(float(np.linalg.norm(vertical)), 1e-12)
    remaining = np.ones(len(cloud), dtype=bool)
    blocked = np.zeros(len(cloud), dtype=bool)
    found: list[dict] = []
    fails = 0
    rng = np.random.default_rng(7)
    while int((remaining & ~blocked).sum()) >= MIN_SUPPORT and len(found) < MAX_PLANES and fails < MAX_FAILS:
        active = remaining & ~blocked
        fit = _ransac_plane(cloud, dirs, active, rng)
        if fit is None or int((fit["inliers"] & remaining).sum()) < MIN_SUPPORT:
            break
        cluster = _largest_cluster(cloud, fit["inliers"] & remaining, VOXEL_MM * 2.6)
        if int(cluster.sum()) < MIN_SUPPORT:
            blocked |= fit["inliers"] & remaining
            fails += 1
            continue
        surface = _measure_surface(cloud, cluster, fit["normal"], vertical)
        if surface is None:
            blocked |= cluster
            fails += 1
            continue
        fails = 0
        remaining[cluster] = False
        found.append(surface)
        print(
            f"[completa] piano {len(found)} supporto {surface['support']} "
            f"{surface['width']:.0f}×{surface['height']:.0f} mm",
            flush=True,
        )
    _assign_roles(found, cloud, vertical)
    return found, remaining, cloud, dirs


def _measure_surface(cloud, mask, normal, up):
    pts = cloud[mask]
    if len(pts) < MIN_SUPPORT:
        return None
    centroid = pts.mean(0)
    normal = np.asarray(normal, float)
    normal = normal / max(float(np.linalg.norm(normal)), 1e-12)
    origin = centroid - normal * float(np.dot(centroid, normal) - np.dot(normal, centroid))
    # origin is the centroid projected: centroid - n * (n·centroid - n·centroid) = centroid
    # Project properly onto the fitted plane. The RANSAC plane passes near the inliers.
    signed = (pts - centroid) @ normal
    origin = centroid + normal * float(np.median(signed))
    axis_u = np.cross(up, normal)
    if float(np.linalg.norm(axis_u)) < 0.25:
        seed = np.array([1.0, 0.0, 0.0]) if abs(float(normal[0])) < 0.9 else np.array([0.0, 1.0, 0.0])
        axis_u = np.cross(seed, normal)
    axis_u = axis_u / np.linalg.norm(axis_u)
    axis_v = np.cross(normal, axis_u)
    axis_v = axis_v / np.linalg.norm(axis_v)
    uv = np.column_stack([(pts - origin) @ axis_u, (pts - origin) @ axis_v])
    polygon = _footprint(uv)
    if polygon is None:
        return None
    width = float(polygon[:, 0].max() - polygon[:, 0].min())
    height = float(polygon[:, 1].max() - polygon[:, 1].min())
    area = abs(_shoelace(polygon))
    if width < MIN_EXTENT_MM or height < MIN_EXTENT_MM or area < MIN_EXTENT_MM * MIN_EXTENT_MM * 0.45:
        return None
    return {
        "normal": normal,
        "origin": origin,
        "axis_u": axis_u,
        "axis_v": axis_v,
        "polygon": polygon,
        "width": width,
        "height": height,
        "area": area,
        "support": int(mask.sum()),
        "up_coord": float(np.dot(origin, up)),
    }


def _extreme_horizontal(surfaces: list[dict], edge: float, span: float, which: str):
    band = 0.22 * span
    if which == "floor":
        near = [item for item in surfaces if item["up_coord"] <= edge + band and item["area"] >= 150_000]
    else:
        near = [item for item in surfaces if item["up_coord"] >= edge - band and item["area"] >= 150_000]
    if not near:
        return None
    return max(near, key=lambda item: item["area"])


def _assign_roles(surfaces: list[dict], cloud, up):
    if not surfaces:
        return
    coords = cloud @ up
    low = float(np.percentile(coords, 5))
    high = float(np.percentile(coords, 95))
    span = max(high - low, 1.0)
    for surface in surfaces:
        align = abs(float(np.dot(surface["normal"], up)))
        if align >= 0.82:
            kind = "horizontal"
        elif align <= 0.34:
            kind = "vertical"
        else:
            kind = "inclined"
        surface["_kind"] = kind
    horizontals = [item for item in surfaces if item["_kind"] == "horizontal"]
    # The largest plane near each extreme. A smaller patch a few millimetres
    # lower must not steal the floor from the real ground.
    floor = _extreme_horizontal(horizontals, low, span, "floor")
    ceiling = _extreme_horizontal(horizontals, high, span, "ceiling")
    if ceiling is floor:
        ceiling = None
    for surface in surfaces:
        if surface["_kind"] == "inclined":
            surface["role"] = "inclinata"
        elif surface["_kind"] == "horizontal":
            if surface is floor:
                surface["role"] = "pavimento"
            elif surface is ceiling:
                surface["role"] = "soffitto"
            else:
                surface["role"] = "orizzontale"
        else:
            long_side = max(surface["width"], surface["height"])
            surface["role"] = "parete" if surface["area"] >= 800_000 or long_side >= 1200 else "verticale"
        surface.pop("_kind", None)


def _footprint(uv: np.ndarray):
    polygon = _alpha_polygon(uv, ALPHA_MM)
    if polygon is None:
        polygon = _grid_polygon(uv, 40.0)
    if polygon is None or len(polygon) < 3:
        return None
    polygon = _simplify_closed(polygon, SIMPLIFY_MM)
    if len(polygon) < 3:
        return None
    if _shoelace(polygon) < 0:
        polygon = polygon[::-1]
    return polygon


def _alpha_polygon(uv: np.ndarray, alpha: float):
    try:
        from scipy.spatial import Delaunay
    except ImportError:
        return None
    unique = _unique_rows(uv, 8.0)
    if len(unique) < 4:
        return None
    try:
        triangles = Delaunay(unique).simplices
    except Exception:
        return None
    pts = unique[triangles]
    a = np.linalg.norm(pts[:, 0] - pts[:, 1], axis=1)
    b = np.linalg.norm(pts[:, 1] - pts[:, 2], axis=1)
    c = np.linalg.norm(pts[:, 2] - pts[:, 0], axis=1)
    area2 = np.maximum((a + (b + c)) * (-a + b + c) * (a - b + c) * (a + b - c), 0.0)
    circum = np.divide(a * b * c, np.sqrt(area2), out=np.full(len(triangles), np.inf), where=area2 > 1e-6)
    keep = triangles[circum <= alpha * 2.0]
    if len(keep) < 1:
        return None
    counts: dict[tuple[int, int], int] = {}
    for tri in keep:
        for i, j in ((0, 1), (1, 2), (2, 0)):
            edge = (int(tri[i]), int(tri[j])) if tri[i] < tri[j] else (int(tri[j]), int(tri[i]))
            counts[edge] = counts.get(edge, 0) + 1
    boundary = [edge for edge, count in counts.items() if count == 1]
    loops = _boundary_loops(boundary)
    if not loops:
        return None
    polygons = [unique[np.asarray(loop)] for loop in loops if len(loop) >= 3]
    if not polygons:
        return None
    return max(polygons, key=lambda item: abs(_shoelace(item)))


def _boundary_loops(edges: list[tuple[int, int]]):
    adj: dict[int, list[int]] = {}
    for a, b in edges:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    unused = {tuple(sorted(edge)) for edge in edges}
    loops = []
    for seed in list(unused):
        if seed not in unused:
            continue
        start, nxt = seed
        loop = [start]
        prev, cur = start, nxt
        unused.discard(tuple(sorted((prev, cur))))
        guard = 0
        while cur != start and guard < 100000:
            loop.append(cur)
            options = [n for n in adj.get(cur, []) if n != prev and tuple(sorted((cur, n))) in unused]
            if not options:
                break
            prev, cur = cur, options[0]
            unused.discard(tuple(sorted((prev, cur))))
            guard += 1
        if cur == start and len(loop) >= 3:
            loops.append(loop)
    return loops


def _grid_polygon(uv: np.ndarray, cell: float):
    if len(uv) < 4:
        return None
    origin = uv.min(0) - cell
    idx = np.floor((uv - origin) / cell).astype(np.int64)
    occupied = {(int(i), int(j)) for i, j in idx}
    closed = set()
    for i, j in occupied:
        if all((i + di, j + dj) in occupied or (di == 0 and dj == 0) for di in (-1, 0, 1) for dj in (-1, 0, 1)):
            closed.add((i, j))
    cells = closed or occupied
    edges: dict[tuple[tuple[int, int], tuple[int, int]], int] = {}

    def add(a, b):
        key = (a, b) if a <= b else (b, a)
        edges[key] = edges.get(key, 0) + 1

    for i, j in cells:
        add((i, j), (i + 1, j))
        add((i + 1, j), (i + 1, j + 1))
        add((i + 1, j + 1), (i, j + 1))
        add((i, j + 1), (i, j))
    boundary = [edge for edge, count in edges.items() if count == 1]
    if len(boundary) < 3:
        return None
    # Walk the pixel boundary and turn the corners into UV.
    adj: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for a, b in boundary:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    start = min(adj)
    loop = [start]
    prev = None
    cur = start
    guard = 0
    while guard < 100000:
        nxts = [n for n in adj[cur] if n != prev]
        if not nxts:
            break
        nxt = nxts[0]
        if nxt == start and len(loop) > 2:
            break
        loop.append(nxt)
        prev, cur = cur, nxt
        guard += 1
    if len(loop) < 3:
        return None
    return origin + (np.asarray(loop, float) + 0.5) * cell


def _simplify_closed(polygon: np.ndarray, tolerance: float):
    """Douglas–Peucker on a closed ring. Local vertex culling deletes corners."""
    pts = np.asarray(polygon, float)
    count = len(pts)
    if count <= 6:
        return pts
    i0 = int(np.argmin(pts[:, 0] + 0.001 * pts[:, 1]))
    i1 = int(np.argmax(pts[:, 0] + 0.001 * pts[:, 1]))
    if i0 == i1:
        return pts

    def chain(start: int, end: int) -> list[int]:
        if start <= end:
            return list(range(start, end + 1))
        return list(range(start, count)) + list(range(0, end + 1))

    def rdp(indices: list[int]) -> list[int]:
        if len(indices) < 3:
            return indices
        start = pts[indices[0]]
        end = pts[indices[-1]]
        base = end - start
        length = float(np.linalg.norm(base))
        if length < 1e-6:
            distances = [float(np.linalg.norm(pts[index] - start)) for index in indices]
        else:
            distances = [abs(float(np.cross(pts[index] - start, base))) / length for index in indices]
        mid = int(np.argmax(distances))
        if distances[mid] <= tolerance or mid in (0, len(indices) - 1):
            return [indices[0], indices[-1]]
        return rdp(indices[: mid + 1])[:-1] + rdp(indices[mid:])

    merged = rdp(chain(i0, i1))[:-1] + rdp(chain(i1, i0))[:-1]
    if len(merged) < 3:
        return pts
    return pts[np.asarray(merged, np.int64)]


def _ransac_plane(cloud, normals, active, rng: np.random.Generator):
    ids = np.flatnonzero(active)
    if len(ids) < 3:
        return None
    best = None
    trials = 70 if len(ids) > 4000 else 40
    sample_cap = min(len(ids), 25000)
    pool = ids if len(ids) <= sample_cap else rng.choice(ids, sample_cap, replace=False)
    for _ in range(trials):
        chosen = rng.choice(pool, 3, replace=False)
        p0, p1, p2 = cloud[chosen]
        normal = np.cross(p1 - p0, p2 - p0)
        length = float(np.linalg.norm(normal))
        if length < 1e-6:
            continue
        normal = normal / length
        if float(np.dot(normals[chosen].mean(0), normal)) < 0:
            normal = -normal
        offset = float(np.dot(normal, p0))
        distance = np.abs(cloud[pool] @ normal - offset)
        agree = np.abs(normals[pool] @ normal) >= NORMAL_COS
        count = int(np.count_nonzero((distance <= PLANE_DIST_MM) & agree))
        if best is None or count > best[0]:
            best = (count, normal, offset)
    if best is None:
        return None
    _count, normal, offset = best
    distance = np.abs(cloud @ normal - offset)
    agree = np.abs(normals @ normal) >= NORMAL_COS
    inliers = active & (distance <= PLANE_DIST_MM) & agree
    return {"normal": normal, "offset": offset, "inliers": inliers}


def _largest_cluster(cloud, mask, radius: float):
    ids = np.flatnonzero(mask)
    if len(ids) == 0:
        return mask
    cells: dict[tuple[int, int, int], list[int]] = {}
    keys = np.floor(cloud[ids] / radius).astype(np.int64)
    for local, key in enumerate(keys):
        cells.setdefault((int(key[0]), int(key[1]), int(key[2])), []).append(int(ids[local]))
    seen: set[tuple[int, int, int]] = set()
    best: list[int] = []
    for seed in cells:
        if seed in seen:
            continue
        stack = [seed]
        seen.add(seed)
        group: list[int] = []
        while stack:
            cur = stack.pop()
            group.extend(cells[cur])
            cx, cy, cz = cur
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        nxt = (cx + dx, cy + dy, cz + dz)
                        if nxt in cells and nxt not in seen:
                            seen.add(nxt)
                            stack.append(nxt)
        if len(group) > len(best):
            best = group
    out = np.zeros(len(cloud), dtype=bool)
    if best:
        out[np.asarray(best, np.int64)] = True
    return out


def _write_step(surfaces: list[dict], path: str) -> list[dict]:
    import cadquery as cq

    assembly = cq.Assembly(name="completo")
    written = []
    counts = {role: 0 for role in ROLES}
    for surface in surfaces:
        solid = _slab(cq, surface)
        if solid is None:
            continue
        counts[surface["role"]] = counts.get(surface["role"], 0) + 1
        surface = dict(surface)
        surface["name"] = f"{ROLE_LABEL[surface['role']]} {counts[surface['role']]:02d}"
        surface["solid"] = solid
        assembly.add(solid, name=surface["name"])
        written.append(surface)
    if not written:
        raise RuntimeError("Nessuna superficie abbastanza estesa per la geometria completa.")
    assembly.save(path)
    return written


def _slab(cq, surface):
    polygon = surface["polygon"]
    try:
        origin = surface["origin"] - surface["normal"] * (SLAB_MM / 2.0)
        plane = cq.Plane(cq.Vector(*origin), cq.Vector(*surface["axis_u"]), cq.Vector(*surface["normal"]))
        work = cq.Workplane(plane).polyline([(float(u), float(v)) for u, v in polygon]).close()
        return work.extrude(SLAB_MM).val()
    except Exception as exc:
        print(f"[completa] lastra saltata ({surface.get('role')}): {exc}", flush=True)
        return None


def _write_residual(points, normals, stl_path: str, obj_path: str) -> dict:
    info = {"wrote": False, "faces": 0, "mesh": None}
    if len(points) < 80:
        info["step"] = "omesso: pochi punti residui"
        return info
    try:
        import open3d as o3d
    except ImportError:
        info["step"] = "omesso: open3d assente"
        return info
    print(f"[completa] mesh residua su {len(points)} punti", flush=True)
    cloud = o3d.geometry.PointCloud()
    cloud.points = o3d.utility.Vector3dVector(np.asarray(points, float))
    cloud.normals = o3d.utility.Vector3dVector(_unit_rows(np.asarray(normals, float)))
    mesh = _mesh_residual(o3d, cloud)
    if mesh is None or len(mesh.triangles) < 50:
        info["step"] = "omesso: la mesh residua è vuota"
        return info
    mesh = _clean_mesh(o3d, mesh)
    if len(mesh.triangles) > MESH_FACE_CAP:
        mesh = mesh.simplify_quadric_decimation(MESH_FACE_CAP)
        mesh = _clean_mesh(o3d, mesh)
    mesh.compute_triangle_normals()
    mesh.compute_vertex_normals()
    if not o3d.io.write_triangle_mesh(stl_path, mesh, write_ascii=False):
        info["step"] = "omesso: scrittura STL non riuscita"
        return info
    o3d.io.write_triangle_mesh(obj_path, mesh, write_triangle_uvs=False)
    info.update(wrote=True, faces=int(len(mesh.triangles)), mesh=_as_trimesh(mesh))
    return info


def _mesh_residual(o3d, cloud):
    radii = o3d.utility.DoubleVector([VOXEL_MM * 1.6, VOXEL_MM * 3.0, VOXEL_MM * 5.0])
    try:
        pivoted = o3d.geometry.TriangleMesh.create_from_point_cloud_ball_pivoting(cloud, radii)
    except Exception:
        pivoted = None
    if pivoted is not None and len(pivoted.triangles) >= 400:
        return pivoted
    try:
        poisson, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(cloud, depth=8)
    except Exception:
        return pivoted
    if len(poisson.triangles) == 0:
        return pivoted
    density = np.asarray(densities)
    if len(density) == len(poisson.vertices):
        cutoff = float(np.quantile(density, 0.08))
        poisson.remove_vertices_by_mask(density < cutoff)
    return poisson


def _clean_mesh(o3d, mesh):
    mesh.remove_duplicated_vertices()
    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_unreferenced_vertices()
    if len(mesh.triangles) == 0:
        return mesh
    clusters, counts, areas = mesh.cluster_connected_triangles()
    labels = np.asarray(clusters)
    sizes = np.asarray(areas)
    if len(sizes) == 0:
        return mesh
    drop = np.zeros(len(mesh.triangles), dtype=bool)
    for label, area in enumerate(sizes):
        if area < 8_000:
            drop |= labels == label
    if drop.any() and not drop.all():
        mesh.remove_triangles_by_mask(drop)
        mesh.remove_unreferenced_vertices()
    return mesh


def _as_trimesh(mesh):
    import trimesh

    vertices = np.asarray(mesh.vertices, float)
    faces = np.asarray(mesh.triangles, np.int64)
    return trimesh.Trimesh(vertices, faces, process=False)


def _try_mesh_in_step(step_path: str, surfaces: list[dict], mesh) -> str:
    if mesh is None or len(mesh.faces) < 50:
        return "omesso: mesh residua assente"
    target = mesh
    if len(target.faces) > STEP_MESH_FACE_CAP:
        try:
            target = target.simplify_quadric_decimation(STEP_MESH_FACE_CAP)
        except Exception:
            target = mesh
    try:
        shell = _mesh_solid(target)
    except Exception as exc:
        return f"omesso: {exc.__class__.__name__}"
    if shell is None:
        return "omesso: il guscio non si è chiuso"
    try:
        import cadquery as cq

        compound = cq.Assembly(name="completo")
        for surface in surfaces:
            compound.add(surface["solid"], name=surface["name"])
        compound.add(shell, name="Oggetti")
        compound.save(step_path)
    except Exception as exc:
        _save_slabs(surfaces, step_path)
        return f"omesso: {exc.__class__.__name__}"
    if _size(step_path) > STEP_MESH_MAX_BYTES:
        _save_slabs(surfaces, step_path)
        return f"omesso: il file supererebbe {STEP_MESH_MAX_BYTES // (1024 * 1024)} MB"
    return "incluso"


def _save_slabs(surfaces: list[dict], path: str):
    import cadquery as cq

    assembly = cq.Assembly(name="completo")
    for surface in surfaces:
        assembly.add(surface["solid"], name=surface["name"])
    assembly.save(path)


def _mesh_solid(mesh):
    """One tessellated shell. Sewing each triangle as a BRep face blows past 50 MB."""
    from OCP.BRep import BRep_Builder
    from OCP.Poly import Poly_Triangle, Poly_Triangulation
    from OCP.gp import gp_Pnt
    from OCP.TopoDS import TopoDS_Face, TopoDS_Shell

    vertices = np.asarray(mesh.vertices, float)
    faces = np.asarray(mesh.faces, np.int64)
    if len(faces):
        distinct = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
        faces = faces[distinct]
    if len(vertices) < 3 or len(faces) < 50:
        return None
    triangulation = Poly_Triangulation(int(len(vertices)), int(len(faces)), False)
    for index, point in enumerate(vertices, start=1):
        triangulation.SetNode(index, gp_Pnt(float(point[0]), float(point[1]), float(point[2])))
    for index, tri in enumerate(faces, start=1):
        triangulation.SetTriangle(index, Poly_Triangle(int(tri[0]) + 1, int(tri[1]) + 1, int(tri[2]) + 1))
    face = TopoDS_Face()
    builder = BRep_Builder()
    builder.MakeFace(face)
    builder.UpdateFace(face, triangulation, True)
    shell = TopoDS_Shell()
    builder.MakeShell(shell)
    builder.Add(shell, face)
    import cadquery as cq

    return cq.Shape.cast(shell)


def _write_glb(surfaces: list[dict], residual, up, path: str):
    import trimesh

    scene = trimesh.Scene()
    for index, surface in enumerate(surfaces, start=1):
        mesh = _slab_mesh(surface)
        if mesh is None:
            continue
        scene.add_geometry(mesh, geom_name=f"{surface['role']}-{index:02d}")
    if residual is not None and len(getattr(residual, "faces", [])) > 0:
        scene.add_geometry(residual.copy(), geom_name="oggetti")
    rotation = _y_up_matrix(up)
    if rotation is not None:
        scene.apply_transform(rotation)
    scene.export(path)


def _slab_mesh(surface):
    import trimesh

    polygon = np.asarray(surface["polygon"], float)
    if len(polygon) < 3:
        return None
    triangles = _ear_clip(polygon)
    if not triangles:
        return None
    count = len(polygon)
    bottom = np.column_stack([polygon, np.full(count, -SLAB_MM / 2.0)])
    top = np.column_stack([polygon, np.full(count, SLAB_MM / 2.0)])
    local = np.vstack([bottom, top])
    faces = []
    for a, b, c in triangles:
        faces.append((a, c, b))
        faces.append((a + count, b + count, c + count))
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, j + count))
        faces.append((i, j + count, i + count))
    rotation = np.column_stack([surface["axis_u"], surface["axis_v"], surface["normal"]])
    world = local @ rotation.T + surface["origin"]
    mesh = trimesh.Trimesh(world, np.asarray(faces, np.int64), process=False)
    mesh.fix_normals()
    return mesh


def _y_up_matrix(up):
    vertical = np.asarray(up, float)
    vertical = vertical / max(float(np.linalg.norm(vertical)), 1e-12)
    if abs(float(vertical[1])) > 0.9:
        return None
    target = np.array([0.0, 1.0, 0.0])
    axis = np.cross(vertical, target)
    length = float(np.linalg.norm(axis))
    if length < 1e-8:
        matrix = np.eye(4)
        if float(np.dot(vertical, target)) < 0:
            matrix[1, 1] = -1
            matrix[2, 2] = -1
        return matrix
    axis = axis / length
    angle = float(np.arccos(np.clip(np.dot(vertical, target), -1.0, 1.0)))
    cross = np.array(
        [
            [0.0, -axis[2], axis[1]],
            [axis[2], 0.0, -axis[0]],
            [-axis[1], axis[0], 0.0],
        ]
    )
    rotation = np.eye(3) + np.sin(angle) * cross + (1.0 - np.cos(angle)) * (cross @ cross)
    matrix = np.eye(4)
    matrix[:3, :3] = rotation
    return matrix


def _ear_clip(polygon: np.ndarray):
    polygon = np.asarray(polygon, float)
    count = len(polygon)
    if count < 3:
        return []
    if count == 3:
        return [(0, 1, 2)]
    indices = list(range(count))
    if _shoelace(polygon) < 0:
        indices.reverse()
    triangles = []
    guard = 0
    while len(indices) > 3 and guard < count * count:
        guard += 1
        clipped = False
        for pos in range(len(indices)):
            i0 = indices[(pos - 1) % len(indices)]
            i1 = indices[pos]
            i2 = indices[(pos + 1) % len(indices)]
            a, b, c = polygon[i0], polygon[i1], polygon[i2]
            if np.cross(b - a, c - b) <= 1e-6:
                continue
            if any(_point_in_triangle(polygon[other], a, b, c) for other in indices if other not in (i0, i1, i2)):
                continue
            triangles.append((i0, i1, i2))
            del indices[pos]
            clipped = True
            break
        if not clipped:
            break
    if len(indices) == 3:
        triangles.append(tuple(indices))
    return triangles


def _point_in_triangle(point, a, b, c):
    v0, v1, v2 = c - a, b - a, point - a
    dot00 = float(np.dot(v0, v0))
    dot01 = float(np.dot(v0, v1))
    dot02 = float(np.dot(v0, v2))
    dot11 = float(np.dot(v1, v1))
    dot12 = float(np.dot(v1, v2))
    denom = dot00 * dot11 - dot01 * dot01
    if abs(denom) < 1e-12:
        return False
    u = (dot11 * dot02 - dot01 * dot12) / denom
    v = (dot00 * dot12 - dot01 * dot02) / denom
    return u > 1e-8 and v > 1e-8 and u + v < 1 - 1e-8


def _voxel_cloud(points, normals):
    keep = _voxel_indices(points, VOXEL_MM)
    return points[keep], normals[keep]


def _voxel_indices(points, voxel: float):
    if len(points) == 0:
        return np.zeros(0, dtype=int)
    keys = np.floor(np.asarray(points, float) / voxel).astype(np.int64)
    _unique, index = np.unique(keys, axis=0, return_index=True)
    return np.sort(index)


def _unique_rows(points, quantum: float):
    keys = np.round(np.asarray(points, float) / quantum).astype(np.int64)
    _unique, index = np.unique(keys, axis=0, return_index=True)
    return np.asarray(points, float)[np.sort(index)]


def _unit_rows(rows: np.ndarray):
    length = np.linalg.norm(rows, axis=1, keepdims=True)
    return rows / np.maximum(length, 1e-12)


def _shoelace(polygon: np.ndarray) -> float:
    x = polygon[:, 0]
    y = polygon[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def _size(path: str) -> int:
    return os.path.getsize(path) if os.path.isfile(path) else 0
