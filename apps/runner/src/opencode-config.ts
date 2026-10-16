// The two files a build worker writes into each card's worktree (technical design "Build loop and
// OpenCode", agent-prompts.md section 11): AGENTS.md, the card rules OpenCode reads, and
// opencode.json, its providers, the gateway's MCP server and the permissions. Keys and tokens stay
// {env:...} references, filled from the OpenCode process environment, so no secret lands on disk.
// Both names are in the repository's .git/info/exclude (repo.ts), so they are never committed.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CardKey } from "@agencymem/contracts";
import { insideAgencyMem, workspacesPath } from "./repo";

/** `buildModel` (the primary endpoint's) is optional: Build runs on the fallback only for now. */
export type BuildModels = { buildModel?: string; fallbackModel: string };

/** The card's AGENTS.md (agent-prompts.md section 11). */
export function agentsMd(cardKey: string): string {
  const key = CardKey.parse(cardKey);
  return `# Card ${key}

- Call the get_task_context tool first. Work only from what it returns.
- Commit only on branch card/${key}. Do not push.
- If the card note starts with "Merge conflict", run git merge main first and fix
  the conflicts.
- Give every element named in an acceptance criterion the data-testid it names.
- Make the card's Playwright tests pass. Run them with npx playwright test tests/e2e/${key}.
- Do not change the tests unless the card says so.
- Do not edit files outside this folder.
- When the tests pass on your last commit, call complete_task with the card version
  from get_task_context.
- If complete_task says the test run is pending, run sleep 30 and call it again.
  Stop after 10 tries.
- If complete_task says the version is old, call get_task_context again and check
  what changed before you continue.
`;
}

/**
 * The card's opencode.json. Only the model names are literal. OpenCode applies the last matching
 * permission rule, so each catch-all comes first.
 */
export function opencodeJson(models: BuildModels) {
  return {
    $schema: "https://opencode.ai/config.json",
    provider: {
      ...(models.buildModel && {
        agencymem: {
          npm: "@ai-sdk/openai-compatible",
          name: "AgencyMem primary endpoint",
          options: { baseURL: "{env:LLM_BASE_URL}", apiKey: "{env:LLM_API_KEY}" },
          models: { [models.buildModel]: { name: "Build model" } },
        },
      }),
      fallback: {
        npm: "@ai-sdk/openai-compatible",
        name: "OpenRouter fallback",
        options: { baseURL: "https://openrouter.ai/api/v1", apiKey: "{env:OPENROUTER_API_KEY}" },
        models: { [models.fallbackModel]: { name: "Build model (fallback)" } },
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
      external_directory: "deny",
      bash: {
        "*": "deny",
        "git status*": "allow",
        "git diff*": "allow",
        "git log*": "allow",
        "git add *": "allow",
        "git commit *": "allow",
        "git merge *": "allow",
        "npm ci *": "allow",
        "npm install *": "allow",
        "npx playwright *": "allow",
        "sleep *": "allow",
      },
    },
  };
}

/** Writes AGENTS.md and opencode.json into the worktree, replacing any from an earlier run. */
export async function writeCardConfig(
  tree: string,
  cardKey: string,
  models: BuildModels,
): Promise<void> {
  await writeFile(join(tree, "AGENTS.md"), agentsMd(cardKey));
  await writeFile(
    join(tree, "opencode.json"),
    `${JSON.stringify(opencodeJson(models), null, 2)}\n`,
  );
}

/**
 * The runner refuses to start when WORKSPACES_DIR is inside the AgencyMem repository: OpenCode
 * would find AgencyMem's own rules file there.
 */
export function assertWorkspacesOutside(workspacesDir: string): void {
  if (insideAgencyMem(workspacesPath(workspacesDir))) {
    throw new Error(`WORKSPACES_DIR ${workspacesDir} is inside the AgencyMem repository.`);
  }
}
