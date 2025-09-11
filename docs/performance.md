# Performance Benchmark

The test suite includes `tests/test_performance.py` which renders a minimal song
specification and checks that the process finishes within a fixed time budget.
The default budget is defined by `DEFAULT_TIME_BUDGET` in the test and can be
overridden with the `BLOSSOM_PERF_BUDGET` environment variable:

```bash
BLOSSOM_PERF_BUDGET=5 pytest tests/test_performance.py
```

## Updating the baseline

When the rendering chain changes or is optimised, update the baseline time
budget:

1. Run the benchmark and note the reported runtime:
   ```bash
   pytest tests/test_performance.py --durations=1 -vv
   ```
2. Adjust `DEFAULT_TIME_BUDGET` in `tests/test_performance.py` to a value just
   above the observed runtime, leaving some headroom.
3. Commit the updated budget alongside the performance changes.
