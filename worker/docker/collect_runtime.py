#!/usr/bin/env python3
"""Copy the worker binaries and the shared libraries they actually load.

Skips glibc, libstdc++ and libcuda (the host driver provides libcuda).
Everything else, including libcudart when it is not already on the runtime
image path we keep, is copied under /opt/export.
"""

from __future__ import annotations

import os
import shutil
import subprocess

EXPORT = "/opt/export"
BIN_NAMES = (
    "colmap",
    "InterfaceCOLMAP",
    "DensifyPointCloud",
    "ReconstructMesh",
    "TextureMesh",
)
SKIP_BASENAMES = {
    "libc.so.6",
    "libm.so.6",
    "libdl.so.2",
    "libpthread.so.0",
    "librt.so.1",
    "libresolv.so.2",
    "libutil.so.1",
    "libgcc_s.so.1",
    "libstdc++.so.6",
}


def skip(path: str) -> bool:
    base = os.path.basename(path)
    if base in SKIP_BASENAMES or base.startswith("ld-linux"):
        return True
    if base.startswith(("libnss", "libnsl", "libcuda.so", "libnvidia")):
        return True
    return False


def interesting(path: str) -> bool:
    name = os.path.basename(path)
    if not os.path.isfile(path):
        return False
    if os.access(path, os.X_OK):
        return True
    return ".so" in name


def ldd_paths(path: str) -> list[str]:
    try:
        out = subprocess.check_output(["ldd", path], text=True, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.CalledProcessError):
        return []
    found = []
    for line in out.splitlines():
        if "=>" not in line:
            continue
        parts = line.split()
        if "=>" not in parts:
            continue
        lib = parts[parts.index("=>") + 1]
        if lib.startswith("/") and not skip(lib):
            found.append(lib)
    return found


def copy_file(src: str, dest_dir: str) -> str:
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, os.path.basename(src))
    if not os.path.exists(dest):
        shutil.copy2(src, dest)
    return dest


def main() -> None:
    bin_dir = os.path.join(EXPORT, "bin")
    lib_dir = os.path.join(EXPORT, "lib")
    os.makedirs(bin_dir, exist_ok=True)
    os.makedirs(lib_dir, exist_ok=True)
    for name in BIN_NAMES:
        src = f"/usr/local/bin/{name}"
        if not os.path.isfile(src):
            raise SystemExit(f"manca {src}")
        shutil.copy2(src, os.path.join(bin_dir, name))
        os.chmod(os.path.join(bin_dir, name), 0o755)

    py_src = "/opt/build-venv/lib/python3.12/site-packages/pycolmap"
    if not os.path.isdir(py_src):
        raise SystemExit(f"manca {py_src}")
    py_dest = os.path.join(EXPORT, "pycolmap")
    shutil.rmtree(py_dest, ignore_errors=True)
    shutil.copytree(py_src, py_dest)

    seeds = []
    for root, _dirs, files in os.walk(EXPORT):
        for filename in files:
            path = os.path.join(root, filename)
            if interesting(path):
                seeds.append(path)

    seen: set[str] = set()
    queue = list(seeds)
    while queue:
        path = queue.pop()
        real = os.path.realpath(path)
        if real in seen:
            continue
        seen.add(real)
        for lib in ldd_paths(real):
            copied = copy_file(lib, lib_dir)
            queue.append(copied)
            queue.append(lib)

    for root, _dirs, files in os.walk(EXPORT):
        for filename in files:
            path = os.path.join(root, filename)
            if not interesting(path):
                continue
            subprocess.run(["strip", "--strip-unneeded", path], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"runtime bins={len(os.listdir(bin_dir))} libs={len(os.listdir(lib_dir))}")


if __name__ == "__main__":
    main()
