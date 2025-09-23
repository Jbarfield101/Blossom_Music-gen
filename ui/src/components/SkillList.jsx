import { SKILL_LIST, formatModifier } from '../lib/playerSheet.js';

export default function SkillList({
  skills,
  abilityModifiers,
  onToggleProficiency,
  onToggleExpertise,
  onMiscChange,
}) {
  return (
    <table className="dnd-skill-table">
      <thead>
        <tr>
          <th scope="col">Skill</th>
          <th scope="col">Ability</th>
          <th scope="col">Total</th>
          <th scope="col">Prof.</th>
          <th scope="col">Expertise</th>
          <th scope="col">Misc</th>
        </tr>
      </thead>
      <tbody>
        {SKILL_LIST.map(({ key, label, ability }) => {
          const item = skills?.[key] || {};
          const miscValue = item.misc ?? '';
          const total = item.total ?? abilityModifiers?.[ability] ?? 0;
          return (
            <tr key={key}>
              <td>
                <label className="dnd-skill-label">
                  <input
                    type="checkbox"
                    checked={Boolean(item.proficient)}
                    onChange={() => onToggleProficiency?.(key)}
                    aria-label={`Toggle proficiency for ${label}`}
                  />
                  {label}
                </label>
              </td>
              <td>{ability.toUpperCase()}</td>
              <td className="dnd-skill-total">{formatModifier(total)}</td>
              <td className="dnd-skill-flag">
                {item.proficient ? '✔️' : ''}
              </td>
              <td className="dnd-skill-flag">
                <label className="dnd-skill-expertise">
                  <input
                    type="checkbox"
                    checked={Boolean(item.expertise)}
                    onChange={() => onToggleExpertise?.(key)}
                    aria-label={`Toggle expertise for ${label}`}
                  />
                </label>
              </td>
              <td>
                <input
                  type="number"
                  inputMode="numeric"
                  value={miscValue}
                  onChange={(event) => onMiscChange?.(key, event.target.value)}
                  className="dnd-skill-misc"
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
