# DocChat Bhumi Constellation — GitHub + Render deployment

## 1. Preflight (Windows Command Prompt)

Unzip the final ZIP, and open Command Prompt inside `docchat-constellation`.

```bat
cd /d "C:\path\to\docchat-constellation"
py -m pip install -r backend\requirements.txt
py scripts\smoke_test.py
cd frontend
npm install
npm run typecheck
npm run build
cd ..
```

**Do not deploy if the frontend build fails.** In development, start the backend with `cd backend && py -m uvicorn main:app --reload --port 8000`, and separately `cd frontend && npm run dev`. In production, the Docker image builds React and FastAPI serves the built `frontend/dist` itself.

If Docker Desktop is available, verify the same arrangement locally:

```bat
docker build -t docchat-constellation .
docker run --rm -p 10000:10000 docchat-constellation
```

Check `http://localhost:10000/` and `http://localhost:10000/api/health`. To test Gemini locally, optionally pass `-e GEMINI_API_KEY=YOUR_KEY` to `docker run` (avoid entering actual secrets into shared screenshots or git history).

## 2. GitHub migration — do not break existing Streamlit app

Current project: https://github.com/bhumisingh-tech/docchat-rag
Current Streamlit URL: https://docchat-bhumi.streamlit.app/

**Safest route: create a separate new GitHub repository** (for example `docchat-constellation`) and keep the original Streamlit repository and deployment unchanged. In GitHub: `+` → New repository → choose an empty repository (no README). Then run these commands **inside the extracted final `docchat-constellation` directory**, replacing `<GITHUB_USERNAME>` with the account that owns the new repo:

```bat
git init
 git branch -M main
 git add .
 git commit -m "Release DocChat Constellation FastAPI React"
 git remote add origin https://github.com/<GITHUB_USERNAME>/docchat-constellation.git
 git push -u origin main
```

(The spaces before `git` in the example do not affect CMD.) Confirm that GitHub does **not** show `.env`, `node_modules`, `dist`, `__pycache__` or API keys. `.gitignore` excludes these.

**Alternative: keep one repository with two branches.** Clone the original repo into a *new folder*, preserving `main` for Streamlit, then branch:

```bat
git clone https://github.com/bhumisingh-tech/docchat-rag.git
cd docchat-rag
git switch -c constellation
```

Copy the **contents** of the final `docchat-constellation` directory into this clone, retaining the `.git` directory. Commit and push:

```bat
git add .
git commit -m "Add Constellation full-stack rebuild"
git push -u origin constellation
```

In Render select branch `constellation`. Do **not** switch your existing Streamlit deployment to this branch. If you have GitHub file edit access but not Git credentials, upload the project to a new repo through GitHub's Upload files UI; this may require uploading the extracted directory contents in batches.

## 3. Render — one public URL, one service

Official docs: https://render.com/docs/docker and https://render.com/docs/web-services

1. Open https://dashboard.render.com/ and click **New → Web Service**.
2. Connect the **new Constellation repo** (or original repo, branch `constellation`).
3. Set **Language / Runtime: Docker**.
4. **Root Directory:** leave empty (repository root). **Dockerfile Path:** `./Dockerfile`.
5. **Branch:** `main` on the new repo; `constellation` on the original two-branch setup.
6. Choose a region and instance type. **Free** can be used for demos, but is not suitable for production uptime.
7. Under Advanced, set **Health Check Path:** `/api/health`.
8. Environment variables (Runtime → Environment): `GEMINI_MODEL=gemini-2.5-flash`; set `GEMINI_API_KEY` **only if you want Gemini AI**. Leave the key unset for evidence-only mode. Never prefix the key with `VITE_` or commit it.
9. Click **Deploy Web Service**. Render will build Node assets, install Python packages and launch one Uvicorn worker on `$PORT` (normally `10000`). There is no separate frontend service, API URL, or CORS setting.
10. Open your generated `https://<service-name>.onrender.com/` and `/api/health`. Upload a real PDF/TXT/DOCX, ask a question, open a citation, navigate the constellation map, and download a Markdown export. Only after success update any README or portfolio link; keep the Streamlit URL until you intentionally retire it.

Alternatively, `render.yaml` offers a Blueprint describing the same Docker service. The GitHub-to-Render Web Service workflow above requires fewer moving parts for a first deployment.

### Important deployment trade-offs

