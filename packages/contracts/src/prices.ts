// The meter's price table (technical design, Meter): US dollars per million tokens, by the model
// id as it is set in config (LLM_MODEL_*, OPENROUTER_MODEL_*, BUILD_MODEL). A model missing here
// costs 0 and logs one warning. In contracts so the gateway prices the health panel's rows too.
export type Price = { inPerMillion: number; outPerMillion: number };
export type Prices = Record<string, Price>;

// List prices on 2026-10-18 (Anthropic for Haiku, OpenRouter for DeepSeek).
export const PRICES: Prices = {
  // ponytail: the under-100K-token tier only; prompts above it cost $0.50 / $2.50.
  "claude-haiku-5-5": { inPerMillion: 0.1, outPerMillion: 0.5 },
  "deepseek/deepseek-v4.1-flash": { inPerMillion: 0.15, outPerMillion: 0.6 },
  "deepseek-v4.1-flash:free": { inPerMillion: 0, outPerMillion: 0 },
};

/** The cost of a call in US dollars, or null when the table has no price for the model. */
export function costOf(
  prices: Prices,
  model: string,
  tokensIn: number,
  tokensOut: number,
): number | null {
  const price = prices[model];
  if (!price) return null;
  return (tokensIn * price.inPerMillion + tokensOut * price.outPerMillion) / 1_000_000;
}
