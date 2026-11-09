# DocChat Constellation

Evidence-grounded document question answering for PDF, DOCX, and TXT files. Upload documents, ask questions, inspect cited source passages, and explore retrieved passages on the constellation map.

**Live demo:** https://docchat-constellation.onrender.com/  
**Repository:** https://github.com/bhumisingh-tech/docchat-constellation

## What this project does

DocChat Constellation is a document Q&A app (RAG-style, retrieval-first):

1. **Upload** PDF/DOCX/TXT files.
2. **Extract** text (with optional OCR fallback for scanned PDFs when server OCR dependencies are installed).
3. **Chunk** text into overlapping passages.
4. **Index** passages with TF-IDF.
5. **Retrieve** relevant passages with cosine similarity and a relevance threshold (to reduce weak/irrelevant matches).
6. **Answer** using either:
   - **Gemini (optional, grounded):** generates a natural-language answer from retrieved excerpts, with citations like `[Source 1]`.
   - **Evidence-only mode:** shows retrieved excerpts/citations directly when Gemini is not configured or unavailable.

The system is designed to be transparent: users can open source passages, see relevance scores, and locate passages on the map. It is **not** a general chatbot and should not answer from outside the uploaded documents.

## What’s new in this update

- **Better irrelevant-question handling:** weak keyword matches are filtered; out-of-scope questions get a clear, user-friendly response instead of confusing output.
- **Clearer Gemini explanation:** Gemini is optional and used only to generate answers grounded in retrieved document excerpts. Evidence-only mode works without any API key.
- **Native Gemini streaming (when configured):** uses Gemini `streamGenerateContent` SSE for lower perceived latency, with safe fallback to non-streaming/evidence mode.
- **OCR fallback support for scanned PDFs:** `rag.extract()` attempts OCR when selectable text is missing/sparse, if `tesseract-ocr`/`poppler-utils` + Python OCR deps are available (Dockerfile includes them).
- **Improved storage/large-file handling:** configurable limits (`MAX_UPLOAD_BYTES`, `MAX_FILE_BYTES`, `MAX_FILES`) with clearer errors. In-memory sessions are practical for small/demo deployments; **GB-scale libraries require persistent/object storage and a different architecture** (not included in this in-memory version).
- **Branding cleanup:** UI naming aligned to **DocChat Constellation** (name can be customized via `APP_NAME`).

## Architecture

- **Frontend:** React + TypeScript + Vite (chat, citations, constellation map, insights, controls, export)
- **Backend:** FastAPI (upload/index/chat/map/insights/export APIs, SSE chat responses)
- **Retrieval:** TF-IDF + cosine similarity + relevance thresholding
- **Optional generation:** Google Gemini REST API (`generateContent` / `streamGenerateContent`) using retrieved excerpts only
- **Map:** TruncatedSVD projection of TF-IDF vectors to 2D (visual aid, not a semantic graph)
- **Storage:** in-memory session state (restarts clear uploads/history)

## Local development (Windows 10/11)

Install Python and Node.js LTS, then open two terminals.

**Terminal 1 — backend**

```bat
cd /d "C:\path\to\docchat-constellation\backend"
py -m pip install -r requirements.txt
py -m uvicorn main:app --reload --port 8000
```

Check: http://127.0.0.1:8000/api/health

`gemini_configured: false` is normal. Evidence-only mode works without a key.

To enable Gemini answers (optional), set the key in the **backend terminal** before starting Uvicorn:

```bat
set GEMINI_API_KEY=your_key_here
set GEMINI_MODEL=gemini-2.5-flash
set GEMINI_STREAMING=1
py -m uvicorn main:app --reload --port 8000
```

Never put API keys in frontend/Vite env vars or commit them to GitHub.

**Terminal 2 — frontend**

```bat
cd /d "C:\path\to\docchat-constellation\frontend"
npm install
npm run dev
```

Open http://localhost:5173 (Vite proxies `/api/*` to port 8000).

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `GEMINI_API_KEY` | Optional Gemini API key for grounded generation | unset (evidence-only) |
| `GEMINI_MODEL` | Gemini model name | `gemini-2.5-flash` |
| `GEMINI_STREAMING` | Use native Gemini SSE streaming (`1/0`) | `1` |
| `MAX_UPLOAD_BYTES` | Max combined upload size per session | `26214400` (25 MB) |
| `MAX_FILE_BYTES` | Max size per file | `26214400` (25 MB) |
| `MAX_FILES` | Max files per session | `12` |
| `MIN_RELEVANCE_SCORE` | TF-IDF match floor | `0.03` |
| `MIN_BEST_SCORE` | Best-match floor for specific questions | `0.05` |
| `APP_NAME` | Display/API app name | `DocChat Constellation` |

## Deployment

- `Dockerfile` builds the Vite frontend and runs FastAPI as a single service (includes OCR system deps for scanned PDF fallback).
- `render.yaml` provides a Render blueprint.
- See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment and QA details.

**Important:** Keep one Uvicorn worker (`--workers 1`) because sessions are stored in process memory.

## Known limitations / honest notes

- **In-memory sessions:** uploads, indexes, and chat history are lost on server restart/sleep. No user accounts or persistent library in this version.
- **Lexical retrieval baseline:** TF-IDF is transparent and lightweight but can miss paraphrases/synonyms. Relevance thresholding reduces weak matches, but semantic embeddings + vector DB would improve recall.
- **OCR is best-effort:** scanned PDFs require OCR dependencies on the server; quality depends on scan quality/language.
- **Large files / GB-scale data:** not suitable for this in-memory design. For very large corpora, split files and/or implement persistent storage (DB/object storage), background indexing, and authentication.
- **Grounded generation, not guaranteed truth:** Gemini is instructed to use only retrieved excerpts, but answers should still be verified against citations.
- **No public share links:** session data is temporary; use Markdown export/copy/print for sharing.

## Suggested future improvements

1. Semantic embeddings + vector store (e.g., sentence-transformers + FAISS/ChromaDB, or managed embeddings) with evaluation.
2. Persistent storage + authentication (database, per-user libraries, saved chats).
3. Background ingestion/indexing and object storage for large files.
4. Improved OCR pipeline and language support.
5. Answer verification/reranking and citation-support checks.
