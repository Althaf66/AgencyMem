import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { client, crsDue, gateDecision } from "./persona";

describe("gateDecision", () => {
  it("rejects the first G2 and approves the revision", () => {
    expect(gateDecision("G2", 0, null)).toEqual({
      decision: "reject",
      reason: "estimate too high, cut scope",
    });
    expect(gateDecision("G2", 1, null)).toEqual({ decision: "approve" });
  });

  it("approves G1, G3 and G6", () => {
    for (const key of ["G1", "G3", "G6"] as const) {
      expect(gateDecision(key, 0, null)).toEqual({ decision: "approve" });
    }
  });

  it("approves G5 in demo, with an override when the report failed", () => {
    expect(gateDecision("G5", 0, true)).toEqual({ decision: "approve", environment: "demo" });
    expect(gateDecision("G5", 0, false)).toEqual({
      decision: "approve",
      environment: "demo",
      override: true,
      reason: "demo run",
    });
  });
});

describe("crsDue", () => {
  it("sends CR i of N when Done build cards reach ceil(i x total / (N + 1))", () => {
    // N = 2, total = 6: thresholds 2 and 4
    expect(crsDue(2, 6, 1)).toBe(0);
    expect(crsDue(2, 6, 2)).toBe(1);
    expect(crsDue(2, 6, 3)).toBe(1);
    expect(crsDue(2, 6, 4)).toBe(2);
    expect(crsDue(2, 6, 6)).toBe(2);
    expect(crsDue(0, 6, 6)).toBe(0);
  });
});

describe("client", () => {
  it("names the project in X-AM-Project, which routes 9 and 11 need (contracts.md)", async () => {
    const fetch = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetch);
    await client({ url: "http://gw", token: "t" }, "persona:P1", "P1")(z.object({}), "/api/x");
    vi.unstubAllGlobals();
    expect(fetch).toHaveBeenCalledWith(
      "http://gw/api/x",
      expect.objectContaining({ headers: expect.objectContaining({ "X-AM-Project": "P1" }) }),
    );
  });
});
