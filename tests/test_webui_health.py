import os, sys
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from webui.app import app

def test_health_check():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_generate_page_served():
    client = TestClient(app)
    response = client.get("/generate")
    assert response.status_code == 200
    assert "Blossom Render" in response.text
