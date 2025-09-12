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

from webui.app import app  # noqa: E402
from config import obsidian  # noqa: E402


def _reset_vault() -> None:
    # Helper to clear any persisted vault path between tests
    if obsidian.VAULT_FILE.exists():
        obsidian.VAULT_FILE.unlink()
    # Reset in-memory cache
    if "_VAULT_PATH" in obsidian.__dict__:
        obsidian.__dict__["_VAULT_PATH"] = None



def test_set_vault(tmp_path):
    _reset_vault()
    client = TestClient(app)
    resp = client.post("/obsidian/vault", json={"path": str(tmp_path)})
    assert resp.status_code == 200
    assert resp.json() == {"vault": str(tmp_path.resolve())}

    # Second attempt should fail
    resp = client.post("/obsidian/vault", json={"path": str(tmp_path)})
    assert resp.status_code == 400



def test_set_vault_missing(tmp_path):
    _reset_vault()
    client = TestClient(app)
    missing = tmp_path / "does-not-exist"
    resp = client.post("/obsidian/vault", json={"path": str(missing)})
    assert resp.status_code == 404
