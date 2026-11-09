#!/usr/bin/env python3
"""Apply AstraDoc visual rebrand to an existing docchat-constellation checkout.
Usage: python apply_branding.py /path/to/docchat-constellation
"""
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
app = root/'frontend/src/App.tsx'
html = root/'frontend/index.html'
for p in (app,html):
    if not p.exists():
        raise SystemExit(f'Missing {p}; pass the root of the repository.')

def change(path, old, new):
    s=path.read_text(encoding='utf-8')
    if old not in s:
        if new in s:
            print(f'Already applied: {path.name}: {new[:40]}')
            return
        raise SystemExit(f'Expected source text absent in {path}: {old[:80]}')
    path.write_text(s.replace(old,new), encoding='utf-8')

change(app, 'DocChat <span className="gradient-text">Bhumi</span>', 'Astra<span className="gradient-text">Doc</span>')
change(app, '<p className="eyebrow text-[9px]">CONSTELLATION</p>', '<p className="eyebrow text-[9px]">AI DOCUMENT INTELLIGENCE</p>')
change(app, '<span>DOCCHAT CONSTELLATION</span>', '<span>ASTRADOC · ASK • EXPLORE • DISCOVER</span>')
change(html, '<title>DocChat Bhumi · Constellation</title>', '<title>AstraDoc | AI-Powered Document Intelligence</title>')
change(html, 'DocChat Bhumi: turn documents into a constellation of grounded answers.', 'AstraDoc: turn documents into conversations with AI-powered, evidence-grounded answers.')
change(html, '<meta name="theme-color" content="#05060D" />', '<meta name="theme-color" content="#05060D" />\n    <meta name="application-name" content="AstraDoc" />\n    <meta property="og:title" content="AstraDoc | AI-Powered Document Intelligence" />\n    <meta property="og:description" content="Turn Documents Into Conversations." />\n    <link rel="icon" type="image/svg+xml" href="/astradoc-icon.svg" />')

public = root/'frontend/public'
public.mkdir(parents=True,exist_ok=True)
icon = public/'astradoc-icon.svg'
icon.write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="AstraDoc icon">
<defs><linearGradient id="a" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#68E1F7"/><stop offset="1" stop-color="#9D76FF"/></linearGradient></defs>
<rect width="64" height="64" rx="17" fill="#080D1D"/>
<ellipse cx="32" cy="32" rx="23" ry="10" fill="none" stroke="url(#a)" stroke-width="2.7" transform="rotate(-35 32 32)"/>
<path d="M24 17h12l6 6v22H24z" fill="#121B35" stroke="#C7D7FF" stroke-width="2.4" stroke-linejoin="round"/>
<path d="M36 17v7h6M29 31h8M29 36h8" fill="none" stroke="#B4C9F8" stroke-width="2.1" stroke-linecap="round"/>
<circle cx="49.5" cy="21" r="4.5" fill="#82D9FF"/>
</svg>''',encoding='utf-8')
print('AstraDoc branding applied to App.tsx and index.html; SVG favicon created.')
print('Next: cd frontend && npm ci && npm run build')
