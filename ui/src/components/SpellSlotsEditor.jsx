import { SPELL_SLOT_LEVELS } from '../lib/playerSheet.js';

const LABELS = {
  cantrips: 'Cantrips',
  level1: '1st',
  level2: '2nd',
  level3: '3rd',
  level4: '4th',
  level5: '5th',
  level6: '6th',
  level7: '7th',
  level8: '8th',
  level9: '9th',
};

export default function SpellSlotsEditor({ slots, onChange }) {
  return (
    <div className="dnd-spell-slots">
      {SPELL_SLOT_LEVELS.map((levelKey) => {
        const label = LABELS[levelKey] || levelKey;
        const value = slots?.[levelKey] ?? '';
        return (
          <label key={levelKey} className="dnd-spell-slot-row">
            <span>{label}</span>
            <input
              type="text"
              value={value}
              onChange={(event) => onChange?.(levelKey, event.target.value)}
              placeholder={levelKey === 'cantrips' ? 'Known cantrips' : 'Slots / expended'}
            />
          </label>
        );
      })}
    </div>
  );
}
