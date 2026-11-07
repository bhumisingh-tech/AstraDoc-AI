# DocChat Bhumi · Constellation

Stage 6 — Docker-ready React + Vite frontend with working upload/library, streaming chat, citations, SVD map, insights, control panel, and exports backed by FastAPI.

**Current status:** Stages 1–6 source files are packaged; Docker/Render integration and frontend build require verification on a machine with npm registry access. See [DEPLOYMENT.md](DEPLOYMENT.md) for complete instructions. PDF uses the browser print dialog (choose Save as PDF). Keep the public Streamlit app live for now.

## Local development — Windows 10/11

Install Python and Node.js LTS, extract this ZIP, and open two Command Prompt windows.

**Window 1 — backend:**

```bat
cd /d "C:\path\to\docchat-constellation\backend"
py -m pip install -r requirements.txt
py -m uvicorn main:app --reload --port 8000
```

Visit http://127.0.0.1:8000/api/health. `gemini_configured: false` is normal; the evidence-only mode works without an API key. For AI responses set `GEMINI_API_KEY` in the *backend terminal* (`set GEMINI_API_KEY=...`) before starting Uvicorn. Never place keys in Vite environment variables or commit them to GitHub.

**Window 2 — frontend:**

```bat
cd /d "C:\path\to\docchat-constellation\frontend"
npm install
npm run dev
```

Visit http://localhost:5173. The Vite development server forwards `/api/*` to port 8000.

## Features introduced in Stage 3

- PDF/DOCX/TXT upload via drag/drop, click, and keyboard; multiple selection; cumulative 15 MB check; duplicate and empty-file validation; real network upload progress; server indexing state; document list, file metadata and removal.
- Chat uses the real `/api/chat` SSE endpoint: retrieved passages, evidence/Gemini mode, token chunks, warnings, and done events. Markdown/GFM with copyable code, copy answers, suggested questions from `/api/insights`, stop generation, and regenerate last question.
- Multi-file reindexing resets server-side chat history; the UI resets accordingly. No documents or API secrets are stored in localStorage (only UI preferences).

## GitHub and production plan

Your existing GitHub repository (`bhumisingh-tech/docchat-rag`) uses Streamlit and powers `docchat-bhumi.streamlit.app`. **Do not overwrite its `main` branch yet.** Keep that deployment live until the full app is tested.

For now you may create a `constellation-dev` branch via GitHub website or local Git and copy this project into it. Avoid copying `node_modules`, `.env`, Python caches or built artifacts. With the new project in a Git clone:

```bat
git checkout -b constellation-dev
git add .
git commit -m "Add Constellation FastAPI and React stage 5"
git push -u origin constellation-dev
```

**Render one-link deployment:** The included multi-stage Dockerfile builds Vite and serves `frontend/dist` from FastAPI. Follow [DEPLOYMENT.md](DEPLOYMENT.md) before deploying; no live deployment has been executed. Stage 3 backend already contains static-file serving logic, but the React app should be completed and production-tested before deploying.

## Troubleshooting

- Vite `/api/health ECONNREFUSED`: start the backend on port 8000 in a second terminal.
- `gemini_configured: false`: expected in keyless evidence-only mode.
- `No module named uvicorn`: run `py -m pip install -r requirements.txt` again inside the backend folder; `requirements.txt` deliberately installs plain `uvicorn` rather than optional `uvicorn[standard]` to avoid PyYAML compilation issues on new Python versions.
- `Session not found`: server was restarted; upload documents again (sessions are in memory).
- Scanned PDFs without selectable text are not OCR-supported by the preserved extraction logic.

## Stage 4 — Citation trail and constellation map

Citation chips in chat answers (for example `[Source 1]`) are genuine links to the
retrieved evidence, not generated placeholders. Hover to preview; click to open
the evidence drawer, which shows the exact source, passage ID, original text,
question-keyword highlights and cosine relevance. "Locate star" jumps to the
map and focuses its corresponding indexed passage.

The Constellation panel lazy-loads its React module and obtains actual passage
coordinates from `GET /api/map`. It uses the backend's existing TF-IDF matrix
and TruncatedSVD projection; the first two dimensions are a *visual semantic
projection*, not a claim of spatial distance or mathematical accuracy beyond
that projection. Stars are colored by document, with query point and glowing
retrieval links. Filter by file, scroll to zoom, drag to pan, select stars to
pin them, or use keyboard Tab + Enter. Source citations are scoped to each
answer. On mobile use the Map tab; on mid-sized screens use the map icon in
the header. No API key is required.

