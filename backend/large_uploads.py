"""Direct-to-object-storage multipart uploads (up to 5 GiB).

Uploads never pass through the Render instance. The result is stored in S3/R2;
large-document indexing is a separate background-processing feature.
"""
from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

import boto3
from botocore.config import Config
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/large-uploads", tags=["large-uploads"])
FIVE_GIB = 5 * 1024**3
PART_SIZE = 64 * 1024**2
REQUIRED = ("S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "LARGE_UPLOAD_TOKEN")


def settings():
    if any(not os.getenv(k) for k in REQUIRED):
        raise HTTPException(503, "Large uploads are not configured. Set S3_BUCKET, AWS credentials and LARGE_UPLOAD_TOKEN.")
    return os.environ["S3_BUCKET"]


def authorize(token: str | None):
    expected = os.getenv("LARGE_UPLOAD_TOKEN")
    if not expected:
        raise HTTPException(503, "Large uploads are not configured.")
    import hmac
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(401, "A large-upload access token is required.")


def client():
    opts = {"service_name": "s3", "config": Config(signature_version="s3v4", s3={"addressing_style": "path"})}
    if os.getenv("S3_ENDPOINT_URL"):
        opts["endpoint_url"] = os.environ["S3_ENDPOINT_URL"]
    if os.getenv("S3_REGION"):
        opts["region_name"] = os.environ["S3_REGION"]
    return boto3.client(**opts)


class Start(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    size: int = Field(ge=1, le=FIVE_GIB)


class Part(BaseModel):
    key: str
    upload_id: str
    number: int = Field(ge=1, le=10000)


class CompletedPart(BaseModel):
    PartNumber: int = Field(ge=1, le=10000)
    ETag: str = Field(min_length=1)


class Finish(BaseModel):
    key: str
    upload_id: str
    parts: list[CompletedPart] = Field(min_length=1)


def valid_key(key: str):
    if not re.fullmatch(r"large/[0-9a-f]{32}/[a-zA-Z0-9._-]{1,255}", key):
        raise HTTPException(400, "Invalid upload key.")
    return key


@router.get("/config")
def config():
    return {"enabled": all(os.getenv(k) for k in REQUIRED), "max_file_bytes": FIVE_GIB, "part_bytes": PART_SIZE, "indexed_after_upload": False}


@router.post("/start")
def start(body: Start, x_large_upload_token: str | None = Header(default=None)):
    authorize(x_large_upload_token)
    bucket = settings()
    name = Path(body.name).name
    if Path(name).suffix.lower() not in {".pdf", ".docx", ".txt"}:
        raise HTTPException(415, "Only PDF, DOCX and TXT files are supported.")
    if not re.fullmatch(r"[a-zA-Z0-9._-]{1,255}", name):
        raise HTTPException(400, "Rename the file using letters, numbers, dots, dashes or underscores.")
    key = f"large/{uuid.uuid4().hex}/{name}"
    try:
        response = client().create_multipart_upload(
            Bucket=bucket, Key=key,
            Metadata={"original-size": str(body.size)},
            ContentType={".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain"}[Path(name).suffix.lower()],
        )
    except Exception as exc:
        raise HTTPException(502, "Could not initiate object-storage upload.") from exc
    return {"key": key, "upload_id": response["UploadId"], "part_bytes": PART_SIZE}


@router.post("/part")
def part(body: Part, x_large_upload_token: str | None = Header(default=None)):
    authorize(x_large_upload_token)
    bucket = settings()
    try:
        url = client().generate_presigned_url(
            "upload_part",
            Params={"Bucket": bucket, "Key": valid_key(body.key), "UploadId": body.upload_id, "PartNumber": body.number},
            ExpiresIn=3600, HttpMethod="PUT",
        )
    except Exception as exc:
        raise HTTPException(502, "Could not sign upload part.") from exc
    return {"url": url}


@router.post("/finish")
def finish(body: Finish, x_large_upload_token: str | None = Header(default=None)):
    authorize(x_large_upload_token)
    bucket = settings()
    valid_key(body.key)
    if [p.PartNumber for p in body.parts] != list(range(1, len(body.parts) + 1)):
        raise HTTPException(400, "Parts must be ordered consecutively.")
    s3 = client()
    try:
        s3.complete_multipart_upload(
            Bucket=bucket, Key=body.key, UploadId=body.upload_id,
            MultipartUpload={"Parts": [p.model_dump() for p in body.parts]},
        )
        obj = s3.head_object(Bucket=bucket, Key=body.key)
        expected = int(obj.get("Metadata", {}).get("original-size", "0"))
        actual = int(obj["ContentLength"])
        if expected != actual or actual > FIVE_GIB:
            s3.delete_object(Bucket=bucket, Key=body.key)
            raise HTTPException(422, "Uploaded size mismatch. Object removed.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, "Could not finalize multipart upload.") from exc
    return {"key": body.key, "size_bytes": actual, "status": "stored", "indexed": False,
            "message": "Stored in object storage. Large-file indexing is not yet available."}


class Abort(BaseModel):
    key: str
    upload_id: str


@router.post("/abort")
def abort(body: Abort, x_large_upload_token: str | None = Header(default=None)):
    authorize(x_large_upload_token)
    try:
        client().abort_multipart_upload(Bucket=settings(), Key=valid_key(body.key), UploadId=body.upload_id)
    except Exception:
        pass
    return {"aborted": True}
