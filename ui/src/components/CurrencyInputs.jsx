const CURRENCIES = [
  { key: 'cp', label: 'CP' },
  { key: 'sp', label: 'SP' },
  { key: 'ep', label: 'EP' },
  { key: 'gp', label: 'GP' },
  { key: 'pp', label: 'PP' },
];

export default function CurrencyInputs({ values, onChange }) {
  return (
    <div className="dnd-currency-grid">
      {CURRENCIES.map(({ key, label }) => {
        const value = values?.[key] ?? '';
        return (
          <label key={key} className="dnd-currency-field">
            <span>{label}</span>
            <input
              type="text"
              inputMode="numeric"
              value={value}
              onChange={(event) => onChange?.(key, event.target.value)}
            />
          </label>
        );
      })}
    </div>
  );
}
