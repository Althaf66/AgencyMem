import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConfigError, ConfigSchema, loadConfig } from "./config";

const tokens = { AM_AGENT_TOKEN: "a", AM_UI_TOKEN: "u", AM_HOOK_TOKEN: "h" };
const llm = {
  LLM_BASE_URL: "http://llm.local/v1",
  LLM_API_KEY: "k",
  LLM_MODEL_THIN: "thin",
  LLM_MODEL_DEEP: "deep",
  OPENROUTER_API_KEY: "k2",
  OPENROUTER_MODEL_THIN: "or-thin",
  OPENROUTER_MODEL_DEEP: "or-deep",
};
const build = { BUILD_MODEL: "b", OPENROUTER_BUILD_MODEL: "or-b" };

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return e.message;
    throw e;
  }
  throw new Error("expected loadConfig to throw ConfigError");
}

describe("loadConfig", () => {
  it("names every missing required variable for the gateway", () => {
    const msg = message(() => loadConfig({}, "gateway"));
    for (const name of Object.keys(tokens)) expect(msg).toContain(name);
    expect(msg).not.toContain("LLM_API_KEY");
  });

  it("names every missing required variable for the runner", () => {
    const msg = message(() => loadConfig({}, "runner"));
    for (const name of [
      "AM_AGENT_TOKEN",
      "AM_HOOK_TOKEN",
      ...Object.keys(llm),
      ...Object.keys(build),
    ]) {
      expect(msg).toContain(name);
    }
    expect(msg).not.toContain("AM_UI_TOKEN");
  });

  it("treats an empty string as missing", () => {
    expect(message(() => loadConfig({ ...tokens, AM_UI_TOKEN: "" }, "gateway"))).toContain(
      "AM_UI_TOKEN",
    );
  });

  it("lets an app ignore blank variables it does not require", () => {
    const blanks = { ...tokens, LLM_API_KEY: "", LLM_BASE_URL: "", BUILD_MODEL: "" };
    expect(loadConfig(blanks, "gateway").LLM_API_KEY).toBeUndefined();
    expect(loadConfig({ AM_UI_TOKEN: "", LLM_API_KEY: "" }, "web").AM_UI_TOKEN).toBeUndefined();
  });

  it("needs nothing for the web app", () => {
    expect(loadConfig({}, "web").AM_PORT).toBe(4000);
  });

  it("fills in the documented defaults", () => {
    expect(loadConfig(tokens, "gateway")).toMatchObject({
      FALKORDB_URL: "redis://localhost:6380",
      AM_PORT: 4000,
      GATEWAY_URL: "http://127.0.0.1:4000",
      LLM_TIMEOUT_MS: 60000,
      OPENCODE_VERSION: "1.18.32",
      BUILD_WORKERS: 1,
      LEASE_MS: 600000,
      HEARTBEAT_MS: 60000,
      CONTEXT_MAX_CHARS: 12000,
      CONTEXT_RECALL_MAX_CHARS: 40000,
      SIM_SEED: 42,
      SIM_PROJECTS: 3,
      WORKSPACES_DIR: "../agencymem-workspaces",
      UPLOADS_DIR: "./data/uploads",
    });
  });

  it("coerces numbers from strings", () => {
    expect(loadConfig({ ...tokens, AM_PORT: "5000", SIM_SEED: "100" }, "gateway")).toMatchObject({
      AM_PORT: 5000,
      SIM_SEED: 100,
    });
  });

  it("rejects BUILD_WORKERS above 2", () => {
    expect(message(() => loadConfig({ ...tokens, BUILD_WORKERS: "3" }, "gateway"))).toContain(
      "BUILD_WORKERS",
    );
  });

  it("rejects a value that is not a number", () => {
    expect(message(() => loadConfig({ ...tokens, AM_PORT: "abc" }, "gateway"))).toContain(
      "AM_PORT",
    );
  });

  it("parses a full valid environment for the runner", () => {
    const cfg = loadConfig({ ...tokens, ...llm, ...build }, "runner");
    expect(cfg.BUILD_MODEL).toBe("b");
    expect(cfg.LLM_API_KEY).toBe("k");
  });
});

describe(".env.example", () => {
  it("names every config variable and nothing else", () => {
    const text = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    const names = text
      .split(/\r?\n/)
      .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
      .filter((n): n is string => n !== undefined)
      .sort();
    expect(names).toEqual(Object.keys(ConfigSchema.shape).sort());
  });

  it("holds no value", () => {
    const text = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    expect(text.split(/\r?\n/).filter((l) => /^[A-Z][A-Z0-9_]*=.+/.test(l))).toEqual([]);
  });
});
