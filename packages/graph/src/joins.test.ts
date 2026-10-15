import { describe, expect, it } from "vitest";
import { joinLessons } from "./joins";

const lesson = (id: string) => ({ id, featureKind: "calendar", ratio: 1.5, n: 2 });
const feature = (key: string, lessonIds: string[]) => ({
  key,
  estimate: {
    hours: 10.5,
    rawHours: 7,
    basis: "raw 7 h × 1.50 (lesson low, n=2) = 10.5 h",
    lessonIds,
  },
});

describe("joinLessons (technical design: lessonIds joined in the app)", () => {
  it("puts the agency Lessons each Estimate names in place of its lessonIds", () => {
    const joined = joinLessons(
      [feature("FEAT-01", ["L1", "L2"]), feature("FEAT-02", [])],
      [lesson("L1"), lesson("L2"), lesson("L3")],
    );
    expect(joined).toEqual([
      {
        key: "FEAT-01",
        estimate: {
          hours: 10.5,
          rawHours: 7,
          basis: "raw 7 h × 1.50 (lesson low, n=2) = 10.5 h",
          lessons: [lesson("L1"), lesson("L2")],
        },
      },
      {
        key: "FEAT-02",
        estimate: {
          hours: 10.5,
          rawHours: 7,
          basis: "raw 7 h × 1.50 (lesson low, n=2) = 10.5 h",
          lessons: [],
        },
      },
    ]);
  });

  it("drops an id with no Lesson in the agency graph", () => {
    const [joined] = joinLessons([feature("FEAT-01", ["L9", "L1"])], [lesson("L1")]);
    expect(joined!.estimate.lessons).toEqual([lesson("L1")]);
  });
});
