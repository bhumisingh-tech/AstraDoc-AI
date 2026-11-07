"""FastAPI transport for the unchanged TF-IDF/Gemini RAG engine.

Sessions live in RAM: restarting the server clears uploads and conversations.
For a single deployment, run one Uvicorn worker so session state is consistent.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import re
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated

import numpy as np
import requests
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field
from sklearn.decomposition import TruncatedSVD

from rag import chunks, extract, fallback, find, gemini, index

MAX_BYTES = 15 * 1024 * 1024
ALLOWED = {".pdf", ".docx", ".txt"}
BASE = Path(__file__).resolve().parent
FRONTEND_DIST = BASE.parent / "frontend" / "dist"

logger = logging.getLogger("docchat")

app = FastAPI(title="DocChat Bhumi · Constellation", version="1.0.0")


@dataclass
class MemoryFile:
    name: str
    data: bytes

    def getvalue(self) -> bytes:
        """Mimics Streamlit UploadedFile, as expected by unchanged rag.py."""
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
        raise HTTPException(status_code=422, detail="No selectable text found. Scanned PDFs need OCR.")
    return Session(files=files, passages=passage_data, vec=vec, mat=mat, file_stats=stats)


def basic_info(session_id: str, s: Session) -> dict:
    return {
        "session_id": session_id,
        "documents": s.file_stats,
        "passage_count": len(s.passages),
        "total_bytes": sum(len(f.data) for f in s.files),
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
            "file": next((f.name for f in s.files if passage["source"] == f.name or passage["source"].startswith(f.name + " · page ")), passage["source"]),
        }
        for i, ((passage, score), passage_id) in enumerate(zip(matches, ids), 1)
    ]


def select_matches(s: Session, question: str, top_k: int) -> list[tuple[dict, float]]:
    broad = bool(re.search(
        r"\b(summarize|summary|overview|what is this document|what is the (pdf|file|document) about)\b",
        question.lower(),
    ))
    if broad:
        return [(p, 1.0) for p in s.passages[:top_k]]
    return find(question, s.passages, s.vec, s.mat, top_k)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/api/health")
def health():
    return {"status": "ok", "gemini_configured": bool(os.getenv("GEMINI_API_KEY")),
            "answer_mode": "gemini" if os.getenv("GEMINI_API_KEY") else "evidence", "model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash")}


@app.post("/api/upload")
async def upload(
    files: Annotated[list[UploadFile], File(description="PDF, DOCX, TXT; combined limit 15 MB")],
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
        data = await upload_file.read(MAX_BYTES + 1)
        await upload_file.close()
        if not data:
            raise HTTPException(422, f"{name} is empty.")
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "Uploads cannot exceed 15 MB in total.")
        incoming.append(MemoryFile(name, data))

    previous: list[MemoryFile] = []
    if session_id:
        previous = get_session(session_id).files
    combined = previous + incoming
    if len({f.name for f in combined}) != len(combined):
        raise HTTPException(409, "Each uploaded filename must be unique. Rename duplicates first.")
    if sum(len(f.data) for f in combined) > MAX_BYTES:
        raise HTTPException(413, "Your combined documents exceed 15 MB. Remove a file first.")
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
        return {"session_id": None, "documents": [], "passage_count": 0, "total_bytes": 0}
    updated = await asyncio.to_thread(create_session, remaining)
    with sessions_lock:
        sessions[session_id] = updated
    return basic_info(session_id, updated)


@app.post("/api/chat")
async def chat(body: ChatBody):
    s = get_session(body.session_id)
    question = body.question.strip()
    if not question:
        raise HTTPException(422, "Question cannot be blank.")
    if not s.lock.acquire(blocking=False):
        raise HTTPException(409, "Another response is being generated for this session.")

    async def events():
        try:
            matches = await asyncio.to_thread(select_matches, s, question, body.top_k)
            sources = source_payload(s, matches)
            # Send retrieval data first, before calling Gemini.
            yield sse("sources", {"sources": sources, "question": question})
            warning = None
            if not matches:
                answer = "I could not find information relevant to that question in the uploaded documents."
                mode = "evidence"
            elif os.getenv("GEMINI_API_KEY"):
                try:
                    # The original Gemini function is non-streaming: we stream the completed
                    # response in small pieces over SSE without changing the RAG function.
                    answer = await asyncio.to_thread(
                        gemini, question, matches, os.environ["GEMINI_API_KEY"],
                        os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
                    )
                    mode = "gemini"
                except (requests.RequestException, KeyError, IndexError, ValueError, TypeError) as exc:
                    # Log the HTTP status only; never expose API keys or response bodies.
                    if isinstance(exc, requests.HTTPError) and exc.response is not None:
                        status = exc.response.status_code
                        logger.warning("Gemini request failed: HTTP %s", status)
                        if status in (401, 403):
                            warning = "Gemini authentication failed. Check GEMINI_API_KEY in Render Environment. Showing evidence-only answer."
                        elif status == 429:
                            warning = "Gemini quota or rate limit reached. Showing evidence-only answer."
                        elif status == 404:
                            warning = "Gemini model not found. Check GEMINI_MODEL. Showing evidence-only answer."
                        else:
                            warning = f"Gemini request failed (HTTP {status}). Showing evidence-only answer."
                    else:
                        logger.warning("Gemini request failed: %s", type(exc).__name__)
                        warning = "Gemini is temporarily unavailable. Showing evidence-only answer."
                    answer = fallback(question, matches)
                    mode = "evidence"
            else:
                answer = fallback(question, matches)
                mode = "evidence"
            if warning:
                yield sse("warning", {"message": warning})
            yield sse("mode", {"mode": mode})
            for part in re.findall(r"\S+\s*|\s+", answer):
                yield sse("token", {"text": part})
                await asyncio.sleep(0)  # Lets the connection remain cancellable.
            entry = {"question": question, "answer": answer, "sources": sources, "mode": mode}
            if body.regenerate_last and s.history and s.history[-1]["question"] == question:
                s.history[-1] = entry  # Regeneration replaces the last export entry.
            else:
                s.history.append(entry)
            s.last_question = question
            s.last_retrieved_ids = [src["id"] for src in sources]
            yield sse("done", {"message_index": len(s.history) - 1})
        except Exception:
            yield sse("error", {"message": "Could not complete the answer. Please retry."})
        finally:
            s.lock.release()

    return StreamingResponse(events(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"
    })


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
        "suggested_questions": ["What is this document about?", *[f"What does the document say about {item['term']}?" for item in keywords[:3]]],
        "stats": {"files": len(s.files), "pages": sum(x["pages"] or 0 for x in s.file_stats),
                  "passages": len(s.passages), "words": total_words,
                  "reading_minutes": max(1, (total_words + 199) // 200)},
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
    selected = select_matches(s, question, top_k) if question else []
    retrieved = match_ids(s, selected) if question else s.last_retrieved_ids
    return {
        "points": [{"id": i, "x": float(x), "y": float(y), "source": p["source"], "text": p["text"],
                    "file": next((f.name for f in s.files if p["source"] == f.name or p["source"].startswith(f.name + " · page ")), p["source"])}
                   for i, ((x, y), p) in enumerate(zip(points, s.passages))],
        "query_point": {"x": float(query_point[0]), "y": float(query_point[1])} if query_point is not None else None,
        "retrieved_ids": retrieved,
    }


@app.get("/api/export", response_class=PlainTextResponse)
def export_markdown(session_id: str):
    s = get_session(session_id)
    lines = ["# DocChat Bhumi · Conversation", ""]
    for item in s.history:
        lines += ["## Question", "", item["question"], "", "## Answer", "", item["answer"], ""]
        if item["sources"]:
            lines += ["### Sources", ""]
            for src in item["sources"]:
                lines += [f"- [Source {src['citation']}] **{src['source']}** (relevance {src['score']:.3f})", f"  > {src['text'].replace(chr(10), ' ')}", ""]
    return PlainTextResponse("\n".join(lines), media_type="text/markdown", headers={
        "Content-Disposition": 'attachment; filename="docchat-conversation.md"'
    })


@app.delete("/api/chat")
def clear_chat(session_id: str):
    s = get_session(session_id)
    with s.lock:
        s.history.clear()
        s.last_question = None
        s.last_retrieved_ids.clear()
    return {"cleared": True}


# Single deploy: FastAPI serves Vite output once Stage 2 builds frontend/dist.
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
