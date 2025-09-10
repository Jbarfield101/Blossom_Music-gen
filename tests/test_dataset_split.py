import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from data.build_dataset import split_train_val


def test_deterministic_split():
    items = list(range(10))
    train1, val1 = split_train_val(items, val_ratio=0.3, seed=123)
    train2, val2 = split_train_val(items, val_ratio=0.3, seed=123)
    assert train1 == train2
    assert val1 == val2
