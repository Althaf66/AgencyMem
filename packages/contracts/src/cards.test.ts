import { describe, expect, it } from "vitest";
import { findCycle } from "./cards";

const card = (key: string, ...dependsOn: string[]) => ({ key, dependsOn });

describe("findCycle", () => {
  it("finds none in a chain, a diamond, or with an unknown key", () => {
    expect(findCycle([card("A"), card("B", "A"), card("C", "B")])).toBeNull();
    expect(findCycle([card("A"), card("B", "A"), card("C", "A"), card("D", "B", "C")])).toBeNull();
    expect(findCycle([card("A", "Z")])).toBeNull();
  });

  it("returns the cycle from a card back to itself", () => {
    expect(findCycle([card("A", "B"), card("B", "A")])).toEqual(["A", "B", "A"]);
    expect(findCycle([card("A", "A")])).toEqual(["A", "A"]);
    expect(findCycle([card("A"), card("B", "C"), card("C", "D"), card("D", "B")])).toEqual([
      "B",
      "C",
      "D",
      "B",
    ]);
  });
});
