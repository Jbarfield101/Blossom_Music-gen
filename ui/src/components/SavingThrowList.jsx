import { ABILITY_SCORES, formatModifier } from '../lib/playerSheet.js';

export default function SavingThrowList({
  savingThrows,
  abilityModifiers,
  proficiencyBonus,
  onToggle,
  onMiscChange,
}) {
  return (
    <div className="dnd-saving-throws">
      {ABILITY_SCORES.map(({ key, label }) => {
        const item = savingThrows?.[key] || {};
        const miscValue = item.misc ?? '';
        const total = item.total ?? abilityModifiers?.[key] ?? 0;
        return (
          <div key={key} className="dnd-saving-throw-row">
            <label className="dnd-saving-throw-main">
              <input
                type="checkbox"
                checked={Boolean(item.proficient)}
                onChange={() => onToggle?.(key)}
              />
              <span className="dnd-saving-throw-label">{label}</span>
            </label>
            <div className="dnd-saving-throw-values" aria-label={`${label} save value`}>
              <span className="dnd-saving-throw-total">{formatModifier(total)}</span>
              <span className="dnd-saving-throw-mod">MOD {formatModifier(abilityModifiers?.[key] ?? 0)}</span>
              <span className="dnd-saving-throw-prof">PB {formatModifier(item.proficient ? proficiencyBonus : 0)}</span>
            </div>
            <label className="dnd-saving-throw-misc">
              <span>Misc</span>
              <input
                type="number"
                inputMode="numeric"
                value={miscValue}
                onChange={(event) => onMiscChange?.(key, event.target.value)}
              />
            </label>
          </div>
        );
      })}
    </div>
  );
}
