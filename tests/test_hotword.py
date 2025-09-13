from pathlib import Path
from importlib import reload


def test_list_and_set_hotwords(tmp_path, monkeypatch):
    models_dir = tmp_path / "hotwords"
    models_dir.mkdir()
    (models_dir / "alpha.tflite").write_text("dummy")
    (models_dir / "beta.onnx").write_text("dummy")
    cfg_file = models_dir / "hotwords.json"
    monkeypatch.setenv("BLOSSOM_HOTWORD_DIR", str(models_dir))
    monkeypatch.setenv("BLOSSOM_HOTWORD_CONFIG", str(cfg_file))
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))

    import ears.hotword as hotword
    reload(hotword)

    cfg = hotword.list_hotwords()
    assert cfg == {"alpha": False, "beta": False}

    hotword.set_hotword("alpha", True)
    cfg2 = hotword.list_hotwords()
    assert cfg2["alpha"] is True and cfg2["beta"] is False
