from __future__ import annotations

"""High level message orchestrator.

The :func:`respond` function routes incoming user messages either to the
conversation path handled by :mod:`brain.dialogue` or to a simple
note‑taking path.  The decision is based on
:func:`brain.prompt_router.classify`.

A tiny :class:`Event` typed dictionary is exposed to provide a consistent
structure for consumers of the orchestrator.  Two event types are emitted:
``"dialogue"`` for regular assistant responses and ``"note"`` when the user
wants to take a note.
"""

from typing import Literal, TypedDict

from . import dialogue, prompt_router, ollama_client


class Event(TypedDict):
    """Small container describing an orchestrator outcome."""

    type: Literal["dialogue", "note"]
    content: str


def _take_note(message: str) -> str:
    """Return a short acknowledgement for ``message``.

    The current implementation simply runs the text through the
    :mod:`brain.ollama_client` to potentially clean up or summarize the
    note.  Future versions could persist the note to an external store.
    """

    prompt = f"Summarise the following note succinctly:\n{message}\n"
    return ollama_client.generate(prompt)


def respond(user_message: str) -> Event:
    """Return an :class:`Event` for ``user_message``."""

    category = prompt_router.classify(user_message)
    if category == "note":
        text = _take_note(user_message)
        return {"type": "note", "content": text}

    event = dialogue.respond(user_message)
    return {"type": "dialogue", "content": event.narration}


def main() -> None:
    """Simple REPL for manual testing."""

    while True:
        try:
            msg = input("You: ")
        except EOFError:
            break
        if not msg:
            break
        event = respond(msg)
        prefix = "Bot" if event["type"] == "dialogue" else "Note"
        print(f"{prefix}: {event['content']}")


if __name__ == "__main__":  # pragma: no cover - manual testing helper
    main()
