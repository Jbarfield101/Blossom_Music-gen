import io
import json
import importlib.util
from pathlib import Path
import sys
import types

MODULE_PATH = Path(__file__).resolve().parent.parent / "scripts" / "dnd_repair_helper.py"
REPO_ROOT = MODULE_PATH.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _load_helper(monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "scripts.dnd_repair_helper", MODULE_PATH
    )
    assert spec and spec.loader

    ollama_client_stub = types.ModuleType("brain.ollama_client")
    ollama_client_stub.generate = lambda prompt: ""
    monkeypatch.setitem(sys.modules, "brain.ollama_client", ollama_client_stub)

    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    return module


def test_main_handles_missing_vault(monkeypatch, tmp_path):
    dnd_repair_helper = _load_helper(monkeypatch)

    request = {"run_id": 73, "npc_ids": ["npc_alpha", "npc_beta"]}
    stdin = io.StringIO(json.dumps(request))
    stdout = io.StringIO()

    monkeypatch.setattr(dnd_repair_helper.sys, "stdin", stdin)
    monkeypatch.setattr(dnd_repair_helper.sys, "stdout", stdout)

    missing_root = tmp_path / "missing"
    monkeypatch.setattr(
        dnd_repair_helper, "DEFAULT_DREADHAVEN_ROOT", missing_root, raising=False
    )

    result = dnd_repair_helper.main()

    assert result == 0

    lines = [json.loads(line) for line in stdout.getvalue().splitlines() if line]
    assert len(lines) == len(request["npc_ids"]) + 2
    assert lines[0] == {"run_id": request["run_id"], "status": "started", "total": 2}

    expected_error = (
        "DreadHaven vault not found at "
        f"{missing_root.expanduser().resolve()}. Configure DEFAULT_DREADHAVEN_ROOT before running repairs."
    )

    failure_events = lines[1:-1]
    for event, npc_id in zip(failure_events, request["npc_ids"]):
        assert event["run_id"] == request["run_id"]
        assert event["npc_id"] == npc_id
        assert event["status"] == "failed"
        assert event["error"] == expected_error
        assert event["message"] == "Vault not found"
        assert event["updated"] is False

    summary_event = lines[-1]
    assert summary_event["status"] == "completed"
    assert summary_event["run_id"] == request["run_id"]

    summary = summary_event["summary"]
    assert summary["failed"] == request["npc_ids"]
    assert summary["verified"] == []
    assert summary["errors"] == {
        npc_id: expected_error for npc_id in request["npc_ids"]
    }
    assert summary["status_map"] == {
        npc_id: "failed" for npc_id in request["npc_ids"]
    }
    assert summary["total"] == len(request["npc_ids"])
    assert summary["requested"] == request["npc_ids"]
