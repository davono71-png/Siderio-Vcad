"""COLMAP SfM. GPU SIFT when the device is sm_61 or sm_89; otherwise CPU.

The official pycolmap-cuda12 wheels (4.2.x) ship cubins for sm_90/100/120 only,
so this image compiles COLMAP for Pascal (61) and Ada (89) instead.
"""

from __future__ import annotations

import os
import shutil
import subprocess

import numpy as np

# Architectures compiled into this image. The Dockerfile sets SIDERIO_CUDA_SMS to the same list.
def compiled_sms() -> set[int]:
    raw = os.environ.get("SIDERIO_CUDA_SMS", "61,89")
    found = set()
    for part in raw.replace(";", ",").split(","):
        part = part.strip()
        if part:
            found.add(int(part))
    return found or {61, 89}


class SfmError(RuntimeError):
    pass


def gpu_capability():
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=compute_cap", "--format=csv,noheader"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    line = out.strip().splitlines()
    if not line or not line[0].strip():
        return None
    major, _, minor = line[0].strip().partition(".")
    try:
        return int(major), int(minor or "0")
    except ValueError:
        return None


def resolve_device(requested: str) -> tuple[str, str]:
    """Return (cpu|cuda, human reason)."""
    cap = gpu_capability()
    if requested == "cpu":
        return "cpu", "richiesto cpu"
    if cap is None:
        if requested == "cuda":
            raise SfmError("options.device=cuda ma nvidia-smi non vede una GPU.")
        return "cpu", "nessuna GPU visibile"
    sm = cap[0] * 10 + cap[1]
    if sm in compiled_sms():
        return "cuda", f"GPU sm_{sm}"
    if requested == "cuda":
        raise SfmError(
            f"La GPU è sm_{sm}. Questa immagine ha i kernel CUDA per sm_61 (Quadro P4000) e sm_89 (RTX 4090). "
            "Ricostruisci l'immagine con --build-arg CUDA_ARCHITECTURES oppure usa options.device=cpu."
        )
    return "cpu", f"GPU sm_{sm} non è tra i kernel compilati (61, 89): uso la CPU"


def _device(pycolmap, name: str):
    return pycolmap.Device.cuda if name == "cuda" else pycolmap.Device.cpu


def _camera_params(model: str, width: int, height: int, focal: float) -> str:
    cx, cy = width / 2.0, height / 2.0
    if model == "SIMPLE_RADIAL":
        return f"{focal},{cx},{cy},0"
    if model == "RADIAL":
        return f"{focal},{cx},{cy},0,0"
    return f"{focal},{focal},{cx},{cy},0,0,0,0"


def _summary(reconstruction, names: list[str]) -> dict:
    registered = sorted(image.name for image in reconstruction.images.values() if image.has_pose())
    missing = sorted(set(names) - set(registered))
    return {
        "registered": int(reconstruction.num_reg_images()),
        "points": int(reconstruction.num_points3D()),
        "reprojPx": float(reconstruction.compute_mean_reprojection_error()) if reconstruction.num_points3D() else None,
        "track": float(reconstruction.compute_mean_track_length()) if reconstruction.num_points3D() else None,
        "missing": missing,
        "names": registered,
    }


