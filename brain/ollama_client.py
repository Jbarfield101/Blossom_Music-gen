from __future__ import annotations

"""Unified LLM client supporting local Ollama and OpenAI-hosted models."""

import json
import os
from typing import Iterator

import requests
from requests import Response
from requests.exceptions import HTTPError, RequestException, Timeout

from config import openai_api
from telemetry import record_openai_usage

__all__ = ["generate", "LLMError", "OllamaError"]

_OLLAMA_URL = os.getenv("OLLAMA_API_URL", "http://localhost:11434/api/generate")
_TIMEOUT = 30.0

_OPENAI_API_BASE = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1").rstrip("/")
_OPENAI_COMPLETIONS_URL = f"{_OPENAI_API_BASE}/chat/completions"
try:
    _OPENAI_TEMPERATURE = float(os.getenv("OPENAI_TEMPERATURE", "0.2"))
except ValueError:
    _OPENAI_TEMPERATURE = 0.2
_OPENAI_MAX_TOKENS_ENV = os.getenv("OPENAI_MAX_TOKENS")
try:
    _OPENAI_MAX_TOKENS = int(_OPENAI_MAX_TOKENS_ENV) if _OPENAI_MAX_TOKENS_ENV else None
except ValueError:
    _OPENAI_MAX_TOKENS = None


class LLMError(RuntimeError):
    """Raised when the configured LLM provider returns an error response."""


OllamaError = LLMError


def _selected_provider() -> tuple[str, str]:
    """Return the active provider and model name."""

    raw = (
        os.getenv("LLM_MODEL")
        or os.getenv("OLLAMA_MODEL")
        or "mistral"
    )
    raw = raw.strip()
    lowered = raw.lower()
    if lowered.startswith("openai:") or lowered.startswith("openai/"):
        separator = ":" if ":" in raw else "/"
        model = raw.split(separator, 1)[1].strip() if separator in raw else ""
        model = model or "gpt-4o-mini"
        return "openai", model
    model = raw or "mistral"
    return "ollama", model


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
            raise LLMError(payload["error"])
        if "response" in payload:
            yield payload["response"]
        if payload.get("done"):
            break


def _generate_ollama(
    prompt: str,
    model: str,
    system: str | None,
    temperature: float | None,
    seed: int | None,
) -> str:
    """Generate text using a locally served Ollama model."""

    payload: dict[str, object] = {"model": model, "prompt": prompt, "stream": True}
    if isinstance(system, str) and system.strip():
        payload["system"] = system
    options: dict[str, object] = {}
    if temperature is not None:
        try:
            options["temperature"] = float(temperature)
        except (TypeError, ValueError):
            pass
    if seed is not None:
        try:
            options["seed"] = int(seed)
        except (TypeError, ValueError):
            pass
    if options:
        payload["options"] = options
    try:
        with requests.post(_OLLAMA_URL, json=payload, stream=True, timeout=_TIMEOUT) as resp:
            try:
                resp.raise_for_status()
            except HTTPError as exc:
                raise LLMError(f"Ollama HTTP {resp.status_code}: {resp.text}") from exc
            return "".join(_stream_response(resp))
    except Timeout as exc:
        raise TimeoutError("Request to Ollama server timed out") from exc
    except RequestException as exc:
        raise LLMError(f"Request to Ollama failed: {exc}") from exc


def _normalize_openai_content(content: object) -> str:
    """Normalise OpenAI response content into a string."""

    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        if parts:
            return "\n".join(parts)
    return str(content)


def _generate_openai(
    prompt: str,
    model: str,
    system: str | None,
    temperature: float | None,
) -> str:
    """Generate text using the OpenAI Chat Completions API."""

    api_key = openai_api.get_api_key()
    if not api_key:
        raise LLMError("OpenAI API key not configured")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    messages: list[dict[str, str]] = []
    if isinstance(system, str) and system.strip():
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    if temperature is not None:
        try:
            temp_value = float(temperature)
        except (TypeError, ValueError):
            temp_value = _OPENAI_TEMPERATURE
    else:
        temp_value = _OPENAI_TEMPERATURE

    payload: dict[str, object] = {
        "model": model,
        "messages": messages,
        "temperature": temp_value,
    }
    if _OPENAI_MAX_TOKENS is not None:
        payload["max_tokens"] = _OPENAI_MAX_TOKENS

    try:
        resp = requests.post(
            _OPENAI_COMPLETIONS_URL,
            headers=headers,
            json=payload,
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
    except Timeout as exc:
        raise TimeoutError("Request to OpenAI timed out") from exc
    except HTTPError as exc:
        response = exc.response
        status = response.status_code if response is not None else "unknown"
        detail = response.text if response is not None else str(exc)
        raise LLMError(f"OpenAI HTTP {status}: {detail}") from exc
    except RequestException as exc:
        raise LLMError(f"Request to OpenAI failed: {exc}") from exc

    try:
        data = resp.json()
    except ValueError as exc:
        raise LLMError("Invalid JSON payload from OpenAI") from exc

    usage_info = data.get("usage")
    if isinstance(usage_info, dict):
        def _coerce(value: object) -> int | None:
            try:
                return int(value)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                return None

        prompt_tokens = _coerce(usage_info.get("prompt_tokens"))
        completion_tokens = _coerce(usage_info.get("completion_tokens"))
        total_tokens = _coerce(usage_info.get("total_tokens"))
        if prompt_tokens is None and completion_tokens is None and total_tokens is not None:
            prompt_tokens = total_tokens
            completion_tokens = 0
        record_openai_usage(prompt_tokens, completion_tokens)

    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise LLMError("OpenAI response missing choices")

    primary = choices[0]
    if isinstance(primary, dict):
        message = primary.get("message")
        if isinstance(message, dict) and "content" in message:
            return _normalize_openai_content(message["content"]).strip()
        if "text" in primary:
            return _normalize_openai_content(primary["text"]).strip()

    return _normalize_openai_content(primary).strip()


def generate(
    prompt: str,
    system: str | None = None,
    temperature: float | None = None,
    seed: int | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> str:
    """Generate a completion for ``prompt`` using the configured LLM."""

    base_provider, base_model = _selected_provider()

    override_provider = provider.strip() if isinstance(provider, str) else ""
    override_model = model.strip() if isinstance(model, str) else ""

    def _split_prefixed(raw: str) -> tuple[str | None, str]:
        lowered = raw.lower()
        if lowered.startswith("openai:") or lowered.startswith("openai/"):
            sep = ":" if ":" in raw else "/"
            return "openai", raw.split(sep, 1)[1].strip()
        if lowered.startswith("ollama:") or lowered.startswith("ollama/"):
            sep = ":" if ":" in raw else "/"
            return "ollama", raw.split(sep, 1)[1].strip()
        return None, raw

    if override_model:
        inferred_provider, cleaned_model = _split_prefixed(override_model)
        if inferred_provider and not override_provider:
            override_provider = inferred_provider
        override_model = cleaned_model

    normalized_provider = override_provider.lower()
    if normalized_provider == "openai":
        provider_name = "openai"
        model_name = override_model or (base_model if base_provider == "openai" else "gpt-4o-mini")
    elif normalized_provider == "ollama":
        provider_name = "ollama"
        model_name = override_model or (base_model if base_provider == "ollama" else "mistral")
    elif override_provider:
        provider_name = override_provider
        model_name = override_model or base_model
    else:
        provider_name = base_provider
        model_name = override_model or base_model

    if provider_name == "openai":
        return _generate_openai(prompt, model_name, system, temperature)
    return _generate_ollama(prompt, model_name, system, temperature, seed)

