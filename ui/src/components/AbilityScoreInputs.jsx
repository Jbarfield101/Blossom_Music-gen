import { ABILITY_SCORES, formatModifier, deriveAbilityModifier } from '../lib/playerSheet.js';

const POINT_COST = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};

function totalCostFor(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 0;
  if (s <= 8) return 0;
  if (s >= 15) return POINT_COST[15];
  return POINT_COST[s] ?? 0;
}

export default function AbilityScoreInputs({
  scores,
  modifiers,
  onChange,
  pointBuy = false,
  pointBuyPool = 27,
  pointBuyMin = 8,
  pointBuyMax = 15,
  bonusMap = {},
}) {
  if (!pointBuy) {
    return (
      <div className="dnd-ability-grid">
        {ABILITY_SCORES.map(({ key, label }) => {
          const scoreValue = scores?.[key];
          const displayValue = scoreValue === undefined || scoreValue === null ? '' : scoreValue;
          const bonus = Number(bonusMap?.[key] || 0);
          const effective = Number(displayValue || 0) + (Number.isFinite(bonus) ? bonus : 0);
          const modifier = Number.isFinite(bonus)
            ? deriveAbilityModifier(effective)
            : (modifiers?.[key] ?? 0);
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
              {Number.isFinite(bonus) && bonus > 0 && (
                <div className="muted" style={{ fontSize: 12 }}>+{bonus} racial/class → {effective}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Point-buy mode
  const baseCost = ABILITY_SCORES.reduce((sum, { key }) => {
    const v = Number(scores?.[key] ?? pointBuyMin);
    return sum + Math.max(0, totalCostFor(v) - totalCostFor(pointBuyMin));
  }, 0);
  const remaining = Math.max(0, pointBuyPool - baseCost);

  const adjust = (key, delta) => {
    const current = Number(scores?.[key] ?? pointBuyMin);
    let next = current + delta;
    if (!Number.isFinite(next)) return;
    if (next < pointBuyMin) next = pointBuyMin;
    if (next > pointBuyMax) next = pointBuyMax;
    const currentCost = Math.max(0, totalCostFor(current) - totalCostFor(pointBuyMin));
    const nextCost = Math.max(0, totalCostFor(next) - totalCostFor(pointBuyMin));
    const newTotal = baseCost - currentCost + nextCost;
    if (newTotal > pointBuyPool) return; // not enough points
    onChange?.(key, next);
  };

  return (
    <div>
      <div className="muted" style={{ marginBottom: '0.5rem' }}>Point Buy · Points remaining: {remaining}</div>
      <div className="dnd-ability-grid">
        {ABILITY_SCORES.map(({ key, label }) => {
          const raw = scores?.[key];
          let scoreValue = Number(raw ?? pointBuyMin);
          if (!Number.isFinite(scoreValue)) scoreValue = pointBuyMin;
          if (scoreValue < pointBuyMin) scoreValue = pointBuyMin;
          if (scoreValue > pointBuyMax) scoreValue = pointBuyMax;
          const bonus = Number(bonusMap?.[key] || 0);
          const effective = scoreValue + (Number.isFinite(bonus) ? bonus : 0);
          const modifier = Number.isFinite(bonus)
            ? deriveAbilityModifier(effective)
            : (modifiers?.[key] ?? 0);
          const canDec = scoreValue > pointBuyMin;
          const incCost = Math.max(0, totalCostFor(scoreValue + 1) - totalCostFor(pointBuyMin)) - Math.max(0, totalCostFor(scoreValue) - totalCostFor(pointBuyMin));
          const canInc = scoreValue < pointBuyMax && baseCost + incCost <= pointBuyPool;
          return (
            <div key={key} className="dnd-ability-card">
              <span className="dnd-ability-label">{label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button type="button" onClick={() => adjust(key, -1)} disabled={!canDec}>-</button>
                <div className="dnd-ability-score" style={{ minWidth: 48, textAlign: 'center' }}>{effective}</div>
                <button type="button" onClick={() => adjust(key, +1)} disabled={!canInc}>+</button>
              </div>
              <span className="dnd-ability-modifier">{formatModifier(modifier)}</span>
              {Number.isFinite(bonus) && bonus > 0 && (
                <div className="muted" style={{ fontSize: 12 }}>Base {scoreValue} + {bonus}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="muted" style={{ marginTop: '0.25rem' }}>Min {pointBuyMin}, Max {pointBuyMax} before racial bonuses. Pool {pointBuyPool}.</div>
    </div>
  );
}
