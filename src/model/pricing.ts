/**
 * Gemini Developer API, paid tier, Standard prices in USD per 1M text tokens, from
 * https://aistudio.google.com/docs/pricing (read 2026-11-28). Output prices include thinking
 * tokens. We run on the free tier (0 VND); these prices say what the same calls would cost paid.
 */
export interface ModelPrice {
  known: boolean;
  inputPerM: number;
  outputPerM: number;
}

interface PriceRow {
  model: string;
  inputPerM: number;
  outputPerM: number;
  /** From `until.at` on, the `until` prices replace the ones above. */
  until?: { at: string; inputPerM: number; outputPerM: number };
}

// 3.8 and 3.6 Flash: promotional rate through 2026-12-31, doubled from 2027-01-01.
const PROMO_END = "2027-01-01T00:00:00Z";
const PRICES: PriceRow[] = [
  {
    model: "gemini-3.8-flash",
    inputPerM: 0.75,
    outputPerM: 3.75,
    until: { at: PROMO_END, inputPerM: 1.5, outputPerM: 7.5 },
  },
  {
    model: "gemini-3.6-flash",
    inputPerM: 0.75,
    outputPerM: 3.75,
    until: { at: PROMO_END, inputPerM: 1.5, outputPerM: 7.5 },
  },
  { model: "gemini-3-flash-preview", inputPerM: 0.5, outputPerM: 3.0 },
  { model: "gemini-3.5-flash-lite", inputPerM: 0.3, outputPerM: 2.5 },
];

function priceAt(row: PriceRow, at: Date): { inputPerM: number; outputPerM: number } {
  if (row.until && at.getTime() >= Date.parse(row.until.at)) {
    return { inputPerM: row.until.inputPerM, outputPerM: row.until.outputPerM };
  }
  return { inputPerM: row.inputPerM, outputPerM: row.outputPerM };
}

/** The price of the model that answered (its `modelVersion`, which may carry a version suffix). */
export function priceFor(model: string, at: Date): ModelPrice {
  const row = PRICES.find((r) => model === r.model || model.startsWith(`${r.model}-`));
  if (row) return { known: true, ...priceAt(row, at) };
  // Unknown model: charge the dearest known rate, so a cost estimate is never understated.
  const all = PRICES.map((r) => priceAt(r, at));
  return {
    known: false,
    inputPerM: Math.max(...all.map((p) => p.inputPerM), 1.5),
    outputPerM: Math.max(...all.map((p) => p.outputPerM), 7.5),
  };
}

/** USD for one call; `outputTokens` must include thinking tokens (billed as output). */
export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  at: Date,
): number {
  const p = priceFor(model, at);
  return (inputTokens * p.inputPerM + outputTokens * p.outputPerM) / 1_000_000;
}
