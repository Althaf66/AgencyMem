// The card dependency rule shared by write_cards and the Planner's check (agent-prompts.md
// section 6: no cycles).

/**
 * The first dependency cycle among `cards`, as card keys from a card back to itself (for example
 * ["CARD-01", "CARD-02", "CARD-01"]), or null. Keys that are not cards are ignored.
 */
export function findCycle(cards: { key: string; dependsOn: string[] }[]): string[] | null {
  const deps = new Map(cards.map((c) => [c.key, c.dependsOn]));
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (key: string): string[] | null => {
    const at = path.indexOf(key);
    if (at >= 0) return [...path.slice(at), key];
    if (done.has(key) || !deps.has(key)) return null;
    path.push(key);
    for (const next of deps.get(key)!) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    done.add(key);
    return null;
  };
  for (const { key } of cards) {
    const cycle = visit(key);
    if (cycle) return cycle;
  }
  return null;
}
