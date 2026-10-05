"""Download a survey, reconstruct it, upload the CAD and mesh files."""

from __future__ import annotations

import json
import os
import shutil
import time
import traceback

from . import export_mesh, openmvs, prep, r2, room, scale, sfm, walls
from .options import Options
from .previews import write_previews
from .status import StatusWriter


class PipelineError(RuntimeError):
    def __init__(self, stage: str, message: str):
        super().__init__(message)
        self.stage = stage


def run_job(project_id: str, options: Options, work_root: str, hook=None, upload: bool = True) -> dict:
    project_id = r2.validate_project_id(project_id) if upload or not options.local_project_dir else (project_id or "locale").strip()
    if upload:
        project_id = r2.validate_project_id(project_id)
    work = os.path.join(work_root, project_id)
    if os.path.isdir(work):
        shutil.rmtree(work)
    out_dir = os.path.join(work, "out")
    os.makedirs(out_dir, exist_ok=True)
    status = StatusWriter(project_id, os.path.join(out_dir, "status.json"), hook=hook)
    timings: dict[str, float] = {}
    stage = "avvio"
    try:
        stage = "download"
        status.update(stage, 2, "Scarico foto e project.json", timings)
        with _timed(timings, "download"):
            project, photo_paths = _acquire(project_id, options, work)
        _check_id(project, project_id, options)
        stage = "prep"
        status.update(stage, 8, "Preparo le immagini, senza ruotare l'EXIF", timings)
        with _timed(timings, "prep"):
            prepared = prep.prepare_images(project, photo_paths, work, options.downscale)
        device, why = sfm.resolve_device(options.device)
        print(f"[device] {device} ({why})", flush=True)
        stage = "features"

        def _sfm_stage(name, message, _progress={"features": 12, "match": 30, "map": 42}):
            nonlocal stage
            stage = name
            status.update(name, _progress.get(name, 20), message, timings)

        t0 = time.perf_counter()
        sfm_info = sfm.run_sfm(
            work,
            prepared["rows"],
            device,
            options.max_features,
            options.seeds,
            options.thread_count(),
            log=lambda msg: print(f"[sfm] {msg}", flush=True),
            on_stage=_sfm_stage,
        )
        timings["sfm"] = time.perf_counter() - t0
        status.update("map", 50, f"Registrate {sfm_info['registered']}/{sfm_info['total']} foto", timings)
        stage = "pose"
        pose = sfm.pose_check(project, sfm_info["sparse"], prepared["rows"])
        weak = _weak_images(sfm_info["sparse"], pose)
        dense_dir = os.path.join(work, "sparse_dense")
        kept = sfm.write_dense_subset(sfm_info["sparse"], dense_dir, weak, log=lambda msg: print(f"[sfm] {msg}", flush=True))
        sfm_info["sparseDense"] = dense_dir
        sfm_info["denseImages"] = kept
        stage = "scale"
        status.update(stage, 58, "Triangolo i punti e calcolo la scala", timings)
        with _timed(timings, "scale"):
            import pycolmap

            rows = {row["photoId"]: row for row in prepared["rows"]}
            reconstruction = pycolmap.Reconstruction(sfm_info["sparse"])
            ray_fn = scale.rays_from_reconstruction(reconstruction, rows)
            located, point_report = scale.triangulate_project(project, ray_fn)
            report = scale.scale_report(project, located, ray_fn=ray_fn, monte_carlo=options.monte_carlo)
            report["points"] = point_report
            if options.mm_per_unit:
                report["mm_per_unit_from_measurements"] = report["mm_per_unit"]
                report["mm_per_unit"] = float(options.mm_per_unit)
                report["scale_source"] = "options.mmPerUnit"
            else:
                report["scale_source"] = "quote dell'app"
        mm_per_unit = float(report["mm_per_unit"])
        _write_json(os.path.join(out_dir, "scale_report.json"), report)
        with open(os.path.join(out_dir, "scale_report.md"), "w", encoding="utf-8") as handle:
            handle.write(scale.render_markdown(report))
        mvs_dir = None
        if options.skip_dense:
            print("[pipeline] skipDense: mi fermo dopo la scala", flush=True)
        else:
            stage = "dense"
            status.update(stage, 64, "Nuvola densa, mesh e texture", timings)
            with _timed(timings, "mvs"):
                mvs_dir = openmvs.reconstruct(
                    work,
                    options.thread_count(),
                    options.resolution_level,
                    use_cuda=(device == "cuda"),
                    log=lambda msg: print(f"[mvs] {msg}", flush=True),
                )
            stage = "planes"
            status.update(stage, 90, "Riconosco pavimento, soffitto e pareti", timings)
            with _timed(timings, "planes"):
                points, normals = _load_cloud(os.path.join(mvs_dir, "scene_dense.ply"), mm_per_unit)
                cameras = _camera_centres(dense_dir)
                up = pose.get("upColmap") or sfm.image_up_prior(sfm_info["sparse"])
                model_room = room.detect_room(
                    points,
                    normals,
                    cameras=cameras,
                    mm_per_unit=mm_per_unit,
                    overrides=options.room_overrides,
                    up_prior=up,
                )
                if options.openings_mm:
                    model_room = room.apply_openings_mm(model_room, options.openings_mm, mm_per_unit)
                model_room["mm_per_unit"] = mm_per_unit
            _write_json(os.path.join(work, "room_model.json"), model_room)
            stage = "export"
            status.update(stage, 94, "Esporto STEP, GLB e OBJ", timings)
            with _timed(timings, "export"):
                export_mesh.export_textured(model_room, mvs_dir, out_dir, mm_per_unit)
                walls.export_step(
                    model_room,
                    os.path.join(out_dir, "walls.step"),
                    mm_per_unit,
                    options.wall_thickness_mm,
                    options.floor_slab_mm,
                    options.ceiling_slab_mm,
                    options.cut_openings,
                )
                room_mm = room.to_millimetres(model_room, mm_per_unit)
                room_mm["scale"] = {
                    "mmPerUnit": mm_per_unit,
                    "rmsResidMm": report["rms_resid_mm"],
                    "maxAbsResidMm": report["max_abs_resid_mm"],
                    "source": report["scale_source"],
                }
                _write_json(os.path.join(out_dir, "room.json"), room_mm)
                write_previews(out_dir, room_mm)
        diagnostic = _diagnostic(project_id, prepared, sfm_info, pose, report, timings, device, why, options)
        if mvs_dir and os.path.isfile(os.path.join(out_dir, "room.json")):
            with open(os.path.join(out_dir, "room.json"), encoding="utf-8") as handle:
                diagnostic["room"] = json.load(handle)["dims"]
            with open(os.path.join(work, "room_model.json"), encoding="utf-8") as handle:
                detection = json.load(handle)["detection"]
            diagnostic["wallNotes"] = detection["walls"]
            diagnostic["floorMethod"] = detection.get("floorMethod")
            diagnostic["ceilingMethod"] = detection.get("ceilingMethod")
        _write_json(os.path.join(out_dir, "diagnostic.json"), diagnostic)
        outputs = _output_keys(project_id, out_dir) if upload else {name: name for name in _present(out_dir)}
        if upload:
            stage = "upload"
            status.update(stage, 98, "Carico i risultati su R2", timings)
            with _timed(timings, "upload"):
                outputs = _upload(project_id, out_dir)
        summary = _summary(project_id, sfm_info, report, out_dir, outputs, timings)
        status.finish(
            f"Completato: {sfm_info['registered']}/{sfm_info['total']} foto, RMS scala {report['rms_resid_mm']:.1f} mm",
            timings,
        )
        if upload:
            _upload_status(project_id, out_dir)
        summary["status"] = r2.result_key(project_id, "status.json") if upload else os.path.join(out_dir, "status.json")
        return summary
    except Exception as exc:
        text = str(exc).strip()
        message = f"{exc.__class__.__name__}: {text}" if text else exc.__class__.__name__
        print(f"[pipeline] errore in {stage}: {message}", flush=True)
        traceback.print_exc()
        status.fail(message, stage=stage)
        if upload and r2.configured():
            try:
                _upload_status(project_id, out_dir)
            except Exception as upload_error:
                print(f"[pipeline] status.json non caricato: {upload_error}", flush=True)
        if isinstance(exc, PipelineError):
            raise
        raise PipelineError(stage, message) from exc


