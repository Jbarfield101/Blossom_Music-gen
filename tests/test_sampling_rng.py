import numpy as np
from core.sampling import sample


def test_sample_rng_seed_reproducibility():
    logits = np.array([1.0, 3.0], dtype=np.float32)
    rng1 = np.random.default_rng(42)
    rng2 = np.random.default_rng(42)
    assert sample(logits, rng=rng1) == sample(logits, rng=rng2)
