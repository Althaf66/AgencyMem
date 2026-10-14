import type { ClarityBand } from "./enums";

/**
 * The clarity band of a project. Used by the gateway for Proposal and by the Curator, so both get
 * the same band. `density` = (contradiction + unclear questions) per 1,000 words of file_chunk episodes.
 */
export function clarityBand(density: number): ClarityBand {
  if (density < 3) return "high";
  if (density < 6) return "medium";
  return "low";
}
