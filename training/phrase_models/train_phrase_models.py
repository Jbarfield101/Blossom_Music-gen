"""Toy training script for phrase generation models.

The original version of this file used small GRU based networks.  In order to
exercise the model loading code in :mod:`core.phrase_model` with something a
little more interesting we now provide tiny Transformer encoder/decoder based
models for drums, bass and keys phrases.  These models are intentionally
light‑weight; they merely serve as stand‑ins for real networks while keeping the
repository free from heavy training requirements.

The exported TorchScript/ONNX artefacts are still compatible with
``core.phrase_model.load_model`` which looks for ``*_phrase.ts.pt`` and
``*_phrase.onnx`` files inside the global ``models/`` directory.
"""

from pathlib import Path
from typing import Sequence, Union

import torch
import torch.nn as nn

from core.sampling import sample

REPO_DIR = Path(__file__).resolve().parents[2]
MODELS_DIR = REPO_DIR / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)


class TransformerEncoder(nn.Module):
    """Very small Transformer encoder used for drum/keys phrases."""

    def __init__(self, input_size: int, hidden: int, output_size: int):
        super().__init__()
        self.in_proj = nn.Linear(input_size, hidden)
        enc_layer = nn.TransformerEncoderLayer(
            hidden, nhead=2, dim_feedforward=hidden * 2, batch_first=True
        )
        self.encoder = nn.TransformerEncoder(enc_layer, num_layers=2)
        self.fc = nn.Linear(hidden, output_size)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.in_proj(x)
        x = self.encoder(x)
        return self.fc(x)


class TransformerDecoder(nn.Module):
    """Very small Transformer decoder used for bass phrases."""

    def __init__(self, input_size: int, hidden: int, output_size: int):
        super().__init__()
        self.in_proj = nn.Linear(input_size, hidden)
        dec_layer = nn.TransformerDecoderLayer(
            hidden, nhead=2, dim_feedforward=hidden * 2, batch_first=True
        )
        self.decoder = nn.TransformerDecoder(dec_layer, num_layers=2)
        self.fc = nn.Linear(hidden, output_size)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Decoder requires a memory tensor – for the toy model we simply use a
        # zero tensor with the same shape as the input.
        x = self.in_proj(x)
        memory = torch.zeros_like(x)
        x = self.decoder(x, memory)
        return self.fc(x)


def synthetic_dataset(n_samples: int, seq_len: int, in_dim: int) -> torch.Tensor:
    """Generates a random tensor to act as training data."""
    return torch.randn(n_samples, seq_len, in_dim)


def train_model(model: nn.Module, data: torch.Tensor, epochs: int = 2) -> nn.Module:
    """Very small training loop used for demonstration."""
    optim = torch.optim.Adam(model.parameters(), lr=1e-3)
    criterion = nn.MSELoss()
    model.train()
    for _ in range(epochs):
        optim.zero_grad()
        out = model(data)
        loss = criterion(out, torch.zeros_like(out))
        loss.backward()
        optim.step()
    return model


# Export helpers -------------------------------------------------------------

def export(model: nn.Module, example: Union[torch.Tensor, Sequence[torch.Tensor]], name: str) -> None:
    """Export ``model`` to both TorchScript and ONNX.

    ``example`` may be a single tensor or a sequence of tensors matching the
    model's forward signature.  The helper keeps the file naming scheme expected
    by :func:`core.phrase_model.load_model` so the exported artefacts can be
    loaded at runtime.
    """
    ts_path = MODELS_DIR / f"{name}.ts.pt"
    onnx_path = MODELS_DIR / f"{name}.onnx"

    scripted = torch.jit.script(model)
    scripted.save(ts_path)

    if not isinstance(example, (list, tuple)):
        example = (example,)
    torch.onnx.export(model, example, onnx_path, opset_version=12)


# Main training routine ------------------------------------------------------

def main() -> None:
    # Drum phrase: 16-32 bars (simulated by seq_len=32)
    drum_in, drum_hidden, drum_out = 8, 32, 8
    drum_data = synthetic_dataset(4, 32, drum_in)
    drum_model = train_model(TransformerEncoder(drum_in, drum_hidden, drum_out), drum_data)
    torch.save(drum_model.state_dict(), Path(__file__).with_name("drum_phrase.pt"))
    export(drum_model.eval(), drum_data[:1], "drum_phrase")

    # Demonstrate sampling with the centralized utilities
    logits = drum_model(drum_data[:1])[0, -1].detach().cpu().numpy()
    _ = sample(logits, top_k=4, top_p=0.9)

    # Bass phrase: chord conditioned
    bass_in, bass_hidden, bass_out = 12, 32, 12  # additional dims for chords
    bass_data = synthetic_dataset(4, 16, bass_in)
    bass_model = train_model(TransformerDecoder(bass_in, bass_hidden, bass_out), bass_data)
    torch.save(bass_model.state_dict(), Path(__file__).with_name("bass_phrase.pt"))
    export(bass_model.eval(), bass_data[:1], "bass_phrase")

    # Keys phrase: voicing aware
    keys_in, keys_hidden, keys_out = 16, 32, 16
    keys_data = synthetic_dataset(4, 16, keys_in)
    keys_model = train_model(TransformerEncoder(keys_in, keys_hidden, keys_out), keys_data)
    torch.save(keys_model.state_dict(), Path(__file__).with_name("keys_phrase.pt"))
    export(keys_model.eval(), keys_data[:1], "keys_phrase")


if __name__ == "__main__":
    main()
