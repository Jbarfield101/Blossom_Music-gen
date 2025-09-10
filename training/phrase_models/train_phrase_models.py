from pathlib import Path
from typing import Optional, List

import torch
import torch.nn as nn

REPO_DIR = Path(__file__).resolve().parents[2]
MODELS_DIR = REPO_DIR / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)


class PhraseRNN(nn.Module):
    """Small GRU based model used for phrase generation."""

    def __init__(self, input_size: int, hidden: int, output_size: int):
        super().__init__()
        self.gru = nn.GRU(input_size, hidden, batch_first=True)
        self.fc = nn.Linear(hidden, output_size)

    def forward(self, x):
        out, _ = self.gru(x)
        return self.fc(out)


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


# Sampling utilities ---------------------------------------------------------

def top_k_top_p_sampling(logits: torch.Tensor,
                         top_k: int = 0,
                         top_p: float = 1.0,
                         temperature: float = 1.0,
                         repetition_penalty: float = 1.0,
                         prev_tokens: Optional[List[int]] = None) -> int:
    """Samples a token from logits applying temperature, top-k, top-p and repetition penalty."""
    logits = logits.clone()

    if prev_tokens is not None and repetition_penalty != 1.0:
        for token in set(prev_tokens):
            logits[..., token] /= repetition_penalty

    logits = logits / temperature

    if top_k > 0:
        values, _ = torch.topk(logits, top_k)
        min_values = values[..., -1, None]
        logits[logits < min_values] = -float("inf")

    if top_p < 1.0:
        sorted_logits, sorted_indices = torch.sort(logits, descending=True)
        cumulative_probs = torch.softmax(sorted_logits, dim=-1).cumsum(dim=-1)
        sorted_indices_to_remove = cumulative_probs > top_p
        sorted_indices_to_remove[..., 1:] = sorted_indices_to_remove[..., :-1].clone()
        sorted_indices_to_remove[..., 0] = 0
        indices_to_remove = sorted_indices[sorted_indices_to_remove]
        logits[indices_to_remove] = -float("inf")

    probs = torch.softmax(logits, dim=-1)
    next_token = torch.multinomial(probs, num_samples=1)
    return int(next_token.item())


# Export helpers -------------------------------------------------------------

def export(model: nn.Module, example: torch.Tensor, name: str) -> None:
    """Exports model to TorchScript and ONNX."""
    ts_path = MODELS_DIR / f"{name}.ts.pt"
    onnx_path = MODELS_DIR / f"{name}.onnx"

    scripted = torch.jit.script(model)
    scripted.save(ts_path)

    torch.onnx.export(model, example, onnx_path, opset_version=12)


# Main training routine ------------------------------------------------------

def main() -> None:
    # Drum phrase: 16-32 bars (simulated by seq_len=32)
    drum_in, drum_hidden, drum_out = 8, 32, 8
    drum_data = synthetic_dataset(4, 32, drum_in)
    drum_model = train_model(PhraseRNN(drum_in, drum_hidden, drum_out), drum_data)
    torch.save(drum_model.state_dict(), Path(__file__).with_name("drum_phrase.pt"))
    export(drum_model.eval(), drum_data[:1], "drum_phrase")

    # Bass phrase: chord conditioned
    bass_in, bass_hidden, bass_out = 12, 32, 12  # additional dims for chords
    bass_data = synthetic_dataset(4, 16, bass_in)
    bass_model = train_model(PhraseRNN(bass_in, bass_hidden, bass_out), bass_data)
    torch.save(bass_model.state_dict(), Path(__file__).with_name("bass_phrase.pt"))
    export(bass_model.eval(), bass_data[:1], "bass_phrase")

    # Keys phrase: voicing aware
    keys_in, keys_hidden, keys_out = 16, 32, 16
    keys_data = synthetic_dataset(4, 16, keys_in)
    keys_model = train_model(PhraseRNN(keys_in, keys_hidden, keys_out), keys_data)
    torch.save(keys_model.state_dict(), Path(__file__).with_name("keys_phrase.pt"))
    export(keys_model.eval(), keys_data[:1], "keys_phrase")


if __name__ == "__main__":
    main()
