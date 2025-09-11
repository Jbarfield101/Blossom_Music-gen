import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import numpy as np
import pytest

from core.sampling import filter_top_k_top_p


def test_filter_top_k_negative():
    logits = np.array([1.0, 2.0])
    with pytest.raises(ValueError):
        filter_top_k_top_p(logits, top_k=-1, top_p=0.0)


@pytest.mark.parametrize("top_p", [-0.1, 1.1])
def test_filter_top_k_top_p_invalid_range(top_p):
    logits = np.array([1.0, 2.0])
    with pytest.raises(ValueError):
        filter_top_k_top_p(logits, top_k=0, top_p=top_p)