def run_sfm(work_dir: str, rows: list[dict], device: str, max_features: int, seeds: int, threads: int, log=print) -> dict:
    import pycolmap

    pycolmap.set_random_seed(0)
    image_dir = os.path.join(work_dir, "images")
    database = os.path.join(work_dir, "database.db")
    names = [row["name"] for row in rows]
    width, height = int(rows[0]["w"]), int(rows[0]["h"])
    same_size = all(int(row["w"]) == width and int(row["h"]) == height for row in rows)
    focals = [float(row["focalPx"]) for row in rows if row.get("focalPx")]
    if focals:
        focal = float(np.median(focals))
        prior = True
    else:
        # Wide-angle phone prior, not locked: bundle adjustment may change it.
        focal = 0.85 * max(width, height)
        prior = False
    model = "RADIAL"
    if os.path.exists(database):
        os.remove(database)
    extraction = pycolmap.FeatureExtractionOptions()
    extraction.max_image_size = max(width, height)
    extraction.num_threads = threads
    extraction.sift.max_num_features = int(max_features)
    extraction.sift.peak_threshold = 0.004
    extraction.sift.estimate_affine_shape = True
    extraction.sift.domain_size_pooling = True
    reader = pycolmap.ImageReaderOptions()
    reader.camera_model = model
    reader.camera_params = _camera_params(model, width, height, focal)
    mode = pycolmap.CameraMode.SINGLE if same_size else pycolmap.CameraMode.PER_IMAGE
    dev = _device(pycolmap, device)
    log(f"SIFT device={device} camera={'SINGLE' if same_size else 'PER_IMAGE'} focal_px={focal:.1f} prior={prior}")
    try:
        pycolmap.extract_features(
            database,
            image_dir,
            image_names=names,
            camera_mode=mode,
            reader_options=reader,
            extraction_options=extraction,
            device=dev,
        )
    except Exception as exc:
        if device != "cuda":
            raise
        log(f"SIFT GPU non riuscito ({exc}); riprovo in CPU")
        device = "cpu"
        pycolmap.extract_features(
            database,
            image_dir,
            image_names=names,
            camera_mode=mode,
            reader_options=reader,
            extraction_options=extraction,
            device=pycolmap.Device.cpu,
        )
    if prior:
        db = pycolmap.Database.open(database)
        for camera in db.read_all_cameras():
            camera.has_prior_focal_length = True
            db.update_camera(camera)
        db.close()
    matching = pycolmap.FeatureMatchingOptions()
    matching.num_threads = threads
    matching.guided_matching = True
    verify = pycolmap.TwoViewGeometryOptions()
    verify.min_num_inliers = 15
    try:
        pycolmap.match_exhaustive(database, matching_options=matching, verification_options=verify, device=_device(pycolmap, device))
    except Exception as exc:
        if device != "cuda":
            raise
        log(f"matching GPU non riuscito ({exc}); riprovo in CPU")
        device = "cpu"
        pycolmap.match_exhaustive(database, matching_options=matching, verification_options=verify, device=pycolmap.Device.cpu)

    best = None
    for seed in range(int(seeds)):
        tmp = os.path.join(work_dir, f"sparse_seed{seed}")
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp, exist_ok=True)
        options = _mapper_options(pycolmap, threads, seed, strict=True)
        recs = pycolmap.incremental_mapping(database, image_dir, tmp, options)
        if not recs:
            continue
        key = max(recs, key=lambda k: (recs[k].num_reg_images(), recs[k].num_points3D()))
        rec = recs[key]
        score = (rec.num_reg_images(), -rec.compute_mean_reprojection_error() if rec.num_points3D() else 0)
        info = _summary(rec, names)
        log(f"seed {seed}: registrate {info['registered']}/{len(names)} reproj {info['reprojPx']}")
        if best is None or score > best[0]:
            best = (score, seed, key, info)
        if info["registered"] == len(names):
            break
    if best is None:
        raise SfmError("SfM non ha registrato nessuna foto.")
    sparse = os.path.join(work_dir, "sparse")
    shutil.rmtree(sparse, ignore_errors=True)
    os.makedirs(sparse, exist_ok=True)
    shutil.copytree(os.path.join(work_dir, f"sparse_seed{best[1]}", str(best[2])), os.path.join(sparse, "0"))
    for seed in range(int(seeds)):
        shutil.rmtree(os.path.join(work_dir, f"sparse_seed{seed}"), ignore_errors=True)

    chosen = pycolmap.Reconstruction(os.path.join(sparse, "0"))
    extended = False
    if chosen.num_reg_images() < len(names):
        ext = os.path.join(work_dir, "sparse_ext")
        os.makedirs(ext, exist_ok=True)
        loose = _mapper_options(pycolmap, threads, 0, strict=False)
        recs = pycolmap.incremental_mapping(database, image_dir, ext, loose, input_path=os.path.join(sparse, "0"))
        if recs:
            key = max(recs, key=lambda k: recs[k].num_reg_images())
            if recs[key].num_reg_images() > chosen.num_reg_images():
                chosen = recs[key]
                extended = True
                log(f"soglie allentate: registrate {chosen.num_reg_images()}/{len(names)}")
        if not extended and os.path.isdir(ext):
            # incremental_mapping may have written the model without returning it.
            sub = [d for d in os.listdir(ext) if os.path.isdir(os.path.join(ext, d))]
            if sub:
                alt = pycolmap.Reconstruction(os.path.join(ext, sub[0]))
                if alt.num_reg_images() > chosen.num_reg_images():
                    chosen = alt
                    extended = True
    ext_dir = os.path.join(work_dir, "sparse_ext")
    shutil.rmtree(ext_dir, ignore_errors=True)
    os.makedirs(ext_dir, exist_ok=True)
    chosen.write(ext_dir)
    final = _summary(pycolmap.Reconstruction(ext_dir), names)
    cameras = []
    rec = pycolmap.Reconstruction(ext_dir)
    for camera in rec.cameras.values():
        cameras.append({"id": int(camera.camera_id), "model": str(camera.model_name), "params": [float(v) for v in camera.params]})
    return {
        "device": device,
        "registered": final["registered"],
        "total": len(names),
        "reprojPx": final["reprojPx"],
        "track": final["track"],
        "missing": final["missing"],
        "extended": extended,
        "sparse": ext_dir,
        "cameras": cameras,
        "sameCamera": same_size,
        "focalPriorPx": focal,
        "focalLocked": prior,
    }


