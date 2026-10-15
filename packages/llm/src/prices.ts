// The meter's price table (technical design, Meter): US dollars per million tokens, by the model
// id as it is set in config (LLM_MODEL_*, OPENROUTER_MODEL_*). A model missing here costs 0 and
// logs one warning. Add each configured model before the cost check (task 6.5).
export type Price = { inPerMillion: number; outPerMillion: number };
export type Prices = Record<string, Price>;

export const PRICES: Prices = {};
