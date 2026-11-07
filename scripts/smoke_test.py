"""Check the real FastAPI API without Gemini or a running server.

Run from project root after pip install -r backend/requirements.txt:
    python scripts/smoke_test.py
"""
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

from fastapi.testclient import TestClient
from main import app, sessions


def main():
    with TestClient(app) as client:
        health = client.get('/api/health')
        assert health.status_code == 200, health.text
        assert health.json()['status'] == 'ok'
        upload = client.post('/api/upload', files={
            'files': ('facts.txt', io.BytesIO(b'Bhumi builds a document Q&A system. The engine retrieves text with TF-IDF and cosine similarity. The interface displays source citations.'), 'text/plain')
        })
        assert upload.status_code == 200, upload.text
        data = upload.json()
        sid = data['session_id']
        assert data['passage_count'] >= 1
        insights = client.get('/api/insights', params={'session_id': sid})
        assert insights.status_code == 200, insights.text
        assert insights.json()['stats']['files'] == 1
        mapping = client.get('/api/map', params={'session_id': sid, 'question': 'What does the engine use?'})
        assert mapping.status_code == 200, mapping.text
        assert len(mapping.json()['points']) == data['passage_count']
        # Force evidence mode without a Gemini API call, independently of the environment.
        import os
        previous = os.environ.pop('GEMINI_API_KEY', None)
        try:
            with client.stream('POST', '/api/chat', json={'session_id': sid, 'question': 'What retrieves text?', 'top_k': 5}) as stream:
                body = ''.join(stream.iter_text())
                assert stream.status_code == 200, body
                assert 'event: sources' in body and 'event: token' in body and 'event: done' in body, body
            export = client.get('/api/export', params={'session_id': sid})
            assert export.status_code == 200, export.text
            assert 'What retrieves text?' in export.text and '[Source 1]' in export.text
            cleared = client.delete('/api/chat', params={'session_id': sid})
            assert cleared.status_code == 200
            assert 'What retrieves text?' not in client.get('/api/export', params={'session_id': sid}).text
            removed = client.delete('/api/files/facts.txt', params={'session_id': sid})
            assert removed.status_code == 200 and removed.json()['session_id'] is None
        finally:
            if previous is not None:
                os.environ['GEMINI_API_KEY'] = previous
            sessions.pop(sid, None)
    print('PASS: health, upload, insights, map, evidence SSE, export, clear, remove')


if __name__ == '__main__':
    main()
