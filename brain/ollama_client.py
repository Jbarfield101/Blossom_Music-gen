from __future__ import annotations

"""Minimal client for interacting with a local Ollama server.

This module exposes a single :func:`generate` function that sends a prompt to
an Ollama model running on ``localhost`` and returns the streamed response as a
single string.

Example
-------

>>> from brain.ollama_client import generate
>>> text = generate("Write a short poem about music.")
>>> print(text)

The model used can be configured with the ``OLLAMA_MODEL`` environment
variable; it defaults to ``"mistral"``.
"""

import json
import os
from typing import Iterator

import requests
from requests import Response
from requests.exceptions import HTTPError, RequestException, Timeout

__all__ = ["generate", "OllamaError"]


_URL = "http://localhost:11434/api/generate"
_DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "mistral")
_TIMEOUT = 30.0


class OllamaError(RuntimeError):
    """Raised when the Ollama server returns an error response."""


def _stream_response(resp: Response) -> Iterator[str]:
    """Yield text chunks from a streaming Ollama response."""
    for line in resp.iter_lines():
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "error" in payload:
            raise OllamaError(payload["error"])
        if "response" in payload:
            yield payload["response"]
        if payload.get("done"):
            break


def generate(prompt: str) -> str:
    """Generate a completion for ``prompt`` using a local Ollama model.

    Parameters
    ----------
    prompt:
        Text prompt supplied to the model.

    Returns
    -------
    str
        The concatenated text streamed back from the model.

    Raises
    ------
    OllamaError
        If the server returns an error or a non-200 HTTP status.
    TimeoutError
        If the request exceeds the timeout limit.
    """

    payload = {"model": _DEFAULT_MODEL, "prompt": prompt, "stream": True}
    try:
        with requests.post(_URL, json=payload, stream=True, timeout=_TIMEOUT) as resp:
            try:
                resp.raise_for_status()
            except HTTPError as exc:
                raise OllamaError(f"HTTP {resp.status_code}: {resp.text}") from exc

            return "".join(_stream_response(resp))
    except Timeout as exc:
        raise TimeoutError("Request to Ollama server timed out") from exc
    except RequestException as exc:
        raise OllamaError(f"Request to Ollama failed: {exc}") from exc
