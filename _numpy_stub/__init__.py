from typing import Iterable

class ndarray(list):
    """Very small subset of numpy's ndarray."""
    @property
    def shape(self):
        return (len(self),)


def array(seq: Iterable, dtype=float):
    return ndarray(dtype(x) for x in seq)


def zeros(length: int, dtype=float):
    return array([0]*length, dtype=dtype)
