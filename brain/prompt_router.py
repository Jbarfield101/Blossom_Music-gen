import re
from typing import Callable, Literal, Optional

Category = Literal["npc", "rules", "lore", "note"]

_llm_classifier: Optional[Callable[[str], Optional[Category]]] = None

def register_llm_classifier(func: Callable[[str], Optional[Category]]) -> None:
    """Register a fallback LLM-based classifier."""
    global _llm_classifier
    _llm_classifier = func

def classify(message: str) -> Category:
    """Classify a message into one of the known categories.

    The function first applies simple keyword/regex heuristics. If none of the
    heuristics match and an LLM classifier has been registered via
    :func:`register_llm_classifier`, it will be consulted as a fallback.
    """
    text = message.lower()

    location_terms = r"(?:city|town|village|kingdom|empire|realm|nation|settlement|capital)"
    pantheon_terms = r"(?:pantheon|god|gods|deity|deities)"

    if re.search(r"\bnpc\b|hello|hi|hey|greet|talk to", text):
        return "npc"
    if re.search(r"\bwho\s+(?:is|was|are)\b|\bwho's\b", text):
        return "npc"
    if re.search(rf"\btell me about\b.*\b(?:{location_terms}|{pantheon_terms})\b", text):
        return "lore"
    if re.search(r"\bwhere\s+(?:is|are)\b", text):
        return "lore"
    if re.search(rf"\b(?:{location_terms}|{pantheon_terms})\b", text):
        return "lore"
    if re.search(r"\btell me about\b", text):
        return "npc"
    if re.search(r"\brules?\b|must|should|policy|guideline", text):
        return "rules"
    if re.search(r"\blore\b|story|background|history|world", text):
        return "lore"
    if re.search(r"\bnote\b|todo|to-do|remember", text):
        return "note"

    if _llm_classifier:
        result = _llm_classifier(message)
        if result in ("npc", "rules", "lore", "note"):
            return result

    return "note"
