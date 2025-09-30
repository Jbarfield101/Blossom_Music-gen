import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Dnd from './pages/Dnd.jsx';
import DndChat from './pages/DndChat.jsx';
import DndDiscord from './pages/DndDiscord.jsx';
import DndLore from './pages/DndLore.jsx';
import DndInbox from './pages/DndInbox.jsx';
import DndWorld from './pages/DndWorld.jsx';
import DndDungeonMaster from './pages/DndDungeonMaster.jsx';
import DndAssets from './pages/DndAssets.jsx';
import DndDmEvents from './pages/DndDmEvents.jsx';
import DndDmMonsters from './pages/DndDmMonsters.jsx';
import DndDmNpcs from './pages/DndDmNpcs.jsx';
import DndDmPlayers from './pages/DndDmPlayers.jsx';
import DndDmPlayersHome from './pages/DndDmPlayersHome.jsx';
import DndDmPlayerCreate from './pages/DndDmPlayerCreate.jsx';
import DndDmPlayerAuto from './pages/DndDmPlayerAuto.jsx';
import DndDmQuests from './pages/DndDmQuests.jsx';
import DndDmQuestsFaction from './pages/DndDmQuestsFaction.jsx';
import DndDmQuestsMain from './pages/DndDmQuestsMain.jsx';
import DndDmQuestsPersonal from './pages/DndDmQuestsPersonal.jsx';
import DndDmQuestsSide from './pages/DndDmQuestsSide.jsx';
import DndDmQuestGenerator from './pages/DndDmQuestGenerator.jsx';
import DndDmEstablishments from './pages/DndDmEstablishments.jsx';
import DndDmTagManager from './pages/DndDmTagManager.jsx';
import DndVoiceLabs from './pages/DndVoiceLabs.jsx';
import DndPiperOnly from './pages/DndPiperOnly.jsx';
import DndElevenLabs from './pages/DndElevenLabs.jsx';
import ManageVoices from './pages/ManageVoices.jsx';
import Settings from './pages/SettingsHome.jsx';
import SettingsAdvanced from './pages/Settings.jsx';
import SettingsUsers from './pages/SettingsUsers.jsx';
import SettingsVault from './pages/SettingsVault.jsx';
import SettingsDiscord from './pages/SettingsDiscord.jsx';
import SettingsAppearance from './pages/SettingsAppearance.jsx';
import SettingsModels from './pages/SettingsModels.jsx';
import SettingsDevices from './pages/SettingsDevices.jsx';
import SettingsHotwords from './pages/SettingsHotwords.jsx';
import SettingsBackup from './pages/SettingsBackup.jsx';
import Train from './pages/Train.jsx';
import Profiles from './pages/Profiles.jsx';
import MusicGen from './pages/MusicGen.jsx';
import AlgorithmicGenerator from './pages/Generate.jsx';
import DndWorldPantheon from './pages/DndWorldPantheon.jsx';
import DndWorldRegions from './pages/DndWorldRegions.jsx';
import DndWorldFactions from './pages/DndWorldFactions.jsx';
import DndWorldBank from './pages/DndWorldBank.jsx';
import DndWorldBankEconomy from './pages/DndWorldBankEconomy.jsx';
import DndWorldBankTransactions from './pages/DndWorldBankTransactions.jsx';
import DndWorldCalendar from './pages/DndWorldCalendar.jsx';
import SoundLab from './pages/SoundLab.jsx';
import Queue from './pages/Queue.jsx';
import Tools from './pages/Tools.jsx';
import WhisperOutput from './pages/WhisperOutput.jsx';
import Fusion from './pages/Fusion.jsx';
import LoopMaker from './pages/LoopMaker.jsx';
import BeatMaker from './pages/BeatMaker.jsx';
import Games from './pages/Games.jsx';
import RainBlocks from './pages/RainBlocks.jsx';
import SandBlocks from './pages/SandBlocks.jsx';
import Snake from './pages/Snake.jsx';
import BrickBreaker from './pages/BrickBreaker.jsx';
import AlbumMaker from './pages/AlbumMaker.jsx';
import Calendar from './pages/Calendar.jsx';
import GeneralChat from './pages/GeneralChat.jsx';
import DndTasks from './pages/DndTasks.jsx';
import DndDmWorldInventory from './pages/DndDmWorldInventory.jsx';
import DndLoreSecrets from './pages/DndLoreSecrets.jsx';
import DndLoreJournal from './pages/DndLoreJournal.jsx';
import DndLoreStories from './pages/DndLoreStories.jsx';
import DndLoreNotes from './pages/DndLoreNotes.jsx';
import DndLorePlayerRelations from './pages/DndLorePlayerRelations.jsx';
import DndLoreSpellBook from './pages/DndLoreSpellBook.jsx';
import DndLoreRaces from './pages/DndLoreRaces.jsx';
import DndLoreClasses from './pages/DndLoreClasses.jsx';
import DndLoreRules from './pages/DndLoreRules.jsx';
import DndLoreBackgroundRules from './pages/DndLoreBackgroundRules.jsx';
import { Store } from '@tauri-apps/plugin-store';
import { useEffect, useRef, useState } from 'react';
import { setPiper as apiSetPiper, listPiper as apiListPiper } from './api/models';
import { synthWithPiper } from './lib/piperSynth';
import { listPiperVoices as listBundledVoices } from './lib/piperVoices';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listPiperVoices } from './lib/piperVoices';

