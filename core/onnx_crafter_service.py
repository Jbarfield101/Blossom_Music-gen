from __future__ import annotations

"""ONNX-based song crafter utilities.

This module provides a small service layer around exported ONNX models.
It exposes helpers for encoding/decoding token sequences, running
sampling loops, and a CLI entry point intended for use by the Tauri
frontend.  Previously this module relied on module-level globals to cache
the active :class:`onnxruntime.InferenceSession` and track generation
state.  The globals made concurrent use and testing awkward, so the
functionality is now encapsulated in :class:`ModelSession`, which manages
its own inference session, telemetry and cancellation state.
"""

from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Tuple, Callable
import argparse
import json
import signal
import time
import base64
import tempfile

import numpy as np

from . import midi_load, event_vocab
from .paths import MODEL_DIR
from .stems import Stem, beats_to_secs
from .midi_export import stems_to_midi
from .song_spec import SongSpec
from .sampling import sample as sample_token

__all__ = [
    "ModelSession",
    "encode_midi",
    "encode_songspec",
    "main",
]

class ModelSession:
    """Encapsulates an ONNX model session and generation state.

    The class wraps :class:`onnxruntime.InferenceSession` and stores its
    I/O schema, telemetry and cancellation flag so that multiple sessions
    can coexist without interfering with one another.
    """

    def __init__(self) -> None:
        self.sess = None  # type: ignore[assignment]
        self.io_schema: Dict[str, List[str]] | None = None
        self.telemetry: Dict[str, Any] = {}
        self.cancelled = False

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------
    def load_session(self, model_path: str | Path | None = None) -> Tuple[object, Dict[str, List[str]]]:
        """Load an ONNX model and cache its input/output schema.

        Parameters
        ----------
        model_path:
            Optional path to a model file or a directory containing one or more
            ``.onnx`` files.  If omitted, :data:`~core.paths.MODEL_DIR` is used.

        Returns
        -------
        sess, io_schema:
            The loaded :class:`onnxruntime.InferenceSession` and a mapping with
            ``"inputs"``/``"outputs"`` name lists.
        """

        import onnxruntime as ort  # type: ignore

        if model_path is None:
            path = MODEL_DIR
        else:
            path = Path(model_path)
            if not path.exists():
                alt = MODEL_DIR / path
                if alt.exists():
                    path = alt
                else:
                    raise FileNotFoundError(f"Model path does not exist: {model_path}")

        if path.is_dir():
            candidates = sorted(path.rglob("*.onnx"))
            if not candidates:
                raise FileNotFoundError(f"No .onnx files found in directory: {path}")
            path = candidates[0]
        elif path.is_file():
            if path.suffix != ".onnx":
                raise FileNotFoundError(f"Expected .onnx model file: {path}")
        else:
            raise FileNotFoundError(f"Invalid model path: {path}")

        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        sess = ort.InferenceSession(str(path), providers=providers)
        io_schema = {
            "inputs": [i.name for i in sess.get_inputs()],
            "outputs": [o.name for o in sess.get_outputs()],
        }

        self.sess = sess
        self.io_schema = io_schema
        return sess, io_schema

    # ------------------------------------------------------------------
    # Generation / decoding
    # ------------------------------------------------------------------
    def generate(
        self,
        tokens: List[int],
        steps: int,
        sampling: Dict[str, Any],
        progress_cb: Callable[[Dict[str, int]], None] | None = None,
    ) -> List[int]:
        """Run autoregressive generation using the loaded ONNX model.

        ``sampling`` may contain ``top_k``, ``top_p`` and ``temperature`` fields.
        Telemetry (``tokens_per_sec``, ``device``, ``time``) is stored on the
        instance ``telemetry`` mapping for later inspection.
        """

        if self.sess is None or self.io_schema is None:
            raise RuntimeError("Model session not loaded; call load_session() first")

        history = list(tokens)
        input_name = self.io_schema["inputs"][0]
        output_name = self.io_schema["outputs"][0]
        providers = self.sess.get_providers()
        device = providers[0] if providers else "CPU"
        rng = np.random.default_rng()

        top_k = int(sampling.get("top_k", 0))
        top_p = float(sampling.get("top_p", 0.0))
        temperature = float(sampling.get("temperature", 1.0))

        start = time.time()
        step_times: List[float] = []
        for i in range(int(steps)):
            if self.cancelled:
                break
            step_start = time.time()
            inp = np.array(history, dtype=np.int64)[None, :]
            logits = self.sess.run([output_name], {input_name: inp})[0][0, -1]
            next_id = sample_token(
                logits,
                top_p=top_p,
                top_k=top_k,
                temperature=temperature,
                history=history,
                rng=rng,
            )
            history.append(int(next_id))
            step_end = time.time()
            step_times.append(step_end - step_start)
            if progress_cb is not None and steps > 0 and (i + 1) % max(1, steps // 10) == 0:
                avg = sum(step_times) / len(step_times)
                remaining = avg * (steps - (i + 1))
                progress_cb(
                    {
                        "step": i + 1,
                        "total": steps,
                        "eta": f"{int(remaining)}",
                    }
                )
        total = time.time() - start

        new_tokens = len(history) - len(tokens)
        self.telemetry = {
            "tokens_per_sec": float(new_tokens) / total if total > 0 else 0.0,
            "device": device,
            "time": total,
            "step_times": step_times,
        }

        return history

    def decode_to_midi(self, tokens: Sequence[int], out_path: str | Path) -> str:
        """Decode flat tokens to a MIDI file and return the path."""

        pairs = list(zip(tokens[0::2], tokens[1::2]))
        notes, meta = event_vocab.decode(pairs)
        meter_beats = meta.get("meter_beats", 4)
        meter = f"{meter_beats}/4"
        stems_to_midi({"melody": notes}, tempo=120.0, meter=meter, path=out_path)
        return str(out_path)

    # ------------------------------------------------------------------
    # Cancellation handling
    # ------------------------------------------------------------------
    def cancel(self, signum, frame) -> None:  # pragma: no cover - signal handler
        self.cancelled = True
        print("received cancel signal", flush=True)


# ---------------------------------------------------------------------------
# Encoding helpers
# ---------------------------------------------------------------------------

def _flatten(pairs: Iterable[Tuple[int, int]]) -> List[int]:
    out: List[int] = []
    for tok, val in pairs:
        out.extend([int(tok), int(val)])
    return out


def encode_midi(src: str | Path) -> List[int]:
    """Encode a melody MIDI file into a flat token list.

    ``src`` may be a file path or a ``data:`` URI containing base64-encoded
    MIDI data.
    """

    tmp_path = None
    if isinstance(src, str) and src.startswith("data:"):
        header, b64 = src.split(",", 1)
        data = base64.b64decode(b64)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mid") as fh:
            fh.write(data)
            tmp_path = fh.name
        path = tmp_path
    else:
        path = src

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
    if tmp_path is not None:
        Path(tmp_path).unlink(missing_ok=True)
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
# CLI entry point
# ---------------------------------------------------------------------------

def main(argv: Sequence[str] | None = None) -> None:
    """CLI used by the Tauri frontend.

    The command expects a single JSON argument describing the job.  Example::

        python -m core.onnx_crafter_service '{"model": "models", "steps": 32}'
    """

    # Instantiate a fresh session for each invocation so that generation
    # state and telemetry remain isolated per job.
    session = ModelSession()
    signal.signal(signal.SIGINT, session.cancel)
    signal.signal(signal.SIGTERM, session.cancel)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", help="JSON configuration")
    args = parser.parse_args(argv)

    cfg = json.loads(args.config)
    model = cfg.get("model")
    if model is None:
        raise SystemExit("missing 'model' in config")
    try:
        session.load_session(model)
    except FileNotFoundError as exc:
        import sys
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        raise SystemExit(1)

    if "midi" in cfg:
        tokens = encode_midi(cfg["midi"])
    elif "song_spec" in cfg:
        tokens = encode_songspec(cfg["song_spec"])
    else:
        tokens = list(cfg.get("tokens", []))

    steps = int(cfg.get("steps", 0))
    sampling = cfg.get("sampling", {})

    def emit(event: Dict[str, int]) -> None:
        print(json.dumps(event), flush=True)

    tokens = session.generate(tokens, steps, sampling, progress_cb=emit)

    out_path = Path(cfg.get("out", "out.mid")).expanduser()
    session.decode_to_midi(tokens, out_path)

    result = {"midi": str(out_path), "telemetry": session.telemetry}
    print(json.dumps(result))


if __name__ == "__main__":  # pragma: no cover - CLI entry
    main()
