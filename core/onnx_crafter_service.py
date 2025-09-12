from __future__ import annotations

"""ONNX-based song crafter utilities.

This module provides a small service layer around exported ONNX models.
It exposes helpers for encoding/decoding token sequences, running
sampling loops, and a CLI entry point intended for use by the Tauri
frontend.  The design is intentionally lightweight – globals are used to
store the active :class:`onnxruntime.InferenceSession` so that successive
calls can reuse the loaded model.
"""

from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Tuple
import argparse
import json
import signal
import sys
import time

import numpy as np

from . import midi_load, event_vocab
from .stems import Stem, beats_to_secs
from .midi_export import stems_to_midi
from .song_spec import SongSpec
from .sampling import sample as sample_token

__all__ = [
    "load_session",
    "encode_midi",
    "encode_songspec",
    "generate",
    "decode_to_midi",
    "main",
]

# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

_SESSION = None  # type: ignore[assignment]
_IO_SCHEMA: Dict[str, List[str]] | None = None
_LAST_TELEMETRY: Dict[str, Any] = {}
_CANCELLED = False


def load_session(model_dir: str | Path) -> Tuple[object, Dict[str, List[str]]]:
    """Load an ONNX model and cache its input/output schema.

    Parameters
    ----------
    model_dir:
        Path to either a directory containing an ``.onnx`` file or a direct
        path to an ONNX graph.

    Returns
    -------
    sess, io_schema:
        The loaded :class:`onnxruntime.InferenceSession` and a mapping with
        ``"inputs"``/``"outputs"`` name lists.
    """

    import onnxruntime as ort  # type: ignore

    path = Path(model_dir)
    if path.is_dir():
        candidates = list(path.glob("*.onnx"))
        if not candidates:
            raise FileNotFoundError(f"No ONNX model found in {path}")
        path = candidates[0]

    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    sess = ort.InferenceSession(str(path), providers=providers)
    io_schema = {
        "inputs": [i.name for i in sess.get_inputs()],
        "outputs": [o.name for o in sess.get_outputs()],
    }

    global _SESSION, _IO_SCHEMA
    _SESSION = sess
    _IO_SCHEMA = io_schema
    return sess, io_schema


# ---------------------------------------------------------------------------
# Encoding helpers
# ---------------------------------------------------------------------------

def _flatten(pairs: Iterable[Tuple[int, int]]) -> List[int]:
    out: List[int] = []
    for tok, val in pairs:
        out.extend([int(tok), int(val)])
    return out


def encode_midi(path: str | Path) -> List[int]:
    """Encode a melody MIDI file into a flat token list."""

    notes_sec, tempo, meter = midi_load.load_melody_midi(path)
    sec_per_beat = beats_to_secs(tempo)
    notes = [
        Stem(
            start=n.start / sec_per_beat,
            dur=n.dur / sec_per_beat,
            pitch=n.pitch,
            vel=n.vel,
            chan=n.chan,
        )
        for n in notes_sec
    ]
    tokens = event_vocab.encode(
        notes,
        section="A",
        meter=meter,
        density=0.5,
        chord="C",
        seed=0,
    )
    return _flatten(tokens)


def encode_songspec(song_spec: Any) -> List[int]:
    """Convert a chord grid or :class:`SongSpec` into token IDs.

    The function accepts a variety of inputs:

    - a :class:`SongSpec` instance
    - a path to a JSON ``SongSpec`` template
    - a mapping suitable for :meth:`SongSpec.from_dict`
    - a simple iterable of chord strings
    """

    if isinstance(song_spec, SongSpec):
        chords = song_spec.all_chords()
    elif isinstance(song_spec, (str, Path)):
        chords = SongSpec.from_json(str(song_spec)).all_chords()
    elif isinstance(song_spec, dict):
        chords = SongSpec.from_dict(song_spec).all_chords()
    else:
        chords = [str(c) for c in song_spec]

    tokens: List[int] = []
    for ch in chords:
        tok = event_vocab.CHORD_TO_ID.get(str(ch), 0)
        tokens.extend([event_vocab.CHORD, tok])
    return tokens


