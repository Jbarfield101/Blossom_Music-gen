from __future__ import annotations

"""Voice profile registry for text-to-speech backends."""

from dataclasses import dataclass, asdict
import json
from pathlib import Path
from typing import Dict, Optional


@dataclass
class VoiceProfile:
    """Settings that describe how a voice should sound."""

    voice_id: str
    speed: float = 1.0
    emotion: str = "neutral"


class VoiceRegistry:
    """Loads and stores :class:`VoiceProfile` objects.

    Profiles are persisted to ``data/voices.json`` so that voice
    configuration can be customised by the user.  Unknown voices are assumed
    to be Piper-compatible and are initialised with default parameters.
    """

    def __init__(self, path: Path | str = Path("data/voices.json")) -> None:
        self.path = Path(path)
        self._profiles: Dict[str, VoiceProfile] = {}
        self.load()

    # ------------------------------------------------------------------
    def load(self) -> None:
        """Load profiles from :attr:`path` if it exists."""

        if self.path.exists():
            data = json.loads(self.path.read_text())
            self._profiles = {
                name: VoiceProfile(**cfg) for name, cfg in data.items()
            }
        else:  # pragma: no cover - defensive
            self._profiles = {}

        # ensure a narrator profile is always available
        self._profiles.setdefault("narrator", VoiceProfile("narrator"))

    # ------------------------------------------------------------------
    def save(self) -> None:
        """Persist profiles to :attr:`path`."""

        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = {name: asdict(profile) for name, profile in self._profiles.items()}
        self.path.write_text(json.dumps(data, indent=2))

    # ------------------------------------------------------------------
    def get_profile(self, name: Optional[str]) -> VoiceProfile:
        """Return a profile by name.

        ``None`` or ``"narrator"`` returns the default narrator profile.  If a
        profile is missing it is initialised assuming a Piper voice where the
        name corresponds to the Piper model identifier.
        """

        if not name or name == "narrator":
            return self._profiles["narrator"]

        profile = self._profiles.get(name)
        if profile is None:
            profile = VoiceProfile(name)
            self._profiles[name] = profile
        return profile

    # ------------------------------------------------------------------
    def set_profile(self, name: str, profile: VoiceProfile) -> None:
        """Insert or replace a voice profile."""

        self._profiles[name] = profile