def _mapper_options(pycolmap, threads: int, seed: int, strict: bool):
    options = pycolmap.IncrementalPipelineOptions()
    options.num_threads = threads
    options.ba_refine_principal_point = False
    options.min_num_matches = 15 if strict else 10
    options.multiple_models = True if strict else False
    options.random_seed = seed
    mapper = options.mapper
    mapper.init_min_tri_angle = 4
    mapper.random_seed = seed
    if strict:
        mapper.abs_pose_min_num_inliers = 15
        mapper.abs_pose_min_inlier_ratio = 0.15
    else:
        mapper.abs_pose_min_num_inliers = 8
        mapper.abs_pose_min_inlier_ratio = 0.08
        mapper.abs_pose_max_error = 16
        mapper.filter_max_reproj_error = 4
    return options


def write_dense_subset(sparse_dir: str, dest_dir: str, weak_names: set[str], log=print) -> int:
    """Copy the reconstruction used for dense stereo, dropping very weak frames."""
    import pycolmap

    rec = pycolmap.Reconstruction(sparse_dir)
    dropped = 0
    for image in list(rec.images.values()):
        weak_count = image.has_pose() and image.num_points3D() < 15
        if image.name in weak_names or weak_count:
            if image.has_pose():
                log(f"escludo {image.name} dalla mesh densa")
                rec.deregister_frame(image.frame_id)
                dropped += 1
    shutil.rmtree(dest_dir, ignore_errors=True)
    os.makedirs(dest_dir, exist_ok=True)
    rec.write(dest_dir)
    return int(rec.num_reg_images())


def pose_check(project: dict, sparse_dir: str, rows: list[dict]) -> dict:
    """Compare SfM viewing directions with the phone's east/north/up vectors."""
    import pycolmap

    rec = pycolmap.Reconstruction(sparse_dir)
    by_file = {}
    for photo in project.get("photos") or []:
        direction = photo.get("direction")
        if not direction:
            continue
        by_file[photo["id"]] = np.array([direction["east"], direction["north"], direction["up"]], float)
    id_of = {row["name"]: row["photoId"] for row in rows}
    names, colmap_dirs, phone_dirs = [], [], []
    for image in rec.images.values():
        photo_id = id_of.get(image.name)
        if photo_id not in by_file or not image.has_pose():
            continue
        rotation = np.asarray(image.cam_from_world().rotation.matrix(), float)
        names.append(image.name)
        colmap_dirs.append(rotation.T @ np.array([0.0, 0.0, 1.0]))
        phone_dirs.append(by_file[photo_id])
    result = {"n": len(names), "medianDirErrDeg": None, "medianElevErrDeg": None, "upColmap": None}
    if len(names) < 3:
        return result
    A = np.vstack(colmap_dirs)
    B = np.vstack(phone_dirs)

    def kabsch(left, right):
        u, _, vt = np.linalg.svd(right.T @ left)
        fix = np.diag([1.0, 1.0, np.sign(np.linalg.det(u @ vt))])
        return u @ fix @ vt

    mapping = kabsch(A, B)
    for _ in range(3):
        err = np.degrees(np.arccos(np.clip(np.sum((A @ mapping.T) * B, axis=1), -1, 1)))
        keep = err < np.percentile(err, 75) + 5
        if int(keep.sum()) >= 3:
            mapping = kabsch(A[keep], B[keep])
    err = np.degrees(np.arccos(np.clip(np.sum((A @ mapping.T) * B, axis=1), -1, 1)))
    elev_sfm = np.degrees(np.arcsin(np.clip((A @ mapping.T)[:, 2], -1, 1)))
    elev_phone = np.degrees(np.arcsin(np.clip(B[:, 2], -1, 1)))
    up = mapping.T @ np.array([0.0, 0.0, 1.0])
    result.update(
        {
            "medianDirErrDeg": float(np.median(err)),
            "medianElevErrDeg": float(np.median(np.abs(elev_sfm - elev_phone))),
            "upColmap": up.tolist(),
            "perImage": {
                name: {"dirErrDeg": round(float(e), 1), "elevSfm": round(float(a), 1), "elevPhone": round(float(b), 1)}
                for name, e, a, b in zip(names, err, elev_sfm, elev_phone)
            },
        }
    )
    return result


def image_up_prior(sparse_dir: str):
    """Mean camera 'up' when the phone compass/gravity is missing. COLMAP Y points down."""
    import pycolmap

    rec = pycolmap.Reconstruction(sparse_dir)
    rows = []
    for image in rec.images.values():
        if not image.has_pose():
            continue
        rotation = np.asarray(image.cam_from_world().rotation.matrix(), float)
        rows.append(-rotation[1, :])
    if not rows:
        return None
    up = np.mean(rows, axis=0)
    nrm = np.linalg.norm(up)
    return None if nrm < 1e-8 else (up / nrm)