function UserSelectorOverlay({ onClose }) {
  const [users, setUsers] = useState([]);
  const [name, setName] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const store = await Store.load('users.json');
        const list = await store.get('users');
        setUsers(Array.isArray(list) ? list.filter((v) => typeof v === 'string' && v) : []);
      } catch (e) {
        console.warn('Failed to load users', e);
      }
    })();
  }, []);

  const choose = async (who) => {
    try {
      const store = await Store.load('users.json');
      await store.set('currentUser', who);
      await store.save();
      localStorage.setItem('blossom.currentUser', who);
      onClose?.();
    } catch (e) {
      console.error('Failed to set current user', e);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const store = await Store.load('users.json');
      const list = await store.get('users');
      const next = Array.isArray(list) ? list.slice() : [];
      if (!next.includes(trimmed)) next.push(trimmed);
      await store.set('users', next);
      await store.set('currentUser', trimmed);
      // Default per-user preferences: enable audio greeting by default
      const prefs = (await store.get('prefs')) || {};
      let defaultVoice = '';
      try {
        const p = await apiListPiper();
        if (p && typeof p.selected === 'string') defaultVoice = p.selected;
        if (!defaultVoice) {
          const v = await listPiperVoices();
          if (Array.isArray(v) && v.length) defaultVoice = v[0].id;
        }
      } catch {}
      if (!prefs[trimmed]) {
        prefs[trimmed] = {
          audioGreeting: true,
          greetingText: 'Wellcome {name}, What shall we work on today?',
          voice: defaultVoice,
        };
      }
      await store.set('prefs', prefs);
      await store.save();
      localStorage.setItem('blossom.currentUser', trimmed);
      onClose?.();
    } catch (e) {
      console.error('Failed to create user', e);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'grid', placeItems: 'center', zIndex: 9999
    }}>
      <div style={{ background: 'var(--card-bg)', color: 'var(--text)', padding: '1rem', borderRadius: 8, minWidth: 360 }}>
        <h2>Select User</h2>
        {users.length > 0 ? (
          <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {users.map((u) => (
              <button key={u} className="p-sm" onClick={() => choose(u)}>{u}</button>
            ))}
          </div>
        ) : (
          <div style={{ opacity: 0.8, marginBottom: '0.5rem' }}>No users found.</div>
        )}
        <form onSubmit={create} style={{ display: 'grid', gap: '0.5rem' }}>
          <label>
            Create new user
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="p-sm" style={{ width: '100%' }} />
          </label>
          <button type="submit" className="p-sm">Create & Use</button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [needsUser, setNeedsUser] = useState(false);
  const greetedRef = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        const cached = localStorage.getItem('blossom.currentUser');
        if (cached && typeof cached === 'string') {
          setNeedsUser(false);
          return;
        }
        const store = await Store.load('users.json');
        const current = await store.get('currentUser');
        const has = typeof current === 'string' && current;
        if (has) {
          localStorage.setItem('blossom.currentUser', current);
        }
        setNeedsUser(!has);
      } catch (e) {
        console.warn('Failed to read current user', e);
      }
    })();
  }, []);
  useEffect(() => {
    (async () => {
      try {
        if (greetedRef.current) return;
        const store = await Store.load('users.json');
        const current = await store.get('currentUser');
        const user = typeof current === 'string' ? current : '';
        if (!user) return;
        const prefs = await store.get('prefs');
        const p = (prefs && typeof prefs === 'object' && prefs[user]) || {};
        let voice = typeof p.voice === 'string' ? p.voice : '';
        try {
          const voices = await listPiperVoices();
          if (!voices || !voices.length) {
            return; // no available voices; skip greeting silently
          }
          if (!voice || voice === 'narrator') {
            voice = voices[0].id;
          }
        } catch {}
        if (voice) {
          await apiSetPiper(voice).catch(() => {});
        }
        const audioGreeting = p.audioGreeting !== false; // default to on unless explicitly disabled
        if (audioGreeting) {
          const tpl = typeof p.greetingText === 'string' && p.greetingText.trim()
            ? p.greetingText.trim()
            : `Wellcome {name}, What shall we work on today?`;
          const message = tpl.replaceAll('{name}', user);
          try {
            // Resolve a concrete model/config for the selected voice
            let model = '';
            let config = '';
            try {
              const opts = await listBundledVoices();
              const match = opts.find(v => v.id === (voice || '')) || opts[0];
              if (match) { model = match.modelPath; config = match.configPath; }
            } catch {}
            if (!model || !config) { throw new Error('No piper voice available'); }
            // Synthesize locally to AppData to avoid touching watched src-tauri folders in dev
            const wavPath = await synthWithPiper(message, model, config, {});
            const url = convertFileSrc(wavPath);
            if (url) {
              const audio = new Audio(url);
              audio.volume = 1.0;
              audio.play().catch(() => {});
            }
          } catch {}
        }
        greetedRef.current = true;
      } catch (e) {
        // ignore greeting errors
      }
    })();
  }, [needsUser]);
  return (
    <>
      {needsUser && (
        <UserSelectorOverlay onClose={() => setNeedsUser(false)} />
      )}
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/musicgen" element={<SoundLab />}>
          <Route path="musicgen" element={<MusicGen />} />
          <Route path="algorithmic" element={<AlgorithmicGenerator />} />
        </Route>
        <Route path="/dnd" element={<Dnd />} />
        <Route path="/dnd/inbox" element={<DndInbox />} />
        <Route path="/dnd/world" element={<DndWorld />} />
        <Route path="/dnd/world/bank" element={<DndWorldBank />} />
        <Route path="/dnd/world/bank/economy" element={<DndWorldBankEconomy />} />
        <Route path="/dnd/world/bank/transactions" element={<DndWorldBankTransactions />} />
        <Route path="/dnd/world/pantheon" element={<DndWorldPantheon />} />
        <Route path="/dnd/world/regions" element={<DndWorldRegions />} />
        <Route path="/dnd/world/factions" element={<DndWorldFactions />} />
        <Route path="/dnd/world/calendar" element={<DndWorldCalendar />} />
        <Route path="/dnd/lore/secrets" element={<DndLoreSecrets />} />
        <Route path="/dnd/lore/journal" element={<DndLoreJournal />} />
        <Route path="/dnd/lore/stories" element={<DndLoreStories />} />
        <Route path="/dnd/lore/notes" element={<DndLoreNotes />} />
        <Route path="/dnd/lore/relations" element={<DndLorePlayerRelations />} />
        <Route path="/dnd/lore/spellbook" element={<DndLoreSpellBook />} />
        <Route path="/dnd/lore/races" element={<DndLoreRaces />} />
        <Route path="/dnd/lore/classes" element={<DndLoreClasses />} />
        <Route path="/dnd/lore/rules" element={<DndLoreRules />} />
        <Route path="/dnd/lore/background-rules" element={<DndLoreBackgroundRules />} />
        <Route path="/dnd/tasks" element={<DndTasks />} />
        <Route path="/dnd/dungeon-master" element={<DndDungeonMaster />} />
        <Route path="/dnd/dungeon-master/events" element={<DndDmEvents />} />
        <Route path="/dnd/dungeon-master/monsters" element={<DndDmMonsters />} />
        <Route path="/dnd/dungeon-master/npcs" element={<DndDmNpcs />} />
        <Route path="/dnd/dungeon-master/players" element={<DndDmPlayersHome />} />
        <Route path="/dnd/dungeon-master/players/sheet" element={<DndDmPlayers />} />
        <Route path="/dnd/dungeon-master/players/new" element={<DndDmPlayerCreate />} />
        <Route path="/dnd/dungeon-master/players/auto" element={<DndDmPlayerAuto />} />
        <Route path="/dnd/dungeon-master/quests" element={<DndDmQuests />} />
        <Route path="/dnd/dungeon-master/quests/faction" element={<DndDmQuestsFaction />} />
        <Route path="/dnd/dungeon-master/quests/main" element={<DndDmQuestsMain />} />
        <Route path="/dnd/dungeon-master/quests/personal" element={<DndDmQuestsPersonal />} />
        <Route path="/dnd/dungeon-master/quests/side" element={<DndDmQuestsSide />} />
        <Route
          path="/dnd/dungeon-master/quests/generator"
          element={<DndDmQuestGenerator />}
        />
        <Route path="/dnd/dungeon-master/establishments" element={<DndDmEstablishments />} />
        <Route path="/dnd/dungeon-master/tag-manager" element={<DndDmTagManager />} />
        <Route path="/dnd/dungeon-master/world-inventory" element={<DndDmWorldInventory />} />
        <Route path="/dnd/assets" element={<DndAssets />} />
        <Route path="/dnd/lore" element={<DndLore />} />
        <Route path="/dnd/piper" element={<DndVoiceLabs />} />
        <Route path="/dnd/piper/piper" element={<DndPiperOnly />} />
        <Route path="/dnd/piper/eleven" element={<DndElevenLabs />} />
        <Route path="/tools/voices" element={<DndVoiceLabs />} />
        <Route path="/tools/voices/piper" element={<DndPiperOnly />} />
        <Route path="/tools/voices/eleven" element={<DndElevenLabs />} />
        <Route path="/tools/voices/manage" element={<ManageVoices />} />
        <Route path="/dnd/discord" element={<DndDiscord />} />
        <Route path="/dnd/chat" element={<DndChat />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/users" element={<SettingsUsers />} />
        <Route path="/settings/vault" element={<SettingsVault />} />
        <Route path="/settings/discord" element={<SettingsDiscord />} />
        <Route path="/settings/appearance" element={<SettingsAppearance />} />
        <Route path="/settings/models" element={<SettingsModels />} />
        <Route path="/settings/devices" element={<SettingsDevices />} />
        <Route path="/settings/hotwords" element={<SettingsHotwords />} />
        <Route path="/settings/backup" element={<SettingsBackup />} />
        <Route path="/settings/advanced" element={<SettingsAdvanced />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/train" element={<Train />} />
        <Route path="/tools" element={<Tools />} />
        <Route path="/tools/whisper" element={<WhisperOutput />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/chat" element={<GeneralChat />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/fusion" element={<Fusion />} />
        <Route path="/loopmaker" element={<LoopMaker />} />
        <Route path="/beatmaker" element={<BeatMaker />} />
        <Route path="/album" element={<AlbumMaker />} />
        <Route path="/games" element={<Games />} />
        <Route path="/games/rain-blocks" element={<RainBlocks />} />
        <Route path="/games/sand-blocks" element={<SandBlocks />} />
        <Route path="/games/brick-breaker" element={<BrickBreaker />} />
        <Route path="/games/snake" element={<Snake />} />
      </Routes>
    </>
  );
}

