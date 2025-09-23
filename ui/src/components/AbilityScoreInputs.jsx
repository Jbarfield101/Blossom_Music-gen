import { ABILITY_SCORES, formatModifier } from '../lib/playerSheet.js';

export default function AbilityScoreInputs({ scores, modifiers, onChange }) {
  return (
    <div className="dnd-ability-grid">
      {ABILITY_SCORES.map(({ key, label }) => {
        const scoreValue = scores?.[key];
        const displayValue = scoreValue === undefined || scoreValue === null ? '' : scoreValue;
        const modifier = modifiers?.[key] ?? 0;
        return (
          <div key={key} className="dnd-ability-card">
            <span className="dnd-ability-label">{label}</span>
            <input
              className="dnd-ability-score"
              type="number"
              min="1"
              max="30"
              inputMode="numeric"
              value={displayValue}
              onChange={(event) => onChange?.(key, event.target.value)}
            />
            <span className="dnd-ability-modifier">{formatModifier(modifier)}</span>
          </div>
        );
      })}
    </div>
  );
}
