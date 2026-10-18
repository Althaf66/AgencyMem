import { describe, expect, it } from "vitest";
import { withoutIds } from "./Questionnaire";

const A = "01M55NRYW63CQT5Z2RC3WR4Y6R";
const B = "01M55NRYW63CQT5Z2RC3WR4Y6S";

describe("withoutIds", () => {
  it("drops the fact ids a model wrote into a question part, keeping the file names", () => {
    expect(withoutIds(`The kickoff notes (fact ${A}) say 20 minutes.`)).toBe(
      "The kickoff notes say 20 minutes.",
    );
    expect(withoutIds(`kickoff-notes.pdf (facts ${A}, ${B}) and the chat agree.`)).toBe(
      "kickoff-notes.pdf and the chat agree.",
    );
    expect(withoutIds(`The two notes (fact ${A} and fact ${B}) differ.`)).toBe(
      "The two notes differ.",
    );
    expect(withoutIds(`Support from ${A}.`)).toBe("Support from.");
  });

  it("leaves text without ids alone", () => {
    expect(withoutIds("Slots are 20 minutes (kickoff-notes.pdf).")).toBe(
      "Slots are 20 minutes (kickoff-notes.pdf).",
    );
  });
});
