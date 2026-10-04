"""OpenMVS dense cloud, mesh and texture. CUDA PatchMatch when the binary was built with it.

OpenMVS is AGPL-3.0 and is invoked as a separate program, not linked into the Python worker.
"""

from __future__ import annotations

import os
import shutil
import subprocess


class MvsError(RuntimeError):
    pass


BINARIES = ("InterfaceCOLMAP", "DensifyPointCloud", "ReconstructMesh", "TextureMesh")


def find_binary(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    for folder in ("/usr/local/bin", "/opt/openmvs/bin", "/opt/runtime/bin"):
        path = os.path.join(folder, name)
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    raise MvsError(f"Manca il programma OpenMVS `{name}` nel PATH.")


def _help_text(binary: str) -> str:
    try:
        out = subprocess.run([binary, "--help"], check=False, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        return ""
    return (out.stdout or "") + (out.stderr or "")


def _run(cmd: list[str], log_path: str):
    os.makedirs(os.path.dirname(log_path) or ".", exist_ok=True)
    with open(log_path, "w", encoding="utf-8") as handle:
        proc = subprocess.run(cmd, stdout=handle, stderr=subprocess.STDOUT, check=False)
    if proc.returncode != 0:
        tail = ""
        try:
            with open(log_path, encoding="utf-8", errors="replace") as handle:
                lines = handle.readlines()
            tail = "".join(lines[-40:])
        except OSError:
            pass
        raise MvsError(f"Comando fallito ({proc.returncode}): {' '.join(cmd[:4])}\n{tail}")


def undistort(work_dir: str, threads: int):
    import pycolmap

    dense = os.path.join(work_dir, "dense")
    shutil.rmtree(dense, ignore_errors=True)
    os.makedirs(dense, exist_ok=True)
    pycolmap.undistort_images(
        dense,
        os.path.join(work_dir, "sparse_dense"),
        os.path.join(work_dir, "images"),
        output_type="COLMAP",
        num_threads=threads,
    )
    sparse = os.path.join(dense, "sparse")
    rec = pycolmap.Reconstruction(sparse)
    rec.write_text(sparse)
    return dense


def reconstruct(work_dir: str, threads: int, resolution_level: int, use_cuda: bool, log=print) -> str:
    dense = undistort(work_dir, threads)
    mvs = os.path.join(work_dir, "mvs")
    os.makedirs(mvs, exist_ok=True)
    interface = find_binary("InterfaceCOLMAP")
    densify = find_binary("DensifyPointCloud")
    mesh = find_binary("ReconstructMesh")
    texture = find_binary("TextureMesh")
    scene = os.path.join(mvs, "scene.mvs")
    dense_mvs = os.path.join(mvs, "scene_dense.mvs")
    mesh_mvs = os.path.join(mvs, "scene_mesh.mvs")
    mesh_ply = os.path.join(mvs, "scene_mesh.ply")
    textured = os.path.join(mvs, "scene_textured.mvs")
    _run(
        [interface, "-i", dense, "-o", scene, "--image-folder", os.path.join(dense, "images"), "-w", mvs],
        os.path.join(mvs, "log_interface.txt"),
    )
    densify_cmd = [
        densify,
        "-i",
        scene,
        "-o",
        dense_mvs,
        "-w",
        mvs,
        "--resolution-level",
        str(int(resolution_level)),
        "--max-threads",
        str(threads),
        "--number-views-fuse",
        "2",
        "--estimate-roi",
        "0",
    ]
    cuda_flag = _cuda_flag(densify, use_cuda)
    if cuda_flag:
        densify_cmd.extend(cuda_flag)
        log("DensifyPointCloud con CUDA")
    else:
        log("DensifyPointCloud in CPU")
    _run(densify_cmd, os.path.join(mvs, "log_densify.txt"))
    _run(
        [mesh, "-i", dense_mvs, "-o", mesh_mvs, "-w", mvs, "--max-threads", str(threads)],
        os.path.join(mvs, "log_mesh.txt"),
    )
    # ReconstructMesh writes scene_mesh.ply next to the mvs, sometimes only inside the archive.
    if not os.path.isfile(mesh_ply):
        alt = os.path.join(mvs, "scene_mesh.ply")
        if not os.path.isfile(alt):
            raise MvsError("ReconstructMesh non ha scritto scene_mesh.ply.")
    _run(
        [
            texture,
            "-i",
            dense_mvs,
            "-m",
            mesh_ply,
            "-o",
            textured,
            "-w",
            mvs,
            "--max-threads",
            str(threads),
            "--export-type",
            "ply",
            "--decimate",
            "0.5",
            "--empty-color",
            "12632256",
        ],
        os.path.join(mvs, "log_tex.txt"),
    )
    ply = os.path.join(mvs, "scene_textured.ply")
    cloud = os.path.join(mvs, "scene_dense.ply")
    if not os.path.isfile(ply):
        raise MvsError("TextureMesh non ha scritto scene_textured.ply.")
    if not os.path.isfile(cloud):
        raise MvsError("DensifyPointCloud non ha scritto scene_dense.ply.")
    return mvs


def _cuda_flag(binary: str, use_cuda: bool):
    text = _help_text(binary)
    if "--cuda-device" not in text:
        return None
    # OpenMVS: -2 auto, -1 CPU, >=0 device index.
    return ["--cuda-device", "0" if use_cuda else "-1"]
