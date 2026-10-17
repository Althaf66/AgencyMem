import { describe, expect, it } from "vitest";
import { namesIn } from "./recalled";

describe("namesIn", () => {
  it("collects node ids and keys at any depth, and skips text that is not an id", () => {
    const { ids, keys } = namesIn({
      item: { id: "01JA00000000000000000000W1", subjectId: "01JA00000000000000000000F1" },
      facts: [{ id: "01JA00000000000000000000F2", statement: "x" }],
      questions: [{ factIds: ["01JA00000000000000000000F3"], assumption: { id: "not-an-id" } }],
      requirement: { key: "REQ-01" },
      tasks: [{ key: "CARD-01", designKeys: ["SCR-01", "EP-02"] }],
    });
    expect([...ids].sort()).toEqual([
      "01JA00000000000000000000F1",
      "01JA00000000000000000000F2",
      "01JA00000000000000000000F3",
      "01JA00000000000000000000W1",
    ]);
    expect([...keys].sort()).toEqual(["CARD-01", "EP-02", "REQ-01", "SCR-01"]);
  });
});
