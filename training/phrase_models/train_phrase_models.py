"""Toy training script for phrase generation models.

The original version of this file used small GRU based networks backed by
synthesised random data.  To better exercise the loading utilities this script
now consumes token sequences produced by :mod:`data.build_dataset` and trains
tiny Transformer encoder/decoder networks for drums, bass and keys phrases.
The models are intentionally light‑weight – they merely serve as stand‑ins for
real networks while keeping the repository free from heavy training
requirements.

The exported TorchScript/ONNX artefacts are still compatible with
``core.phrase_model.load_model`` which looks for ``*_phrase.ts.pt`` and
``*_phrase.onnx`` files inside the global ``models/`` directory.
"""

from pathlib import Path
from typing import Sequence, Union
import argparse
import json
import sys

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

from core.sampling import sample
from core.style import StyleToken, NUM_STYLES

REPO_DIR = Path(__file__).resolve().parents[2]
MODELS_DIR = REPO_DIR / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)


class TransformerEncoder(nn.Module):
    """Very small Transformer encoder used for drum/keys phrases."""

    def __init__(self, input_size: int, hidden: int, output_size: int):
        super().__init__()
        self.in_proj = nn.Linear(input_size, hidden)
        self.style_emb = nn.Embedding(NUM_STYLES, hidden)
        enc_layer = nn.TransformerEncoderLayer(
            hidden, nhead=2, dim_feedforward=hidden * 2, batch_first=True
        )
        self.encoder = nn.TransformerEncoder(enc_layer, num_layers=2)
        self.fc = nn.Linear(hidden, output_size)

    def forward(self, x: torch.Tensor, style: torch.Tensor) -> torch.Tensor:
        x = self.in_proj(x) + self.style_emb(style).unsqueeze(1)
        x = self.encoder(x)
        return self.fc(x)


class TransformerDecoder(nn.Module):
    """Very small Transformer decoder used for bass phrases."""

    def __init__(self, input_size: int, hidden: int, output_size: int):
        super().__init__()
        self.in_proj = nn.Linear(input_size, hidden)
        self.style_emb = nn.Embedding(NUM_STYLES, hidden)
        dec_layer = nn.TransformerDecoderLayer(
            hidden, nhead=2, dim_feedforward=hidden * 2, batch_first=True
        )
        self.decoder = nn.TransformerDecoder(dec_layer, num_layers=2)
        self.fc = nn.Linear(hidden, output_size)

    def forward(self, x: torch.Tensor, style: torch.Tensor) -> torch.Tensor:
        # Decoder requires a memory tensor – for the toy model we simply use a
        # zero tensor with the same shape as the input.
        x = self.in_proj(x) + self.style_emb(style).unsqueeze(1)
        memory = torch.zeros_like(x)
        x = self.decoder(x, memory)
        return self.fc(x)


class TokenDataset(Dataset):
    """Load token sequences from a JSONL file."""

    def __init__(self, path: Path) -> None:
        self.records: list[list[list[float]]] = []
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                rec = json.loads(line)
                self.records.append(rec.get("tokens", []))

    def __len__(self) -> int:  # pragma: no cover - trivial
        return len(self.records)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        seq = torch.tensor(self.records[idx], dtype=torch.float32)
        style = torch.tensor(StyleToken.LOFI, dtype=torch.long)
        return seq, style


def _collate(batch: Sequence[tuple[torch.Tensor, torch.Tensor]]) -> tuple[torch.Tensor, torch.Tensor]:
    data, styles = zip(*batch)
    max_len = max(x.shape[0] for x in data)
    dim = data[0].shape[1]
    padded = torch.zeros(len(data), max_len, dim, dtype=torch.float32)
    for i, seq in enumerate(data):
        padded[i, : seq.shape[0]] = seq
    styles = torch.stack(styles)
    return padded, styles


def train_model(model: nn.Module, loader: DataLoader, epochs: int = 2) -> nn.Module:
    """Very small training loop used for demonstration.

    Emits progress information to ``stdout`` after each epoch so external
    callers can track training status.
    """
    optim = torch.optim.Adam(model.parameters(), lr=1e-3)
    criterion = nn.MSELoss()
    model.train()
    for epoch in range(1, epochs + 1):
        for data, styles in loader:
            optim.zero_grad()
            out = model(data, styles)
            loss = criterion(out, torch.zeros_like(out))
            loss.backward()
            optim.step()
        percent = int(epoch * 100 / epochs)
        print(f"train: {percent}% epoch {epoch}/{epochs}")
        sys.stdout.flush()
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

    # Allow variable batch size and sequence length by marking the corresponding
    # axes as dynamic in the exported ONNX graph.
    input_names = [f"input_{i}" for i in range(len(example))]
    output_names = ["output"]
    dynamic_axes = {n: {0: "batch", 1: "time"} for n in input_names}
    dynamic_axes.update({n: {0: "batch", 1: "time"} for n in output_names})

    torch.onnx.export(
        model,
        example,
        onnx_path,
        opset_version=12,
        input_names=input_names,
        output_names=output_names,
        dynamic_axes=dynamic_axes,
    )


# Main training routine ------------------------------------------------------

def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train", type=Path, required=True, help="Training JSONL file")
    parser.add_argument("--val", type=Path, default=None, help="Validation JSONL file")
    parser.add_argument("--epochs", type=int, default=2, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=4, help="Mini-batch size")
    args = parser.parse_args(argv)

    train_ds = TokenDataset(args.train)
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, collate_fn=_collate)

    # One batch for shape inference / export examples
    example_batch, example_styles = next(iter(train_loader))
    in_dim = example_batch.shape[-1]
    out_dim = in_dim

    # Drum phrase -------------------------------------------------------------
    drum_model = train_model(TransformerEncoder(in_dim, 32, out_dim), train_loader, args.epochs)
    torch.save(drum_model.state_dict(), Path(__file__).with_name("drum_phrase.pt"))
    export(drum_model.eval(), (example_batch[:1], example_styles[:1]), "drum_phrase")

    logits = (
        drum_model(example_batch[:1], torch.tensor([StyleToken.LOFI], dtype=torch.long))[0, -1]
        .detach()
        .cpu()
        .numpy()
    )
    _ = sample(logits, top_k=4, top_p=0.9, rng=np.random.default_rng(0))

    # Bass phrase -------------------------------------------------------------
    bass_model = train_model(TransformerDecoder(in_dim, 32, out_dim), train_loader, args.epochs)
    torch.save(bass_model.state_dict(), Path(__file__).with_name("bass_phrase.pt"))
    export(bass_model.eval(), (example_batch[:1], example_styles[:1]), "bass_phrase")

    # Keys phrase -------------------------------------------------------------
    keys_model = train_model(TransformerEncoder(in_dim, 32, out_dim), train_loader, args.epochs)
    torch.save(keys_model.state_dict(), Path(__file__).with_name("keys_phrase.pt"))
    export(keys_model.eval(), (example_batch[:1], example_styles[:1]), "keys_phrase")


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()
