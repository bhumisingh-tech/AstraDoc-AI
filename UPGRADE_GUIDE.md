# AstraDoc-AI live upgrade

## Included
- Optional hybrid MiniLM + TF-IDF search in backend/rag.py
- Mixed scanned/digital PDF OCR per page
- SQLite-backed anonymous document sessions and chat history
- Frontend session restore after refresh

## Render deployment
The current Render Free instance uses ephemeral storage. SQLite data is NOT durable across instance replacement or redeployment without a persistent disk or external database. Do not upload sensitive documents on this anonymous demo.

For persistent Render storage, use a plan supporting disks and set DATABASE_PATH to a mounted path such as /data/astradoc.sqlite3. Set SEMANTIC_SEARCH=1 only if the semantic dependencies are installed and sufficient RAM is available. Default SEMANTIC_SEARCH=0 keeps the existing lightweight deployment.

This version does NOT implement 5 GB uploads. The configured file and session limits remain 25 MiB. Large uploads require resumable object storage, background processing, and quotas.

## Testing
Run: python -m compileall -q backend
Run: cd frontend && npm ci && npm run build
Check: /api/health and /api/session/{session_id}

## 5 GiB cloud uploads

The large-upload UI uses S3-compatible multipart upload (64 MiB parts), presigned URLs and ETag completion. Render does not proxy file bytes. These files are stored in object storage but are **not indexed or searchable** yet. The existing 25 MiB chat-upload pipeline is unchanged.

Set Render environment variables:
- S3_BUCKET: bucket name
- AWS_ACCESS_KEY_ID: storage access key
- AWS_SECRET_ACCESS_KEY: storage secret
- S3_ENDPOINT_URL: S3-compatible endpoint URL (omit for AWS S3)
- S3_REGION: bucket region
- LARGE_UPLOAD_TOKEN: long, random secret shared with authorized uploaders

Configure the storage bucket CORS to allow PUT from https://docchat-constellation.onrender.com and expose ETag, for example:
```json
[{"AllowedOrigins":["https://docchat-constellation.onrender.com"],"AllowedMethods":["PUT"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]
```
For AWS S3, configure a lifecycle rule to abort incomplete multipart uploads after one day. Keep the bucket private, apply storage quotas and rate limits, and do not expose credentials in the frontend.

Large-file indexing needs a separate queue/worker and incremental extraction/vector indexing; it is not part of this change. The app should never claim that a 5 GiB file is ready for chat merely because the upload finished.
