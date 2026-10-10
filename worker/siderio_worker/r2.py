"""Cloudflare R2 via the S3 API. Credentials come from the environment, never from the repo."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
ACCOUNT = re.compile(r"^[0-9a-f]{32}$", re.I)

ENV_KEYS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")


class StorageError(RuntimeError):
    pass


@dataclass
class R2Config:
    account_id: str
    access_key_id: str
    secret_access_key: str
    bucket: str

    @property
    def endpoint(self) -> str:
        return f"https://{self.account_id}.r2.cloudflarestorage.com"


def read_config() -> R2Config:
    values = {key: os.environ.get(key, "").strip() for key in ENV_KEYS}
    missing = [key for key, value in values.items() if not value]
    if missing:
        raise StorageError("Variabili R2 mancanti: " + ", ".join(missing))
    if not ACCOUNT.match(values["R2_ACCOUNT_ID"]):
        raise StorageError("R2_ACCOUNT_ID non è un id account Cloudflare (32 caratteri esadecimali).")
    return R2Config(
        account_id=values["R2_ACCOUNT_ID"],
        access_key_id=values["R2_ACCESS_KEY_ID"],
        secret_access_key=values["R2_SECRET_ACCESS_KEY"],
        bucket=values["R2_BUCKET"],
    )


def configured() -> bool:
    return all(os.environ.get(key, "").strip() for key in ENV_KEYS)


def validate_project_id(project_id: str) -> str:
    project_id = (project_id or "").strip()
    if not UUID.match(project_id):
        raise StorageError("projectId non è un UUID.")
    return project_id.lower()


def manifest_key(project_id: str) -> str:
    return f"rilievi/{project_id}/project.json"


def photo_key(project_id: str, sequence: int, photo_id: str) -> str:
    seq = str(max(0, int(sequence))).zfill(3)
    return f"rilievi/{project_id}/foto/{seq}-{photo_id}.jpg"


def result_key(project_id: str, name: str) -> str:
    return f"rilievi/{project_id}/risultati/{name}"


def client_for(cfg: R2Config):
    import boto3
    from botocore.config import Config

    kwargs = dict(
        region_name="auto",
        signature_version="s3v4",
        s3={"addressing_style": "path"},
        retries={"max_attempts": 5, "mode": "standard"},
    )
    try:
        config = Config(
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
            **kwargs,
        )
    except TypeError:
        config = Config(**kwargs)
    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint,
        aws_access_key_id=cfg.access_key_id,
        aws_secret_access_key=cfg.secret_access_key,
        config=config,
    )


def list_prefix(client, bucket: str, prefix: str) -> list[str]:
    keys = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents") or []:
            keys.append(item["Key"])
    return keys


def download_file(client, bucket: str, key: str, dest: str):
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    client.download_file(bucket, key, dest)


def upload_file(client, bucket: str, key: str, path: str, content_type: str):
    extra = {"ContentType": content_type}
    client.upload_file(path, bucket, key, ExtraArgs=extra)


CONTENT_TYPES = {
    ".step": "application/step",
    ".stp": "application/step",
    ".glb": "model/gltf-binary",
    ".zip": "application/zip",
    ".ply": "application/octet-stream",
    ".json": "application/json",
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".stl": "model/stl",
    ".obj": "model/obj",
    ".jpg": "image/jpeg",
    ".txt": "text/plain; charset=utf-8",
}


def content_type_for(name: str) -> str:
    ext = os.path.splitext(name)[1].lower()
    return CONTENT_TYPES.get(ext, "application/octet-stream")