def _acquire(project_id: str, options: Options, work: str):
    if options.local_project_dir:
        return _load_local(options.local_project_dir, work)
    cfg = r2.read_config()
    client = r2.client_for(cfg)
    manifest = os.path.join(work, "project.json")
    try:
        r2.download_file(client, cfg.bucket, r2.manifest_key(project_id), manifest)
    except Exception as exc:
        raise PipelineError("download", f"project.json non scaricabile: {exc}") from exc
    with open(manifest, encoding="utf-8") as handle:
        project = json.load(handle)
    prefix = f"rilievi/{project_id}/foto/"
    present = set(r2.list_prefix(client, cfg.bucket, prefix))
    photo_dir = os.path.join(work, "foto")
    os.makedirs(photo_dir, exist_ok=True)
    mapping = {}
    missing = []
    for photo in project.get("photos") or []:
        if not photo.get("accepted", True):
            continue
        key = photo.get("r2Key") or r2.photo_key(project_id, int(photo.get("sequence") or 0), photo["id"])
        if not str(key).startswith(f"rilievi/{project_id}/"):
            raise PipelineError("download", f"Chiave fuori dal rilievo: {key}")
        if key not in present:
            missing.append(key)
            continue
        dest = os.path.join(photo_dir, os.path.basename(key))
        r2.download_file(client, cfg.bucket, key, dest)
        mapping[photo["id"]] = dest
    if missing and not options.allow_missing:
        raise PipelineError("download", "Foto mancanti su R2: " + ", ".join(missing[:8]))
    if not mapping:
        raise PipelineError("download", "Nessuna foto accettata nel bucket.")
    return project, mapping


