import { useState } from "react";
import { getProfile, setProfile } from "../api/discordProfiles";

export default function Profiles() {
  const [guildId, setGuildId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [voice, setVoice] = useState("");
  const [hotword, setHotword] = useState("");
  const [models, setModels] = useState("{}");

  const load = async () => {
    if (!guildId || !channelId) return;
    const profile = await getProfile(Number(guildId), Number(channelId));
    setVoice(profile.voice || "");
    setHotword(profile.hotword || "");
    setModels(JSON.stringify(profile.models || {}, null, 2));
  };

  const save = async () => {
    const profile = {
      voice: voice || undefined,
      hotword: hotword || undefined,
    };
    try {
      profile.models = models ? JSON.parse(models) : {};
    } catch (e) {
      console.error(e);
      return;
    }
    await setProfile(Number(guildId), Number(channelId), profile);
  };

  return (
    <div>
      <h1>Profiles</h1>
      <div>
        <label>
          Guild ID
          <input value={guildId} onChange={(e) => setGuildId(e.target.value)} />
        </label>
        <label>
          Channel ID
          <input value={channelId} onChange={(e) => setChannelId(e.target.value)} />
        </label>
        <button type="button" onClick={load}>Load</button>
      </div>
      <div>
        <label>
          Voice
          <input value={voice} onChange={(e) => setVoice(e.target.value)} />
        </label>
      </div>
      <div>
        <label>
          Hotword
          <input value={hotword} onChange={(e) => setHotword(e.target.value)} />
        </label>
      </div>
      <div>
        <label>
          Model Overrides
          <textarea
            rows="5"
            cols="40"
            value={models}
            onChange={(e) => setModels(e.target.value)}
          />
        </label>
      </div>
      <button type="button" onClick={save}>Save</button>
    </div>
  );
}
