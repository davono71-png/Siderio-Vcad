# syntax=docker/dockerfile:1
#
# Immagine RunPod del worker Siderio Vcad.
#
# Contesto di build: radice del repository (non la cartella worker/).
# Percorso Dockerfile: worker/Dockerfile
#
#   docker build -f worker/Dockerfile -t siderio-vcad-worker .
#
# Su questa macchina, con poca RAM, limita i job di compilazione:
#   docker build --build-arg BUILD_JOBS=2 -f worker/Dockerfile -t siderio-vcad-worker .
#
# CUDA 12.8 è l'ultima linea che compila ancora Pascal (sm_61, Quadro P4000)
# insieme ad Ada (sm_89, RTX 4090). Le wheel ufficiali pycolmap-cuda12 portano
# solo cubin sm_90/100/120 e non partono su quelle GPU: COLMAP si compila qui.
# OpenMVS è AGPL-3.0 ed entra nell'immagine solo come eseguibile separato.

ARG CUDA_DEVEL=nvidia/cuda:12.8.1-devel-ubuntu24.04
ARG CUDA_RUNTIME=nvidia/cuda:12.8.1-runtime-ubuntu24.04
ARG COLMAP_VERSION=4.2.1
ARG OPENMVS_VERSION=2.4.0
ARG CGAL_VERSION=6.0.1
ARG VCG_COMMIT=658ba36d0a5666650da6e066b4794efc5a463407
ARG CUDA_ARCHITECTURES=61,89
ARG BUILD_JOBS=4

FROM ${CUDA_DEVEL} AS builder

ARG COLMAP_VERSION
ARG OPENMVS_VERSION
ARG CGAL_VERSION
ARG VCG_COMMIT
ARG CUDA_ARCHITECTURES
ARG BUILD_JOBS

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        ccache \
        cmake \
        curl \
        git \
        libboost-filesystem-dev \
        libboost-graph-dev \
        libboost-iostreams-dev \
        libboost-program-options-dev \
        libboost-serialization-dev \
        libboost-system-dev \
        libboost-thread-dev \
        libceres-dev \
        libcurl4-openssl-dev \
        libeigen3-dev \
        libgflags-dev \
        libglew-dev \
        libgmp-dev \
        libgoogle-glog-dev \
        libjpeg-dev \
        libmetis-dev \
        libmpfr-dev \
        libopencv-dev \
        libopenblas-dev \
        libopenimageio-dev \
        openimageio-tools \
        libpng-dev \
        libsqlite3-dev \
        libssl-dev \
        libtiff-dev \
        ninja-build \
        pkg-config \
        python3 \
        python3-dev \
        python3-pip \
        python3-venv \
        zlib1g-dev \
    && mkdir -p /usr/include/opencv4 \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/build-venv \
    && /opt/build-venv/bin/pip install --upgrade pip==26.1.2 \
    && /opt/build-venv/bin/pip install --no-cache-dir \
        numpy==2.2.6 \
        pybind11==3.0.4 \
        scikit-build-core==0.11.6

# Il punto e virgola di CMake non sopravvive a una shell non quotata: l'ARG
# entra come elenco separato da virgole (61,89) e qui diventa 61;89.
# Le tappe sono separate così un errore su OpenMVS non ricompila COLMAP.
RUN arch="$(printf '%s' "${CUDA_ARCHITECTURES}" | tr ',' ';')" \
    && test -n "$arch" \
    && printf '%s\n' "$arch" > /tmp/cuda-arch.txt \
    && echo "CUDA architectures: $arch" \
    && mkdir -p /src \
    && curl -fsSL "https://github.com/CGAL/cgal/archive/refs/tags/v${CGAL_VERSION}.tar.gz" | tar -xz -C /src \
    && cmake -S "/src/cgal-${CGAL_VERSION}" -B /tmp/cgal-build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/usr/local \
    && cmake --build /tmp/cgal-build --target install \
    && rm -rf /tmp/cgal-build "/src/cgal-${CGAL_VERSION}"