def _load_local(project_dir: str, work: str):
    manifest = os.path.join(project_dir, "project.json")
    if not os.path.isfile(manifest):
        raise PipelineError("download", f"Manca {manifest}")
    with open(manifest, encoding="utf-8") as handle:
        project = json.load(handle)
    shutil.copy(manifest, os.path.join(work, "project.json"))
    mapping = {}
    missing = []
    for photo in project.get("photos") or []:
        if not photo.get("accepted", True):
            continue
        found = _find_local_photo(project_dir, photo)
        if found:
            mapping[photo["id"]] = found
        else:
            missing.append(photo.get("id"))
    if missing:
        raise PipelineError("download", "Foto locali mancanti: " + ", ".join(str(m) for m in missing[:8]))
    return project, mapping


def _find_local_photo(project_dir: str, photo: dict):
    seq = int(photo.get("sequence") or 0)
    names = []
    if photo.get("file"):
        names.append(photo["file"])
    if photo.get("r2Key"):
        base = os.path.basename(photo["r2Key"])
        names.extend([base, os.path.join("foto", base)])
    names.append(os.path.join("foto", f"{seq:03d}.jpg"))
    names.append(os.path.join("foto", f"{seq:03d}-{photo['id']}.jpg"))
    for name in names:
        path = name if os.path.isabs(name) else os.path.join(project_dir, name)
        if os.path.isfile(path):
            return path
    return None


def _check_id(project, project_id: str, options: Options):
    embedded = ((project.get("project") or {}).get("id")) or project.get("id")
    if options.local_project_dir:
        return
    if embedded and str(embedded).lower() != project_id.lower():
        raise PipelineError("download", f"project.json è del rilievo {embedded}, non {project_id}.")


def _weak_images(sparse_dir: str, pose: dict) -> set[str]:
    import pycolmap

    rec = pycolmap.Reconstruction(sparse_dir)
    counts = {image.name: image.num_points3D for image in rec.images.values() if image.has_pose}
    weak = {name for name, count in counts.items() if count < 15}
    for name, info in (pose.get("perImage") or {}).items():
        elev = abs(float(info["elevSfm"]) - float(info["elevPhone"]))
        if counts.get(name, 0) < 40 and elev > 8:
            weak.add(name)
    return weak


def _camera_centres(sparse_dir: str):
    import numpy as np
    import pycolmap

    rec = pycolmap.Reconstruction(sparse_dir)
    centres = [np.asarray(image.projection_center(), float) for image in rec.images.values() if image.has_pose]
    if not centres:
        raise PipelineError("planes", "Nessuna foto registrata per orientare le normali.")
    return np.vstack(centres)


