"""Originals use the same keys and encryption settings as the case archive."""

import os
import re
import tempfile
from functools import cached_property
from pathlib import Path

from .config import files_dir


class Storage:
    def __init__(self, directory: Path | None = None):
        self.directory = directory
        self.bucket = os.getenv("JUDE_S3_BUCKET")

    @cached_property
    def s3(self):
        import boto3

        return boto3.client("s3", region_name=os.getenv("AWS_REGION", "ap-southeast-3"))

    def _path(self, key: str) -> Path:
        parts = key.split("/")
        if not parts or any(not re.fullmatch(r"[A-Za-z0-9._-]+", p) or p in {".", ".."} for p in parts):
            raise ValueError("Invalid storage key")
        root = (self.directory or files_dir()).resolve()
        path = root.joinpath(*parts).resolve()
        if not path.is_relative_to(root):
            raise ValueError("Invalid storage key")
        return path

    def put(self, key: str, data: bytes, mime: str) -> None:
        path = self._path(key)
        if self.bucket:
            encryption = {"ServerSideEncryption": "aws:kms"}
            if kms := os.getenv("JUDE_S3_KMS_KEY"):
                encryption["SSEKMSKeyId"] = kms
            self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=mime, **encryption)
            return
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as target:
            staged = Path(target.name)
            try:
                target.write(data)
                target.flush()
                os.fsync(target.fileno())
                os.replace(staged, path)
            finally:
                staged.unlink(missing_ok=True)

    def get(self, key: str) -> bytes:
        path = self._path(key)
        if not self.bucket:
            return path.read_bytes()
        stream = self.s3.get_object(Bucket=self.bucket, Key=key)["Body"]
        try:
            return stream.read()
        finally:
            stream.close()

    def url(self, key: str) -> str | None:
        self._path(key)
        if self.bucket:
            return self.s3.generate_presigned_url(
                "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=90
            )
        return None

    def remove(self, key: str) -> None:
        path = self._path(key)
        if self.bucket:
            self.s3.delete_object(Bucket=self.bucket, Key=key)
        else:
            path.unlink(missing_ok=True)
