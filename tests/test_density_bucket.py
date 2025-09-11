import os, sys, pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.utils import density_bucket_from_float


def test_density_bucket_sparse():
    assert density_bucket_from_float(0.2) == "sparse"


def test_density_bucket_med():
    assert density_bucket_from_float(0.5) == "med"


def test_density_bucket_busy():
    assert density_bucket_from_float(0.9) == "busy"


def test_density_bucket_malformed_input_defaults_to_med():
    assert density_bucket_from_float("not-a-number") == "med"