def _load_cloud(path: str, mm_per_unit: float):
    import numpy as np
    import open3d as o3d

    cloud = o3d.io.read_point_cloud(path)
    if len(cloud.points) < 500:
        raise PipelineError("planes", "La nuvola densa è troppo povera.")
    voxel = max(15.0 / mm_per_unit, 1e-4)
    down = cloud.voxel_down_sample(voxel)
    down, _ = down.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
    down.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=voxel * 8, max_nn=40))
    return np.asarray(down.points), np.asarray(down.normals)


def _diagnostic(project_id, prepared, sfm_info, pose, report, timings, device, why, options: Options):
    public_pose = {k: v for k, v in pose.items() if k != "perImage"}
    public_pose["worst"] = sorted((pose.get("perImage") or {}).items(), key=lambda kv: kv[1]["dirErrDeg"], reverse=True)[:8]
    return {
        "projectId": project_id,
        "device": device,
        "deviceReason": why,
        "downscale": options.downscale,
        "prepWarnings": prepared["warnings"],
        "images": len(prepared["rows"]),
        "sfm": {k: v for k, v in sfm_info.items() if k not in ("sparse", "sparseDense")},
        "pose": public_pose,
        "scale": {
            "mmPerUnit": report["mm_per_unit"],
            "rmsResidMm": report["rms_resid_mm"],
            "maxAbsResidMm": report["max_abs_resid_mm"],
            "nUsed": report["n_used"],
            "source": report["scale_source"],
        },
        "overrides": options.room_overrides,
        "timingsSec": {k: round(v, 2) for k, v in timings.items()},
    }


def _summary(project_id, sfm_info, report, out_dir, outputs, timings):
    room_path = os.path.join(out_dir, "room.json")
    dims = None
    if os.path.isfile(room_path):
        dims = json.load(open(room_path, encoding="utf-8"))["dims"]
    return {
        "ok": True,
        "projectId": project_id,
        "registeredImages": sfm_info["registered"],
        "totalImages": sfm_info["total"],
        "meanReprojPx": sfm_info["reprojPx"],
        "missingImages": sfm_info["missing"],
        "scale": {
            "mmPerUnit": report["mm_per_unit"],
            "rmsResidMm": report["rms_resid_mm"],
            "maxAbsResidMm": report["max_abs_resid_mm"],
            "measurementsUsed": report["n_used"],
        },
        "room": dims,
        "outputs": outputs,
        "timingsSec": {k: round(v, 2) for k, v in timings.items()},
    }


def _present(out_dir: str) -> list[str]:
    names = []
    for filename in sorted(os.listdir(out_dir)):
        if filename.startswith("preview_") or filename in {
            "walls.step",
            "room_textured.glb",
            "room_textured_obj.zip",
            "room_dense.ply",
            "scale_report.json",
            "scale_report.md",
            "diagnostic.json",
            "room.json",
            "status.json",
        }:
            names.append(filename)
    return names


def _output_keys(project_id: str, out_dir: str) -> dict:
    return {name: r2.result_key(project_id, name) for name in _present(out_dir)}


def _upload(project_id: str, out_dir: str) -> dict:
    cfg = r2.read_config()
    client = r2.client_for(cfg)
    uploaded = {}
    for name in _present(out_dir):
        if name == "status.json":
            continue
        path = os.path.join(out_dir, name)
        key = r2.result_key(project_id, name)
        r2.upload_file(client, cfg.bucket, key, path, r2.content_type_for(name))
        uploaded[name] = key
        print(f"[r2] {key}", flush=True)
    return uploaded


def _upload_status(project_id: str, out_dir: str):
    cfg = r2.read_config()
    client = r2.client_for(cfg)
    path = os.path.join(out_dir, "status.json")
    r2.upload_file(client, cfg.bucket, r2.result_key(project_id, "status.json"), path, "application/json")


def _write_json(path: str, payload: dict):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


class _timed:
    def __init__(self, store: dict, key: str):
        self.store = store
        self.key = key
        self.t0 = 0.0

    def __enter__(self):
        self.t0 = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc, tb):
        self.store[self.key] = time.perf_counter() - self.t0
        return False
