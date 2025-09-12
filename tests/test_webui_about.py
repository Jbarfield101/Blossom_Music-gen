import os, sys, types
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

multipart_mod = types.ModuleType("multipart")
multipart_submod = types.ModuleType("multipart.multipart")
multipart_mod.__version__ = "0"


def parse_options_header(value: str) -> tuple[str, dict[str, str]]:
    return value, {}


multipart_submod.parse_options_header = parse_options_header
sys.modules.setdefault("multipart", multipart_mod)
sys.modules.setdefault("multipart.multipart", multipart_submod)

from webui.app import app


def test_about_endpoint():
    client = TestClient(app)
    resp = client.get("/about")
    assert resp.status_code == 200
    assert resp.json() == {"python": sys.version}