- **Memory-only sessions:** Uploaded documents, indexes and chats are lost when Render restarts, redeploys or spins down. One process / one worker is required. A browser refresh also does not restore the session ID in this implementation. Never use this for critical document storage or as a production multi-user service without authentication, storage and resource controls.
- **Render Free:** Render spins idle free instances down after about 15 minutes and restart may take about a minute. In-memory sessions disappear across restarts. Capacity is limited and cold-start is expected. See https://render.com/docs/free.
- **Gemini:** Key is exclusively server-side; `GEMINI_API_KEY` is optional. A configured key does not guarantee an AI response: network/model errors fall back to evidence mode.
- **Streaming:** This code sends SSE sources first and then words of a completed Gemini response. The original `rag.py` Gemini function is intentionally unchanged, so there is no upstream token-by-token generation.
- **PDF export:** Browser print dialog → Save as PDF. There is no server-generated PDF endpoint.
- **Uploads:** Combined upload size limit is 15 MB per session; scanned-image PDFs have no OCR.

## 4. Production test checklist

- [ ] `python scripts/smoke_test.py` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes; `frontend/dist/index.html` exists.
- [ ] `docker build` and `docker run` work if Docker Desktop is installed.
- [ ] Render reports live and `/api/health` returns `status: ok`.
- [ ] Home page loads from the **same** Render hostname as `/api/health`.
- [ ] TXT, DOCX, and selectable-text PDF uploads work within 15 MB.
- [ ] Question returns `sources`, `token`, and `done` SSE events; answer is grounded.
- [ ] Click `[Source N]` to open evidence; Locate Star focuses that passage.
- [ ] Map shows real passages, responds to filter/pan/zoom and highlights retrieval.
- [ ] Insights counts and TF-IDF keywords agree with uploaded files.
- [ ] Top-k (2–8), theme, and reduced-motion settings persist across refresh.
- [ ] Markdown export contains the asked questions and citations; browser print can save PDF.
- [ ] Mobile viewport at 360px supports Library, Chat, Map, Insights, Export and controls.
- [ ] Keyboard focus is visible; Tab and Escape work in controls and overlays.
- [ ] Remove a file and verify the index rebuilds; clearing chat preserves docs.
- [ ] Restart Render; confirm the app gracefully asks for documents again (memory-only).
- [ ] Gemini mode works with key if provided; evidence-only mode works without key.
- [ ] No API key appears in the frontend bundle or git commits.

## 5. Ten frequent errors and how to fix them

| # | Symptom | Cause / fix |
|---|---|---|
| 1 | `npm is not recognized` | Install Node LTS, reopen CMD, check `node -v` and `npm -v`. |
| 2 | `No module named uvicorn` | In backend folder: `py -m pip install -r requirements.txt`; start with `py -m uvicorn main:app --reload --port 8000`. |
| 3 | `Failed building wheel for pyyaml` on Windows | Avoid `uvicorn[standard]`; this project already depends on plain `uvicorn`. Use the included requirements. |
| 4 | Vite `/api/health ECONNREFUSED` | Start FastAPI in another terminal on port 8000. Vite's proxy needs the backend. |
| 5 | `Module not found` or `vite: command not found` | Run `npm install` inside `frontend`; run `npm run build` before deploying. |
| 6 | Render `Port scan timeout` / 502 | Docker runs `uvicorn --host 0.0.0.0 --port ${PORT:-10000}`. Confirm Root Directory is repo root, Dockerfile path correct, and inspect Render logs. |
| 7 | Render serves `Frontend is not built yet` | Check that the multi-stage build copied `/app/frontend/dist`; redeploy from repository root using included Dockerfile. |
| 8 | `Session not found` after restart | Expected for in-memory sessions; re-upload files. Keep one worker and add persistence before production use. |
| 9 | `gemini_configured: false` | Normal evidence-only mode; add `GEMINI_API_KEY` in Render Environment for AI mode, never in React/Vite. |
| 10 | PDF is blank / uploaded file rejected | Scanned PDF needs OCR (not supported); ensure selectable text, valid PDF/DOCX/TXT, and combined size ≤15 MB. For Print-to-PDF, select Save as PDF from the browser print dialog. |

## 6. Rollback

If the new site fails, **do not alter the old Streamlit deployment**. Revert the Constellation branch/repo commit or use Render's rollback controls, and keep sharing the existing Streamlit link. GitHub integration permissions are not assumed; follow the commands using an account with repository write access.
