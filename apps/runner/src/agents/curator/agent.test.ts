// Task 5.4, Done when: no lesson text contains a client entity name, email or URL. The runner's
// anonymity step (agent-prompts.md section 9) before write_case_study, and its one retry.
import { describe, expect, it } from "vitest";
import type { Recall } from "../../agent";
import { ToolRejected } from "../../mcp-client";
import { anonymise, checkLessons, curator } from "./agent";
import type { CuratorOutput } from "./output";

const metrics = {
  estimateError: 0.2,
  questions: 6,
  contradictions: 2,
  changeRequests: 1,
  cardsReopened: 1,
  defects: 1,
  cards: 4,
  firstPassCards: 3,
  clarityBand: "medium",
};
const recall = {
  item: { id: "01JA00000000000000000000W1", kind: "curator", note: null },
  project: { clientName: "Sunrise Dental Group", clarity: { density: 4, band: "medium" } },
  context: {
    handoffs: [{ agent: "proposal", kind: "proposal", summary: "Wrote 3 features", doneAt: 1 }],
    metrics,
    features: [
      {
        key: "FEAT-01",
        featureKind: "calendar",
        estimate: { hours: 12, rawHours: 10 },
        actualHours: 15,
      },
      { key: "FEAT-02", featureKind: "form", estimate: { hours: 6, rawHours: 5 }, actualHours: 5 },
    ],
    entities: [
      { key: "clinic", name: "Sunrise Dental", aliases: ["Sunrise", "SDG"] },
      { key: "doctor", name: "Dr. Amara Okafor", aliases: [] },
    ],
  },
} as unknown as Recall;

const output = (over: Partial<CuratorOutput> = {}): CuratorOutput => ({
  lessonsLearned:
    "Sunrise Dental asked late for a lunch break; mail ops@sunrise.example or see https://sunrise.example/notes.",
  lessons: [
    {
      featureKind: "calendar",
      text: "Calendars at sdg ran 50% over: Dr. Amara Okafor's hidden rules.",
    },
    { featureKind: "form", text: "Forms ran close to the estimate." },
  ],
  ...over,
});

const NAMES = ["Sunrise Dental", "Sunrise", "SDG", "Dr. Amara Okafor", "Sunrise Dental Group"];

describe("anonymise (agent-prompts.md section 9, act step 2)", () => {
  it("replaces names and aliases in any case, and removes emails and URLs", () => {
    expect(anonymise(output().lessonsLearned, NAMES)).toBe(
      "the client asked late for a lunch break; mail  or see ",
    );
    expect(anonymise(output().lessons[0]!.text, NAMES)).toBe(
      "Calendars at the client ran 50% over: the client's hidden rules.",
    );
  });

  it("matches whole words only", () => {
    expect(anonymise("Sunrises and SDGs stay.", NAMES)).toBe("Sunrises and SDGs stay.");
  });
});

describe("Curator agent (agent-prompts.md section 9)", () => {
  it("has the preamble, its rules, the TASK line, deep tier and no handoff", () => {
    expect(curator.prompt).toMatch(/^You are the Curator agent of AgencyMem/);
    expect(curator.prompt).toMatch(/No names of clients, people, places or products/);
    expect(curator.task).toBe("Write the lessons learned and one lesson per feature kind.");
    expect(curator.kinds).toEqual(["curator"]);
    expect(curator.tier).toBe("deep");
    expect(curator.handoff).toEqual([]);
  });

  it("sends the metrics, the features, the entities and the handoffs", () => {
    expect(curator.select(recall)).toEqual({
      metrics,
      features: recall.context.features,
      entities: recall.context.entities,
      handoffs: recall.context.handoffs,
    });
  });

  it("wants one lesson per featureKind of the project, and no other", () => {
    expect(checkLessons(output(), recall)).toEqual([]);
    expect(
      checkLessons(
        output({
          lessons: [
            { featureKind: "calendar", text: "a" },
            { featureKind: "calendar", text: "b" },
            { featureKind: "auth", text: "c" },
          ],
        }),
        recall,
      ),
    ).toEqual([
      "lessons: calendar has more than one lesson",
      "lessons: auth is not a featureKind of the project",
      "lessons: form has no lesson",
    ]);
  });

  it("writes anonymous texts and one record per feature", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const result = await curator.act(output(), recall, {
      call: (async (name: string, input: Record<string, unknown>) => {
        calls.push([name, input]);
        return {
          caseStudyId: "01JA00000000000000000000C1",
          recordIds: [],
          lessonIds: ["L1", "L2"],
        };
      }) as never,
      say: async () => {},
    });
    expect(calls).toEqual([
      [
        "write_case_study",
        {
          itemId: recall.item.id,
          caseStudy: {
            metrics,
            lessonsLearned: "the client asked late for a lunch break; mail  or see",
          },
          records: [
            { featureKind: "calendar", clarityBand: "medium", estimate: 12, raw: 10, actual: 15 },
            { featureKind: "form", clarityBand: "medium", estimate: 6, raw: 5, actual: 5 },
          ],
          lessons: [
            {
              featureKind: "calendar",
              clarityBand: "medium",
              text: "Calendars at the client ran 50% over: the client's hidden rules.",
            },
            {
              featureKind: "form",
              clarityBand: "medium",
              text: "Forms ran close to the estimate.",
            },
          ],
        },
      ],
    ]);
    expect(result.outputIds).toEqual(["01JA00000000000000000000C1", "L1", "L2"]);
  });

  it("after an anonymity rejection, removes the matched text and tries once more", async () => {
    const sent: { lessons: { text: string }[] }[] = [];
    const rejection = (match: string) =>
      new ToolRejected("write_case_study", {
        code: "GUARD_REJECTED",
        guard: "anonymity",
        reason: "The text names the client.",
        details: { reasonCode: "NAME_FOUND", match },
      });
    const call = async (_: string, input: { lessons: { text: string }[] }) => {
      sent.push(input);
      if (sent.length === 1) throw rejection("Okafor");
      return { caseStudyId: "01JA00000000000000000000C1", recordIds: [], lessonIds: [] };
    };
    const out = output({
      lessons: [
        ...output().lessons.slice(1),
        { featureKind: "calendar", text: "Ask okafor early." },
      ],
    });
    await curator.act(out, recall, { call: call as never, say: async () => {} });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.lessons[1]!.text).toBe("Ask okafor early.");
    expect(sent[1]!.lessons[1]!.text).toBe("Ask  early.");

    // A second rejection is not retried again.
    const always = async () => {
      throw rejection("x");
    };
    await expect(
      curator.act(output(), recall, { call: always as never, say: async () => {} }),
    ).rejects.toThrow(ToolRejected);
  });
});
