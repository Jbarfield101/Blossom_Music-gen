import os, sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.utils import ensure_file


def test_ensure_file_rejects_directory(tmp_path):
    directory = tmp_path / "subdir"
    directory.mkdir()
    with pytest.raises(FileNotFoundError, match="directory"):
        ensure_file(directory)
