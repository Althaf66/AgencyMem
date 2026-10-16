// fixtures.md section 5: the hidden traits of a client, drawn from SIM_SEED + projectIndex, and the
// actual hours of each feature at close. Never sent to the graph, except the actual hours.
import { FeatureKind } from "@agencymem/contracts";

export type Sim = {
  traits: { clarity: number; scopeCreep: number; complexity: number };
  eps: Record<FeatureKind, number>;
  M: number;
  changeRequests: number;
};

/** mulberry32: a small seeded generator of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawSim(seed: number, projectIndex: number): Sim {
  const rng = mulberry32(seed + projectIndex);
  const clarity = rng(),
    scopeCreep = rng(),
    complexity = rng();
  // One draw per featureKind in enum order, so a feature's hours do not depend on the feature count.
  const eps = Object.fromEntries(FeatureKind.options.map((k) => [k, -0.1 + 0.2 * rng()])) as Record<
    FeatureKind,
    number
  >;
  return {
    traits: { clarity, scopeCreep, complexity },
    eps,
    M: 1 + 0.6 * complexity + 0.4 * scopeCreep + 0.5 * (1 - clarity),
    changeRequests: Math.round(3 * scopeCreep),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** C2: base is the raw estimate, before the lesson ratio. */
export function actualHours(
  features: { id: string; featureKind: FeatureKind; rawHours: number }[],
  sim: Sim,
): { featureId: string; actualHours: number }[] {
  return features.map((f) => ({
    featureId: f.id,
    actualHours: round1(f.rawHours * sim.M * (1 + sim.eps[f.featureKind])),
  }));
}
