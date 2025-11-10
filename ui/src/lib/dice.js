const TERM_PATTERN = /([+-]?)([^+-]+)/g;

function randomIntInclusive(min, max) {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
    const range = max - min + 1;
    const randomBuffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(randomBuffer);
    return min + (randomBuffer[0] % range);
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function assertInRange(value, min, max, label) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`);
  }
  if (value < min) {
    throw new Error(`${label} must be at least ${min}.`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`${label} must be at most ${max}.`);
  }
}

export function rollDiceExpression(expression) {
  const normalized = (expression || '').replace(/\s+/g, '').toLowerCase();
  if (!normalized) {
    throw new Error("Provide a dice expression such as '2d6+3'.");
  }

  let working = normalized;
  if (!/^[+-]/.test(working)) {
    working = `+${working}`;
  }

  let match;
  let consumed = '';
  let total = 0;
  const breakdown = [];

  TERM_PATTERN.lastIndex = 0;
  while ((match = TERM_PATTERN.exec(working)) !== null) {
    consumed += match[0];
    const sign = match[1] === '-' ? -1 : 1;
    const body = match[2];
    if (body.includes('d')) {
      const [countRaw, sidesRaw] = body.split('d', 2);
      const count = countRaw ? parseInt(countRaw, 10) : 1;
      const sides = parseInt(sidesRaw, 10);
      assertInRange(count, 1, 200, 'Dice count');
      assertInRange(sides, 2, 1000, 'Dice sides');

      const rolls = Array.from({ length: count }, () => randomIntInclusive(1, sides));
      const subtotal = rolls.reduce((sum, value) => sum + value, 0);
      total += sign * subtotal;
      breakdown.push({
        type: 'dice',
        sign,
        expression: `${count || 1}d${sides}`,
        rolls,
        subtotal,
      });
    } else {
      const modifier = parseInt(body, 10);
      if (!Number.isFinite(modifier)) {
        throw new Error(`Invalid modifier: ${body}`);
      }
      total += sign * modifier;
      breakdown.push({
        type: 'modifier',
        sign,
        value: modifier,
      });
    }
  }

  if (consumed !== working) {
    throw new Error(`Invalid dice expression: ${expression}`);
  }

  return {
    total,
    breakdown,
  };
}
