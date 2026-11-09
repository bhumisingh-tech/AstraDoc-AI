# AstraDoc branding kit for docchat-constellation

**Brand:** AstraDoc  
**Descriptor:** AI-Powered Document Intelligence  
**Tagline:** Turn Documents Into Conversations.  
**Microcopy:** ASK • EXPLORE • DISCOVER

This is a **visual/text rebrand only**. It does not change retrieval, Gemini, storage, authentication, upload limits, API routes, Render configuration, or the repository name.

## Apply
1. Download or clone `https://github.com/bhumisingh-tech/docchat-constellation`.
2. Run `python apply_branding.py /path/to/docchat-constellation` (Windows: `py apply_branding.py C:\\path\\to\\docchat-constellation`).
3. Run `cd frontend`, `npm ci`, `npm run build`.
4. Review the changes and commit/push via an account with write access.

### Files changed by the script
- `frontend/src/App.tsx` — app header, eyebrow label, footer
- `frontend/index.html` — title, SEO metadata, favicon link
- `frontend/public/astradoc-icon.svg` — new favicon

### Intentionally unchanged
- `constellation:theme` localStorage key for backwards compatibility
- Constellation map and visualization terminology
- GitHub repository URL and Render service URL
- `README.md` technical documentation, backend modules, and tests

The GitHub connection used to prepare this kit had read-only permissions; nothing was pushed to the repository.
