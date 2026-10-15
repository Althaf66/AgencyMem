import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingest } from "@agencymem/ingest";
import { afterAll, describe, expect, it } from "vitest";
import { FIXTURES_DIR, checkSet } from "./build-fixtures";

describe("Done when: each planted item names the two source lines it comes from", () => {
  it.each(["A", "B", "C"] as const)(
    "set %s passes every check on the committed files",
    async (set) => {
      expect(await checkSet(join(FIXTURES_DIR, set))).toEqual([]);
    },
  );

  it("the negative fixture has no text layer", async () => {
    const data = await readFile(join(FIXTURES_DIR, "negative", "scanned.pdf"));
    expect(await ingest({ name: "scanned.pdf", data })).toMatchObject({ status: "no_text" });
  });
});

describe("checkSet reports each broken rule", () => {
  const temps: string[] = [];
  afterAll(() => Promise.all(temps.map((t) => rm(t, { recursive: true, force: true }))));

  /** A copy of set A with one file changed. */
  async function broken(file: string, change: (text: string) => string): Promise<string[]> {
    const dir = await mkdtemp(join(tmpdir(), "fixtures-"));
    temps.push(dir);
    await cp(join(FIXTURES_DIR, "A"), dir, { recursive: true });
    await writeFile(join(dir, file), change(await readFile(join(dir, file), "utf8")));
    return checkSet(dir);
  }
  const slot = "Each appointment slot is 20 minutes long.";

  it("passes on a CRLF checkout of the text files", async () => {
    const crlf = (t: string) => t.replace(/\n/g, "\r\n");
    const dir = await mkdtemp(join(tmpdir(), "fixtures-"));
    temps.push(dir);
    await cp(join(FIXTURES_DIR, "A"), dir, { recursive: true });
    for (const file of ["kickoff-notes", "client-summary", "whatsapp-chat"]) {
      const path = join(dir, "source", `${file}.txt`);
      await writeFile(path, crlf(await readFile(path, "utf8")));
    }
    const chat = join(dir, "whatsapp-chat.txt");
    await writeFile(chat, crlf(await readFile(chat, "utf8")));
    expect(await checkSet(dir)).toEqual([]);
  });

  it("filler edited in source/ without a rebuild", async () => {
    const errors = await broken("source/kickoff-notes.txt", (t) => `${t}\nThe team met again.\n`);
    expect(errors).toContainEqual(expect.stringMatching(/kickoff-notes.pdf does not match/));
  });

  it("a planted line missing from its file", async () => {
    const errors = await broken("source/kickoff-notes.txt", (t) => t.replace(slot, "Slots."));
    expect(errors).toContainEqual(expect.stringMatching(/C-A1.*not found/));
  });

  it("a planted line that appears twice", async () => {
    const errors = await broken("source/kickoff-notes.txt", (t) => `${t}\n${slot}\n`);
    expect(errors).toContainEqual(expect.stringMatching(/C-A1.*2 times/));
  });

  it("a fixed line over 90 characters", async () => {
    const errors = await broken("planted.json", (t) =>
      t.replace(JSON.stringify(slot), JSON.stringify(slot + " x".repeat(30))),
    );
    expect(errors).toContainEqual(expect.stringMatching(/C-A1.*over 90/));
  });

  it("both lines of a contradiction in one file", async () => {
    const errors = await broken("planted.json", (t) =>
      t.replace(
        `"client-summary.docx", "text": "Appointments`,
        `"kickoff-notes.pdf", "text": "Appointments`,
      ),
    );
    expect(errors).toContainEqual(expect.stringMatching(/C-A1.*same file/));
  });

  it("a banned word in filler", async () => {
    const errors = await broken(
      "source/client-summary.txt",
      (t) => `${t}\nThe team will reply soon.\n`,
    );
    expect(errors).toContainEqual(expect.stringMatching(/"soon"/));
  });

  it("a planted item with no answer in the truth sheet", async () => {
    const errors = await broken("truth.json", (t) =>
      t.replace(`"plantedId": "U-A3"`, `"plantedId": "U-A9"`),
    );
    expect(errors).toContainEqual(expect.stringMatching(/U-A3.*no answer/));
  });
});
