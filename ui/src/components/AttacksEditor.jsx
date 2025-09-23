const EMPTY_ATTACK = { name: '', bonus: '', damage: '', notes: '' };

export default function AttacksEditor({ attacks = [], onChange, onAdd, onRemove }) {
  const handleChange = (index, field, value) => {
    const next = attacks.map((attack, idx) =>
      idx === index ? { ...attack, [field]: value } : attack
    );
    onChange?.(next);
  };

  return (
    <div className="dnd-attacks-editor">
      {attacks.map((attack, index) => (
        <div key={index} className="dnd-attack-row">
          <input
            type="text"
            value={attack.name}
            placeholder="Attack or spell"
            onChange={(event) => handleChange(index, 'name', event.target.value)}
          />
          <input
            type="text"
            value={attack.bonus}
            placeholder="Bonus"
            onChange={(event) => handleChange(index, 'bonus', event.target.value)}
          />
          <input
            type="text"
            value={attack.damage}
            placeholder="Damage / Type"
            onChange={(event) => handleChange(index, 'damage', event.target.value)}
          />
          <input
            type="text"
            value={attack.notes}
            placeholder="Notes"
            onChange={(event) => handleChange(index, 'notes', event.target.value)}
          />
          <button
            type="button"
            className="dnd-attack-remove"
            onClick={() => onRemove?.(index)}
            aria-label={`Remove attack ${attack.name || index + 1}`}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="dnd-attack-add"
        onClick={() => onAdd?.(EMPTY_ATTACK)}
      >
        Add attack
      </button>
    </div>
  );
}
