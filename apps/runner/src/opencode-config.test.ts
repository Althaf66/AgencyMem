// Task 4.4, Done when: the written files match the Technical Design and hold no secret. The card
// AGENTS.md is agent-prompts.md section 11; opencode.json is the technical design version plus the
// section 11 bash rules.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { assertWorkspacesOutside, opencodeJson, writeCardConfig } from "./opencode-config";
import { workspacesPath } from "./repo";

const tree = mkdtempSync(join(tmpdir(), "am-wt-"));
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const models = { buildModel: "build-model-x", fallbackModel: "vendor/fallback-model-y" };

describe("writeCardConfig", () => {
  it("leaves out the primary provider when BUILD_MODEL is not set (Build on OpenRouter only)", () => {
    const json = opencodeJson({ fallbackModel: "vendor/fallback-model-y" });
    expect(Object.keys(json.provider)).toEqual(["fallback"]);
  });

  it("Done when: writes AGENTS.md and opencode.json as the docs give them, with no secret", async () => {
    // Real-looking values for every key and token the files refer to.
    const secrets = {
      LLM_API_KEY: "sk-primary-secret-1",
      OPENROUTER_API_KEY: "sk-or-secret-2",
      AM_AGENT_TOKEN: "agent-token-secret-3",
      AM_HOOK_TOKEN: "hook-token-secret-4",
      LLM_BASE_URL: "http://127.0.0.1:9999/v1",
    };
    const saved = Object.fromEntries(Object.keys(secrets).map((k) => [k, process.env[k]]));
    Object.assign(process.env, secrets);
    try {
      await writeCardConfig(tree, "CARD-12", models);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }

    const agentsMd = readFileSync(join(tree, "AGENTS.md"), "utf8");
    expect(agentsMd).toBe(`# Card CARD-12

- Call the get_task_context tool first. Work only from what it returns.
- Commit only on branch card/CARD-12. Do not push.
- If the card note starts with "Merge conflict", run git merge main first and fix
  the conflicts.
- Give every element named in an acceptance criterion the data-testid it names.
- Make the card's Playwright tests pass. Run them with npx playwright test tests/e2e/CARD-12.
- Do not change the tests unless the card says so.
- Do not edit files outside this folder.
- When the tests pass on your last commit, call complete_task with the card version
  from get_task_context.
- If complete_task says the test run is pending, run sleep 30 and call it again.
  Stop after 10 tries.
- If complete_task says the version is old, call get_task_context again and check
  what changed before you continue.
`);

    const raw = readFileSync(join(tree, "opencode.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({
      $schema: "https://opencode.ai/config.json",
      provider: {
        agencymem: {
          npm: "@ai-sdk/openai-compatible",
          name: "AgencyMem primary endpoint",
          options: { baseURL: "{env:LLM_BASE_URL}", apiKey: "{env:LLM_API_KEY}" },
          models: { "build-model-x": { name: "Build model" } },
        },
        fallback: {
          npm: "@ai-sdk/openai-compatible",
          name: "OpenRouter fallback",
          options: { baseURL: "https://openrouter.ai/api/v1", apiKey: "{env:OPENROUTER_API_KEY}" },
          models: { "vendor/fallback-model-y": { name: "Build model (fallback)" } },
        },
      },
      mcp: {
        agencymem: {
          type: "remote",
          url: "{env:GATEWAY_URL}/mcp",
          headers: {
            "X-AM-Token": "{env:AM_AGENT_TOKEN}",
            "X-AM-Agent": "build",
            "X-AM-Project": "{env:AM_PROJECT_ID}",
            "X-AM-Worker": "{env:AM_WORKER_ID}",
          },
        },
      },
      permission: {
        "*": "allow",
        webfetch: "deny",
        bash: {
          "*": "deny",
          "git status*": "allow",
          "git diff*": "allow",
          "git log*": "allow",
          "git add *": "allow",
          "git commit *": "allow",
          "git merge *": "allow",
          "npm *": "allow",
          "npx playwright *": "allow",
          "sleep *": "allow",
        },
      },
    });
    // OpenCode applies the last matching rule, so each catch-all comes first.
    expect(Object.keys(JSON.parse(raw).permission.bash)[0]).toBe("*");
    for (const value of Object.values(secrets)) {
      expect(raw).not.toContain(value);
      expect(agentsMd).not.toContain(value);
    }
  });

  it("refuses a card key that is not one", async () => {
    await expect(writeCardConfig(tree, "../x", models)).rejects.toThrow();
  });
});

describe("assertWorkspacesOutside", () => {
  it("refuses a WORKSPACES_DIR inside the AgencyMem repository, and accepts one outside", () => {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    expect(() => assertWorkspacesOutside(join(root, "workspaces"))).toThrow("inside");
    expect(() => assertWorkspacesOutside(root)).toThrow("inside");
    expect(() => assertWorkspacesOutside(tree)).not.toThrow();
  });

  it("reads a relative WORKSPACES_DIR from the AgencyMem root, so the default is a sibling folder", () => {
    // pnpm dev runs the runner in apps/runner; the default must not land in apps/.
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    expect(() => assertWorkspacesOutside("../agencymem-workspaces")).not.toThrow();
    expect(workspacesPath("../agencymem-workspaces")).toBe(
      join(root, "..", "agencymem-workspaces"),
    );
    expect(() => assertWorkspacesOutside("./workspaces")).toThrow("inside");
  });
});