# ---------------------------------------------------------------------------
# Generation / decoding
# ---------------------------------------------------------------------------

def generate(tokens: List[int], steps: int, sampling: Dict[str, Any]) -> List[int]:
    """Run autoregressive generation using the loaded ONNX model.

    ``sampling`` may contain ``top_k``, ``top_p`` and ``temperature`` fields.
    Telemetry (``tokens_per_sec``, ``device``, ``time``) is stored in the
    module-level ``_LAST_TELEMETRY`` mapping for later inspection.
    """

    if _SESSION is None or _IO_SCHEMA is None:
        raise RuntimeError("Model session not loaded; call load_session() first")

    history = list(tokens)
    input_name = _IO_SCHEMA["inputs"][0]
    output_name = _IO_SCHEMA["outputs"][0]
    providers = _SESSION.get_providers()
    device = providers[0] if providers else "CPU"
    rng = np.random.default_rng()

    top_k = int(sampling.get("top_k", 0))
    top_p = float(sampling.get("top_p", 0.0))
    temperature = float(sampling.get("temperature", 1.0))

    start = time.time()
    for i in range(int(steps)):
        if _CANCELLED:
            break
        inp = np.array(history, dtype=np.int64)[None, :]
        logits = _SESSION.run([output_name], {input_name: inp})[0][0, -1]
        next_id = sample_token(
            logits,
            top_p=top_p,
            top_k=top_k,
            temperature=temperature,
            history=history,
            rng=rng,
        )
        history.append(int(next_id))
        if steps > 0 and (i + 1) % max(1, steps // 10) == 0:
            print(f"generated {i + 1}/{steps} tokens", flush=True)
    total = time.time() - start

    global _LAST_TELEMETRY
    new_tokens = len(history) - len(tokens)
    _LAST_TELEMETRY = {
        "tokens_per_sec": float(new_tokens) / total if total > 0 else 0.0,
        "device": device,
        "time": total,
    }

    return history


def decode_to_midi(tokens: Sequence[int], out_path: str | Path) -> str:
    """Decode flat tokens to a MIDI file and return the path."""

    pairs = list(zip(tokens[0::2], tokens[1::2]))
    notes, meta = event_vocab.decode(pairs)
    meter_beats = meta.get("meter_beats", 4)
    meter = f"{meter_beats}/4"
    stems_to_midi({"melody": notes}, tempo=120.0, meter=meter, path=out_path)
    return str(out_path)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _handle_cancel(signum, frame):  # pragma: no cover - signal handler
    global _CANCELLED
    _CANCELLED = True
    print("received cancel signal", flush=True)


def main(argv: Sequence[str] | None = None) -> None:
    """CLI used by the Tauri frontend.

    The command expects a single JSON argument describing the job.  Example::

        python -m core.onnx_crafter_service '{"model": "models", "steps": 32}'
    """

    signal.signal(signal.SIGINT, _handle_cancel)
    signal.signal(signal.SIGTERM, _handle_cancel)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", help="JSON configuration")
    args = parser.parse_args(argv)

    cfg = json.loads(args.config)
    model = cfg.get("model")
    if model is None:
        raise SystemExit("missing 'model' in config")
    load_session(model)

    if "midi" in cfg:
        tokens = encode_midi(cfg["midi"])
    elif "song_spec" in cfg:
        tokens = encode_songspec(cfg["song_spec"])
    else:
        tokens = list(cfg.get("tokens", []))

    steps = int(cfg.get("steps", 0))
    sampling = cfg.get("sampling", {})

    print("starting generation", flush=True)
    tokens = generate(tokens, steps, sampling)

    out_path = cfg.get("out", "out.mid")
    midi_path = decode_to_midi(tokens, out_path)

    result = {"midi": midi_path, "telemetry": _LAST_TELEMETRY}
    print(json.dumps(result))


if __name__ == "__main__":  # pragma: no cover - CLI entry
    main()