### Test Stage 4 locally

1. Start FastAPI and Vite using the commands above. Upload a text-rich TXT,
   PDF, or DOCX file and ask a question about its contents.
2. Check that `[Source N]` references (when present in an answer) are clickable
   and match the evidence cards shown beneath the answer.
3. Click a citation, verify filename, relevance score and keyword highlights.
4. Choose **Locate star**, then filter files, zoom/pan and pin a passage.
5. Ask a new question. The map's highlighted star IDs should update to match
   the retrieved evidence; summary questions intentionally select early passages.
6. Check 360px phone layout, light theme, keyboard focus, and reduced motion.

Stage 4 source files added:

- `frontend/src/components/citations/CitationCards.tsx`
- `frontend/src/components/constellation/ConstellationMap.tsx`

Modified: `frontend/src/components/chat/MarkdownAnswer.tsx`,
`frontend/src/components/chat/StreamingChat.tsx`, `frontend/src/App.tsx`,
`frontend/src/styles/globals.css`. Backend RAG retrieval is unchanged.

**Deployment:** Do not overwrite the existing Streamlit site. Docker and deployment instructions are in [DEPLOYMENT.md](DEPLOYMENT.md).


## Stage 5 — Insights, controls, export and print

- **Insights:** Open the Insights tab in the desktop observatory, in the tablet-size drawer, or from the mobile navigation. Statistics, extractive overview, top TF-IDF terms, and per-file counts are fetched from `/api/insights` for the active in-memory session. Click any keyword to ask the chat about that term. The overview is *extractive*, not an AI-generated abstractive summary.
- **Controls:** Use the slider/settings icon in the top header (or `Ctrl+,` / `Cmd+,`) to change `top_k` (2–8), dark/light mode, system/reduced/full motion, inspect the current Gemini/evidence mode, and clear the conversation. Preferences survive reload in localStorage; the session and documents do not.
- **Exports:** Open the Export tab after getting an answer. Download full server Markdown including evidence citations and passage excerpts; copy conversation text; or click *Save as PDF* to open the browser print dialog and choose *Save as PDF*. The print-only layout includes full questions, answers and sources even if the chat scrolls. There is no public sharing link because sessions are in-memory and no user authentication exists; export and copy provide portable sharing instead.
- **Responsive:** On narrow screens the bottom navigation offers Library, Chat, Map, Insights, and Export. On intermediate viewports there are header shortcuts to the side panel. Desktop has tabs for the observatory.

### Stage 5 test checklist

1. Install dependencies and run `npm run typecheck && npm run build` in `frontend`. Start both local servers.
2. Upload a text-rich document. View Insights and check file/word/passage counts. Choose a keyword and confirm a new query is sent.
3. Change the source count from 5 to 3, refresh the page and reopen controls: 3 should persist. Sessions won't persist through backend restarts.
4. Switch light/dark, select Reduce motion, and test that the UI respects the changes.
5. Ask two questions, download the Markdown export, and verify questions, answers, citation names, scores, and passage texts.
6. Click Save as PDF, choose the browser's PDF destination, and verify the print preview contains all answers.
7. Clear the chat; verify Markdown export is disabled and uploaded documents remain.
8. Test 360 px width using browser responsive tools; navigate all five mobile tabs, keyboard focus and settings dialog.

### Current limitations

- Gemini responds using the preserved synchronous original function; SSE delivers the completed response in chunks. It is not native upstream token streaming.
- PDF is exported through the standard browser print-to-PDF dialog; it is not generated by the FastAPI server.
- Session data and history are in memory only; restarting FastAPI or losing the browser session loses the conversation.
- No public link sharing exists without a persistent storage/authentication system.
- Python endpoint smoke tests passed, but a complete local React production build still must be verified where `npm install` can reach dependencies.


## Stage 6 — Production packaging

- `Dockerfile`: Node 22 builds Vite; Python 3.12 runs FastAPI and serves the assets on Render’s `$PORT`.
- `.dockerignore`: excludes local data, dependencies, caches and secrets.
- `render.yaml`: optional Render Blueprint.
- `scripts/smoke_test.py`: keyless API integration checks.
- `DEPLOYMENT.md`: Windows commands, safe GitHub migration, Render instructions, QA checklist and troubleshooting.

**Verification:** Backend smoke tests passed. A real frontend production build and Docker/Render deployment were not completed in this environment.