RUN arch="$(cat /tmp/cuda-arch.txt)" \
    && curl -fsSL "https://github.com/colmap/colmap/archive/refs/tags/${COLMAP_VERSION}.tar.gz" | tar -xz -C /src \
    && cmake -S "/src/colmap-${COLMAP_VERSION}" -B /tmp/colmap-build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/usr/local \
        -DCMAKE_CUDA_ARCHITECTURES="${arch}" \
        -DCUDA_ENABLED=ON \
        -DMVS_ENABLED=ON \
        -DGUI_ENABLED=OFF \
        -DOPENGL_ENABLED=OFF \
        -DCGAL_ENABLED=OFF \
        -DONNX_ENABLED=OFF \
        -DLSD_ENABLED=OFF \
        -DTESTS_ENABLED=OFF \
        -DIPO_ENABLED=OFF \
        -DCCACHE_ENABLED=OFF \
        -DBLA_VENDOR=OpenBLAS \
        -DBUILD_SHARED_LIBS=OFF \
    && cmake --build /tmp/colmap-build -j "${BUILD_JOBS}" \
    && cmake --install /tmp/colmap-build \
    && rm -rf /tmp/colmap-build \
    && test -x /usr/local/bin/colmap

RUN CMAKE_PREFIX_PATH=/usr/local CMAKE_ARGS="-DGENERATE_STUBS=OFF -DCMAKE_PREFIX_PATH=/usr/local -DCCACHE_ENABLED=OFF" \
        /opt/build-venv/bin/pip install --no-build-isolation --no-deps --no-cache-dir "/src/colmap-${COLMAP_VERSION}" \
    && rm -rf "/src/colmap-${COLMAP_VERSION}" \
    && test -d /opt/build-venv/lib/python3.12/site-packages/pycolmap

RUN arch="$(cat /tmp/cuda-arch.txt)" \
    && curl -fsSL "https://github.com/cdcseacave/VCG/archive/${VCG_COMMIT}.tar.gz" | tar -xz -C /src \
    && curl -fsSL "https://github.com/cdcseacave/openMVS/archive/refs/tags/v${OPENMVS_VERSION}.tar.gz" | tar -xz -C /src \
    && cmake -S "/src/openMVS-${OPENMVS_VERSION}" -B /tmp/openmvs-build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/usr/local \
        -DCMAKE_CUDA_ARCHITECTURES="${arch}" \
        -DOpenMVS_USE_CUDA=ON \
        -DOpenMVS_BUILD_VIEWER=OFF \
        -DOpenMVS_USE_PYTHON=OFF \
        -DOpenMVS_USE_BREAKPAD=OFF \
        -DOpenMVS_ENABLE_TESTS=OFF \
        -DOpenMVS_ENABLE_IPO=OFF \
        -DVCG_ROOT="/src/VCG-${VCG_COMMIT}" \
        -DEIGEN3_INCLUDE_DIR=/usr/include/eigen3 \
        -DCUDA_TOOLKIT_ROOT_DIR=/usr/local/cuda \
    && cmake --build /tmp/openmvs-build -j "${BUILD_JOBS}" \
    && cmake --install /tmp/openmvs-build \
    && rm -rf /tmp/openmvs-build "/src/openMVS-${OPENMVS_VERSION}" "/src/VCG-${VCG_COMMIT}" \
    && test -x /usr/local/bin/DensifyPointCloud

COPY worker/docker/collect_runtime.py /tmp/collect_runtime.py
RUN python3 /tmp/collect_runtime.py && rm /tmp/collect_runtime.py

FROM ${CUDA_RUNTIME} AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SIDERIO_CUDA_SMS=61,89 \
    SIDERIO_WORK_ROOT=/tmp/siderio \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        python3 \
        python3-pip \
        python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip==26.1.2

COPY worker/requirements.txt /tmp/requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

COPY --from=builder /opt/export/bin /opt/runtime/bin
COPY --from=builder /opt/export/lib /opt/runtime/lib
COPY --from=builder /opt/export/pycolmap /opt/venv/lib/python3.12/site-packages/pycolmap

ENV PATH="/opt/venv/bin:/opt/runtime/bin:${PATH}" \
    LD_LIBRARY_PATH="/opt/runtime/lib:${LD_LIBRARY_PATH}"

WORKDIR /opt/siderio
COPY worker/handler.py worker/test_local.py worker/smoke_test.py /opt/siderio/
COPY worker/siderio_worker /opt/siderio/siderio_worker

CMD ["python", "-u", "/opt/siderio/handler.py"]
