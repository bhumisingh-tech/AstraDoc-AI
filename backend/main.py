"""FastAPI transport for the TF-IDF + optional Gemini RAG engine.

Sessions live in RAM: restarting the server clears uploads and conversations.
For a single deployment, run one Uvicorn worker so session state is consistent.

Updates in this revision:
- Configurable upload limits (MAX_UPLOAD_BYTES, MAX_FILE_BYTES).
- Relevance-threshold filtering to avoid weak/irrelevant matches.
- Native Gemini token streaming when GEMINI_STREAMING=1 (default) with fallback.
- Optional OCR fallback handled in rag.extract() when OCR dependencies are present.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import queue
import re
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated

import numpy as np
import requests
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field
from sklearn.decomposition import TruncatedSVD

from rag import (
    MIN_BEST_SCORE,
    NO_EVIDENCE_ANSWER,
    chunks,
    extract,
    fallback,
    find,
    gemini,
    gemini_stream,
    index,
    rerank_with_gemini,
)

# Practical defaults for Render-style deployments; override via environment.
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
MAX_FILE_BYTES = int(os.getenv("MAX_FILE_BYTES", str(25 * 1024 * 1024)))
MAX_FILES = int(os.getenv("MAX_FILES", "12"))
GEMINI_STREAMING = os.getenv("GEMINI_STREAMING", "1").lower() not in {"0", "false", "no"}
GEMINI_RERANK = os.getenv("GEMINI_RERANK", "0").lower() in {"1", "true", "yes"}
ALLOWED = {".pdf", ".docx", ".txt"}
BASE = Path(__file__).resolve().parent
FRONTEND_DIST = BASE.parent / "frontend" / "dist"
APP_NAME = os.getenv("APP_NAME", "DocChat Constellation")

logger = logging.getLogger("docchat")

DOCCHAT_ACCESS_TOKEN = os.getenv("DOCCHAT_ACCESS_TOKEN", "").strip()

def require_access(
    authorization: str | None = Header(default=None),
    x_docchat_token: str | None = Header(default=None, alias="X-DocChat-Token"),
):
    if not DOCCHAT_ACCESS_TOKEN:
        return
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif x_docchat_token:
        token = x_docchat_token.strip()
    if token != DOCCHAT_ACCESS_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing access token.")

app = FastAPI(title=APP_NAME, version="1.2.0", dependencies=[Depends(require_access)])


@dataclass
class MemoryFile:
    name: str
    data: bytes

    def getvalue(self) -> bytes:
        """Mimics Streamlit UploadedFile, as expected by rag.py."""
        return self.data


@dataclass
class Session:
    files: list[MemoryFile]
    passages: list[dict]
    vec: object
    mat: object
    file_stats: list[dict]
    history: list[dict] = field(default_factory=list)
    last_question: str | None = None
    last_retrieved_ids: list[int] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)


sessions: dict[str, Session] = {}
sessions_lock = threading.Lock()


class ChatBody(BaseModel):
    session_id: str
    question: str = Field(min_length=1, max_length=8000)
    top_k: int = Field(default=5, ge=2, le=8)
    regenerate_last: bool = False


def get_session(session_id: str) -> Session:
    with sessions_lock:
        session = sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found. Upload documents again.")
    return session


def file_metadata(f: MemoryFile) -> dict:
    segments = extract(f)
    nonempty = [text for _, text in segments if text.strip()]
    return {
        "name": f.name,
        "size_bytes": len(f.data),
        "type": Path(f.name).suffix.lower().lstrip("."),
        "pages": len(segments) if f.name.lower().endswith(".pdf") else None,
        "passages": sum(len(chunks(text)) for _, text in segments),
        "words": sum(len(text.split()) for text in nonempty),
    }


def create_session(files: list[MemoryFile]) -> Session:
    # Keep original index() intact. Errors such as empty vocabulary become friendly HTTP errors.
    try:
        passage_data, vec, mat = index(files)
        stats = [file_metadata(f) for f in files]
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Cannot read or index document: {exc}") from exc
    if not passage_data:
        raise HTTPException(
            status_code=422,
            detail=(
                "No selectable text found. If this is a scanned PDF, install OCR "
                "dependencies (tesseract/poppler) on the server or upload a text-based file."
            ),
        )
    return Session(files=files, passages=passage_data, vec=vec, mat=mat, file_stats=stats)


def basic_info(session_id: str, s: Session) -> dict:
    return {
        "session_id": session_id,
        "documents": s.file_stats,
        "passage_count": len(s.passages),
        "total_bytes": sum(len(f.data) for f in s.files),
        "gemini_rerank": GEMINI_RERANK and bool(os.getenv("GEMINI_API_KEY")), "access_token_required": bool(DOCCHAT_ACCESS_TOKEN),
        "limits": {
            "max_upload_bytes": MAX_UPLOAD_BYTES,
            "max_file_bytes": MAX_FILE_BYTES,
            "max_files": MAX_FILES,
        },
    }


def match_ids(s: Session, matches: list[tuple[dict, float]]) -> list[int]:
    # Identity is stable because find() returns original dict objects from passages.
    positions = {id(p): i for i, p in enumerate(s.passages)}
    return [positions[id(p)] for p, _ in matches]


def source_payload(s: Session, matches: list[tuple[dict, float]]) -> list[dict]:
    ids = match_ids(s, matches)
    return [
        {
            "id": passage_id,
            "citation": i,
            "source": passage["source"],
            "text": passage["text"],
            "score": score,
            "file": next(
                (
                    f.name
                    for f in s.files
                    if passage["source"] == f.name or passage["source"].startswith(f.name + " · page ")
                ),
                passage["source"],
            ),
        }
        for i, ((passage, score), passage_id) in enumerate(zip(matches, ids), 1)
    ]


def is_broad_question(question: str) -> bool:
    return bool(
        re.search(
            r"\b(summarize|summary|overview|what is this document|what is the (pdf|file|document) about)\b",
            question.lower(),
        )
    )


def select_matches(s: Session, question: str, top_k: int) -> list[tuple[dict, float]]:
    if is_broad_question(question):
        return [(p, 1.0) for p in s.passages[:top_k]]
    return find(question, s.passages, s.vec, s.mat, top_k)


def reliable_matches(question: str, matches: list[tuple[dict, float]]) -> list[tuple[dict, float]]:
    """Filter out weak matches for non-broad questions."""
    if not matches or is_broad_question(question):
        return matches
    best = max(score for _, score in matches)
    if best < MIN_BEST_SCORE:
        return []
    return matches


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _human_bytes(num: int) -> str:
    mb = num / (1024 * 1024)
    if mb >= 1024:
        return f"{mb / 1024:.1f} GB"
    return f"{mb:.0f} MB"


@app.get("/api/health", dependencies=[])
def health():
    return {
        "status": "ok",
        "app": APP_NAME,
        "gemini_configured": bool(os.getenv("GEMINI_API_KEY")),
        "answer_mode": "gemini" if os.getenv("GEMINI_API_KEY") else "evidence",
        "gemini_streaming": GEMINI_STREAMING and bool(os.getenv("GEMINI_API_KEY")),
        "model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        "gemini_rerank": GEMINI_RERANK and bool(os.getenv("GEMINI_API_KEY")), "access_token_required": bool(DOCCHAT_ACCESS_TOKEN),
        "limits": {
            "max_upload_bytes": MAX_UPLOAD_BYTES,
            "max_file_bytes": MAX_FILE_BYTES,
            "max_files": MAX_FILES,
        },
    }


@app.post("/api/upload")
async def upload(
    files: Annotated[list[UploadFile], File(description="PDF, DOCX, TXT")],
    session_id: Annotated[str | None, Form()] = None,
):
    """Create a session or append files to an existing session; names must be unique."""
    if not files:
        raise HTTPException(400, "Select at least one file.")
    incoming: list[MemoryFile] = []
    for upload_file in files:
        name = Path(upload_file.filename or "").name
        suffix = Path(name).suffix.lower()
        if not name or suffix not in ALLOWED:
            raise HTTPException(415, f"Unsupported file: {name or 'unnamed'}. Use PDF, DOCX or TXT.")
        data = await upload_file.read(MAX_FILE_BYTES + 1)
        await upload_file.close()
        if not data:
            raise HTTPException(422, f"{name} is empty.")
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(
                413,
                f"{name} is too large ({_human_bytes(len(data))}). Maximum per file is "
                f"{_human_bytes(MAX_FILE_BYTES)}. Split very large documents before uploading.",
            )
        incoming.append(MemoryFile(name, data))

    previous: list[MemoryFile] = []
    if session_id:
        previous = get_session(session_id).files
    combined = previous + incoming
    if len(combined) > MAX_FILES:
        raise HTTPException(413, f"Too many files. Maximum is {MAX_FILES} files per session.")
    if len({f.name for f in combined}) != len(combined):
        raise HTTPException(409, "Each uploaded filename must be unique. Rename duplicates first.")
    total = sum(len(f.data) for f in combined)
    if total > MAX_UPLOAD_BYTES:
        raise HTTPException(
            413,
            f"Your combined documents are {_human_bytes(total)}, which exceeds the "
            f"{_human_bytes(MAX_UPLOAD_BYTES)} session limit. Remove files or split large "
            "documents. For GB-scale libraries, use a production deployment with persistent/object storage.",
        )
    new_session = await asyncio.to_thread(create_session, combined)
    sid = session_id or uuid.uuid4().hex
    with sessions_lock:
        sessions[sid] = new_session  # Reindexing intentionally resets chat and map state.
    return basic_info(sid, new_session)


@app.delete("/api/files/{file_name:path}")
async def remove_file(file_name: str, session_id: str = Query(...)):
    """Remove by filename, then rebuild the original TF-IDF index."""
    s = get_session(session_id)
    remaining = [f for f in s.files if f.name != file_name]
    if len(remaining) == len(s.files):
        raise HTTPException(404, "File not found.")
    if not remaining:
        with sessions_lock:
            sessions.pop(session_id, None)
        return {"session_id": None, "documents": [], "passage_count": 0, "total_bytes": 0, "limits": {"max_upload_bytes": MAX_UPLOAD_BYTES, "max_file_bytes": MAX_FILE_BYTES, "max_files": MAX_FILES}}
    updated = await asyncio.to_thread(create_session, remaining)
    with sessions_lock:
        sessions[session_id] = updated
    return basic_info(session_id, updated)


def _gemini_warning(exc: Exception) -> str:
    if isinstance(exc, requests.HTTPError) and exc.response is not None:
        status = exc.response.status_code
        logger.warning("Gemini request failed: HTTP %s", status)
        if status in (401, 403):
            return "Gemini authentication failed. Check GEMINI_API_KEY. Showing evidence-only answer."
        if status == 429:
            return "Gemini quota or rate limit reached. Showing evidence-only answer."
        if status == 404:
            return "Gemini model not found. Check GEMINI_MODEL. Showing evidence-only answer."
        return f"Gemini request failed (HTTP {status}). Showing evidence-only answer."
    logger.warning("Gemini request failed: %s", type(exc).__name__)
    return "Gemini is temporarily unavailable. Showing evidence-only answer."


@app.post("/api/chat")
async def chat(body: ChatBody):
    s = get_session(body.session_id)
    question = body.question.strip()
    if not question:
        raise HTTPException(422, "Question cannot be blank.")
    if not s.lock.acquire(blocking=False):
        raise HTTPException(409, "Another response is being generated for this session.")

    async def events():
        emitted = {"mode": False, "answer": False}
        try:
            candidate_k = min(8, max(body.top_k, body.top_k + 3)) if GEMINI_RERANK else body.top_k
            raw_matches = await asyncio.to_thread(select_matches, s, question, candidate_k)
            matches = reliable_matches(question, raw_matches)
            if GEMINI_RERANK and matches and not is_broad_question(question) and os.getenv("GEMINI_API_KEY"):
                try:
                    matches = await asyncio.to_thread(
                        rerank_with_gemini, question, matches,
                        os.environ["GEMINI_API_KEY"], os.getenv("GEMINI_MODEL", "gemini-2.5-flash"), body.top_k,
                    )
                except Exception:
                    logger.info("Rerank step skipped")
            sources = source_payload(s, matches)
            # Send retrieval data first, before calling Gemini.
            yield sse("sources", {"sources": sources, "question": question})
            warning = None
            mode = "evidence"
            answer_parts: list[str] = []

            if not matches:
                answer = NO_EVIDENCE_ANSWER
                if raw_matches and not is_broad_question(question):
                    warning = (
                        "I found only weak keyword matches, so I’m not treating them as "
                        "reliable evidence. Try a more specific question using terms from the document."
                    )
            elif os.getenv("GEMINI_API_KEY"):
                key = os.environ["GEMINI_API_KEY"]
                model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
                if GEMINI_STREAMING:
                    try:
                        mode = "gemini"
                        yield sse("mode", {"mode": mode})
                        emitted["mode"] = True
                        token_queue: queue.Queue[tuple[str, object]] = queue.Queue()

                        def run_stream() -> None:
                            try:
                                for text in gemini_stream(question, matches, key, model):
                                    token_queue.put(("token", text))
                                token_queue.put(("done", None))
                            except Exception as exc:  # noqa: BLE001
                                token_queue.put(("error", exc))

                        thread = threading.Thread(target=run_stream, daemon=True)
                        thread.start()
                        while True:
                            kind, payload = await asyncio.to_thread(token_queue.get)
                            if kind == "token":
                                text = str(payload)
                                answer_parts.append(text)
                                emitted["answer"] = True
                                yield sse("token", {"text": text})
                            elif kind == "error":
                                raise payload  # type: ignore[misc]
                            else:
                                break
                        answer = "".join(answer_parts).strip() or fallback(question, matches)
                        if not answer_parts and answer:
                            emitted["answer"] = True
                            answer_parts.append(answer)
                            yield sse("token", {"text": answer})
                    except Exception as exc:  # noqa: BLE001
                        warning = _gemini_warning(exc)
                        answer = fallback(question, matches)
                        mode = "evidence"
                        answer_parts = [answer]
                        emitted["answer"] = True
                        yield sse("mode", {"mode": mode})
                        emitted["mode"] = True
                        if warning:
                            yield sse("warning", {"message": warning})
                            warning = None
                        yield sse("token", {"text": answer})
                else:
                    try:
                        answer = await asyncio.to_thread(gemini, question, matches, key, model)
                        mode = "gemini"
                    except Exception as exc:  # noqa: BLE001
                        warning = _gemini_warning(exc)
                        answer = fallback(question, matches)
                        mode = "evidence"
            else:
                answer = fallback(question, matches)
                mode = "evidence"

            if warning:
                yield sse("warning", {"message": warning})
            if not emitted["mode"]:
                yield sse("mode", {"mode": mode})
            if not emitted["answer"]:
                for part in re.findall(r"\S+\s*|\s+", answer):
                    yield sse("token", {"text": part})
                    await asyncio.sleep(0)

            final_answer = "".join(answer_parts).strip() if answer_parts else answer
            entry = {"question": question, "answer": final_answer, "sources": sources, "mode": mode}
            if body.regenerate_last and s.history and s.history[-1]["question"] == question:
                s.history[-1] = entry
            else:
                s.history.append(entry)
            s.last_question = question
            s.last_retrieved_ids = [src["id"] for src in sources]
            yield sse("done", {"message_index": len(s.history) - 1})
        except Exception:
            logger.exception("Chat request failed")
            yield sse("error", {"message": "Could not complete the answer. Please retry."})
        finally:
            s.lock.release()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/insights")
def insights(session_id: str):
    s = get_session(session_id)
    weights = np.asarray(s.mat.sum(axis=0)).ravel()
    terms = s.vec.get_feature_names_out()
    top = sorted(zip(terms, weights), key=lambda item: -item[1])[:12]
    total_words = sum(stat["words"] for stat in s.file_stats)
    # Lightweight, key-free extractive overview; never invent document facts.
    overview = " ".join(p["text"] for p in s.passages[:2])[:950].strip()
    keywords = [{"term": term, "weight": round(float(weight), 3)} for term, weight in top]
    return {
        "summary": overview + ("…" if len(" ".join(p["text"] for p in s.passages[:2])) > 950 else ""),
        "summary_type": "extractive",
        "keywords": keywords,
        "suggested_questions": [
            "What is this document about?",
            *[f"What does the document say about {item['term']}?" for item in keywords[:3]],
        ],
        "stats": {
            "files": len(s.files),
            "pages": sum(x["pages"] or 0 for x in s.file_stats),
            "passages": len(s.passages),
            "words": total_words,
            "reading_minutes": max(1, (total_words + 199) // 200),
        },
        "documents": s.file_stats,
    }


@app.get("/api/map")
def passage_map(session_id: str, question: str | None = None, top_k: int = Query(5, ge=2, le=8)):
    s = get_session(session_id)
    count, features = s.mat.shape
    if count >= 2 and features >= 2:
        # TF-IDF → 2D with TruncatedSVD; sparse inputs remain sparse.
        model = TruncatedSVD(n_components=2, random_state=42)
        points = model.fit_transform(s.mat)
        query_point = model.transform(s.vec.transform([question]))[0].tolist() if question else None
    else:
        points = np.zeros((count, 2))
        query_point = [0.0, 0.0] if question else None
    selected = reliable_matches(question, select_matches(s, question, top_k)) if question else []
    retrieved = match_ids(s, selected) if question else s.last_retrieved_ids
    return {
        "points": [
            {
                "id": i,
                "x": float(x),
                "y": float(y),
                "source": p["source"],
                "text": p["text"],
                "file": next(
                    (
                        f.name
                        for f in s.files
                        if p["source"] == f.name or p["source"].startswith(f.name + " · page ")
                    ),
                    p["source"],
                ),
            }
            for i, ((x, y), p) in enumerate(zip(points, s.passages))
        ],
        "query_point": {"x": float(query_point[0]), "y": float(query_point[1])} if query_point is not None else None,
        "retrieved_ids": retrieved,
    }


@app.get("/api/export", response_class=PlainTextResponse)
def export_markdown(session_id: str):
    s = get_session(session_id)
    lines = [f"# {APP_NAME} · Conversation", ""]
    for item in s.history:
        lines += ["## Question", "", item["question"], "", "## Answer", "", item["answer"], ""]
        if item["sources"]:
            lines += ["### Sources", ""]
            for src in item["sources"]:
                lines += [
                    f"- [Source {src['citation']}] **{src['source']}** (relevance {src['score']:.3f})",
                    f"  > {src['text'].replace(chr(10), ' ')}",
                    "",
                ]
    return PlainTextResponse(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="docchat-conversation.md"'},
    )


@app.delete("/api/chat")
def clear_chat(session_id: str):
    s = get_session(session_id)
    with s.lock:
        s.history.clear()
        s.last_question = None
        s.last_retrieved_ids.clear()
    return {"cleared": True}


# Single deploy: FastAPI serves Vite output once frontend is built.
# Unknown /api/... paths still return API 404, never frontend HTML.
@app.get("/{path:path}", include_in_schema=False)
def serve_frontend(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "Unknown API route")
    if FRONTEND_DIST.is_dir():
        target = (FRONTEND_DIST / path).resolve()
        if target.is_relative_to(FRONTEND_DIST.resolve()) and target.is_file():
            return FileResponse(target)
        return FileResponse(FRONTEND_DIST / "index.html")
    raise HTTPException(404, "Frontend is not built yet. Run Vite build in Stage 2.")
