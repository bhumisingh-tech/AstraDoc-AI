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
