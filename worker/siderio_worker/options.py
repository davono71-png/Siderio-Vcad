"""Job options. The RunPod input is ``{"projectId", "options"}``."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Options:
    downscale: int = 2
    device: str = "auto"  # auto | cuda | cpu
    max_features: int = 12000
    seeds: int = 4
    threads: int | None = None
    wall_thickness_mm: float = 150.0
    floor_slab_mm: float = 150.0
    ceiling_slab_mm: float = 150.0
    # Aligned frame, before the origin shift, in model units. Same keys as
    # worker/prototipo/room_config.json: xmin, xmax, ymin, ymax, floor, ceiling.
    room_overrides: dict = field(default_factory=dict)
    # Door/window boxes in millimetres in the final room frame (Z up, origin
    # at the xmin/ymin corner). Replaces the automatic openings.
    openings_mm: list = field(default_factory=list)
    mm_per_unit: float | None = None
    resolution_level: int = 1
    cut_openings: str = "doors"  # doors | all | none
    monte_carlo: int = 40
    skip_dense: bool = False
    allow_missing: bool = False
    local_project_dir: str | None = None
    # None means "read project.json". stanza is a room; facciata is a wall
    # with the objects in front of it, and does not need a floor or a ceiling.
    mode: str | None = None
    # pareti keeps today's walls. completa also exports every surface and the
    # leftover objects. Missing means "read project.json, otherwise pareti".
    geometry: str = "pareti"
    geometry_explicit: bool = False

    def thread_count(self) -> int:
        import os

        n = self.threads or os.cpu_count() or 4
        return max(1, min(int(n), 16))


def parse_options(raw) -> Options:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ValueError("options deve essere un oggetto JSON.")
    opt = Options()
    opt.downscale = _int(raw, "downscale", opt.downscale, minimum=1, maximum=8)
    device = str(raw.get("device", opt.device) or opt.device).strip().lower()
    if device not in ("auto", "cuda", "cpu"):
        raise ValueError("options.device deve essere auto, cuda o cpu.")
    opt.device = device
    opt.max_features = _int(raw, "maxFeatures", opt.max_features, alt="max_features", minimum=2000, maximum=40000)
    opt.seeds = _int(raw, "seeds", opt.seeds, minimum=1, maximum=8)
    if raw.get("threads") not in (None, ""):
        opt.threads = _int(raw, "threads", 4, minimum=1, maximum=32)
    opt.wall_thickness_mm = _float(raw, "wallThicknessMm", opt.wall_thickness_mm, alt="wall_thickness_mm")
    opt.floor_slab_mm = _float(raw, "floorSlabMm", opt.floor_slab_mm, alt="floor_slab_mm")
    opt.ceiling_slab_mm = _float(raw, "ceilingSlabMm", opt.ceiling_slab_mm, alt="ceiling_slab_mm")
    overrides = raw.get("roomOverrides", raw.get("room_overrides", {})) or {}
    if not isinstance(overrides, dict):
        raise ValueError("options.roomOverrides deve essere un oggetto.")
    cleaned = {}
    for key in ("xmin", "xmax", "ymin", "ymax", "floor", "ceiling"):
        if key in overrides and overrides[key] is not None:
            cleaned[key] = float(overrides[key])
    opt.room_overrides = cleaned
    openings = raw.get("openingsMm", raw.get("openings_mm", [])) or []
    if not isinstance(openings, list):
        raise ValueError("options.openingsMm deve essere una lista.")
    opt.openings_mm = openings
    if raw.get("mmPerUnit", raw.get("mm_per_unit")) not in (None, ""):
        opt.mm_per_unit = float(raw.get("mmPerUnit", raw.get("mm_per_unit")))
    opt.resolution_level = _int(raw, "resolutionLevel", opt.resolution_level, alt="resolution_level", minimum=0, maximum=4)
    cut = str(raw.get("cutOpenings", raw.get("cut_openings", opt.cut_openings)) or opt.cut_openings).lower()
    if cut not in ("doors", "all", "none"):
        raise ValueError("options.cutOpenings deve essere doors, all o none.")
    opt.cut_openings = cut
    opt.monte_carlo = _int(raw, "monteCarlo", opt.monte_carlo, alt="monte_carlo", minimum=0, maximum=400)
    opt.skip_dense = bool(raw.get("skipDense", raw.get("skip_dense", False)))
    opt.allow_missing = bool(raw.get("allowMissing", raw.get("allow_missing", False)))
    local = raw.get("localProjectDir", raw.get("local_project_dir"))
    opt.local_project_dir = str(local) if local else None
    if raw.get("mode") not in (None, ""):
        mode = str(raw.get("mode")).strip().lower()
        if mode not in ("stanza", "facciata"):
            raise ValueError("options.mode deve essere stanza o facciata.")
        opt.mode = mode
    if raw.get("geometry") not in (None, ""):
        geometry = str(raw.get("geometry")).strip().lower()
        if geometry not in ("pareti", "completa"):
            raise ValueError("options.geometry deve essere pareti o completa.")
        opt.geometry = geometry
        opt.geometry_explicit = True
    return opt


def project_kind(project: dict) -> str | None:
    """Kind stored by the app, if the file has one.

    Current project.json (version 2) puts it in ``project.kind``. Older files
    have neither kind nor mode; callers then default to a room.
    """
    if not isinstance(project, dict):
        return None
    block = project.get("project") if isinstance(project.get("project"), dict) else {}
    for source in (block, project):
        for key in ("kind", "mode", "type"):
            value = source.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip().lower()
    return None


def project_geometry(project: dict) -> str | None:
    """Geometry stored by the app, if the file has one."""
    if not isinstance(project, dict):
        return None
    block = project.get("project") if isinstance(project.get("project"), dict) else {}
    for source in (block, project):
        value = source.get("geometry")
        if isinstance(value, str) and value.strip():
            return value.strip().lower()
    return None


def resolve_geometry(options: Options, project: dict) -> str:
    """options.geometry wins when the job set it. Otherwise project.json, otherwise walls only."""
    if options.geometry_explicit:
        return options.geometry
    stored = project_geometry(project)
    if stored is None:
        return "pareti"
    if stored not in ("pareti", "completa"):
        raise ValueError(f"project.geometry '{stored}' non è pareti o completa.")
    return stored


def resolve_mode(options: Options, project: dict) -> str:
    """options.mode wins. Otherwise project.json, otherwise a room."""
    if options.mode:
        return options.mode
    kind = project_kind(project)
    if kind is None:
        return "stanza"
    if kind not in ("stanza", "facciata"):
        raise ValueError(f"project.kind '{kind}' non è stanza o facciata.")
    return kind


def _pick(raw, name, alt=None):
    if name in raw and raw[name] is not None:
        return raw[name]
    if alt and alt in raw and raw[alt] is not None:
        return raw[alt]
    return None


def _int(raw, name, default, alt=None, minimum=None, maximum=None) -> int:
    value = _pick(raw, name, alt)
    out = default if value is None else int(value)
    if minimum is not None and out < minimum:
        raise ValueError(f"options.{name} è sotto il minimo ({minimum}).")
    if maximum is not None and out > maximum:
        raise ValueError(f"options.{name} è sopra il massimo ({maximum}).")
    return out


def _float(raw, name, default, alt=None) -> float:
    value = _pick(raw, name, alt)
    return default if value is None else float(value)
