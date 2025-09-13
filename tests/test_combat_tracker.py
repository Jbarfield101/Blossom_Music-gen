import threading
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

import combat_tracker as ct


def setup_module(module):
    ct.init_db(':memory:')


def test_update_stat_adjusts_value():
    enc = ct.create_encounter('test')
    ct.add_participant(enc, 'Alice', {'hp': 10})
    ct.update_stat('Alice', 'hp', -3, enc)
    status = ct.get_status(enc)
    assert status['Alice']['hp'] == 7


def test_concurrent_updates():
    enc = ct.create_encounter('concurrent')
    ct.add_participant(enc, 'Bob', {'hp': 0})

    def worker():
        for _ in range(100):
            ct.update_stat('Bob', 'hp', 1, enc)

    threads = [threading.Thread(target=worker) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    status = ct.get_status(enc)
    assert status['Bob']['hp'] == 1000
