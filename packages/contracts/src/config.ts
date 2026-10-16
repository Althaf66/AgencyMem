import { z } from "zod";

// An empty value in a .env file means "not set".
const blank = (v: unknown) => (v === "" ? undefined : v);

const required = z.preprocess(blank, z.string({ error: "is required" }));
const optional = z.preprocess(blank, z.string().optional());
const withDefault = (value: string) => z.preprocess(blank, z.string().default(value));
const url = (value: string) => z.preprocess(blank, z.url().default(value));
const requiredUrl = z.preprocess(blank, z.url({ error: "is required and must be a URL" }));
const int = (value: number, min = 1, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(blank, z.coerce.number().int().min(min).max(max).default(value));

/** Every environment variable of the Technical Design table, plus CONTEXT_RECALL_MAX_CHARS. */
export const ConfigSchema = z.object({
  FALKORDB_URL: url("redis://localhost:6380"),
  AM_PORT: int(4000, 1, 65535),
  GATEWAY_URL: url("http://127.0.0.1:4000"),
  AM_AGENT_TOKEN: required,
  AM_UI_TOKEN: required,
  AM_HOOK_TOKEN: required,
  LLM_BASE_URL: requiredUrl,
  LLM_API_KEY: required,
  LLM_MODEL_THIN: required,
  LLM_MODEL_DEEP: required,
  OPENROUTER_API_KEY: required,
  OPENROUTER_MODEL_THIN: required,
  OPENROUTER_MODEL_DEEP: required,
  LLM_TIMEOUT_MS: int(60000),
  OPENROUTER_BUILD_MODEL: required,
  OPENCODE_VERSION: withDefault("1.18.32"),
  BUILD_MODEL: required,
  BUILD_WORKERS: int(1, 1, 2),
  AM_PROJECT_ID: optional,
  AM_WORKER_ID: optional,
  LEASE_MS: int(600000),
  HEARTBEAT_MS: int(60000),
  CONTEXT_MAX_CHARS: int(12000),
  CONTEXT_RECALL_MAX_CHARS: int(40000),
  SIM_SEED: int(42, 0),
  SIM_PROJECTS: int(3),
  WORKSPACES_DIR: withDefault("../agencymem-workspaces"),
  UPLOADS_DIR: withDefault("./data/uploads"),
});

export type App = "gateway" | "runner" | "web" | "simulator";

const LLM = [
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL_THIN",
  "LLM_MODEL_DEEP",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL_THIN",
  "OPENROUTER_MODEL_DEEP",
] as const;

/** The variables with no default that each app needs in order to start. */
const REQUIRED_BY_APP = {
  gateway: ["AM_AGENT_TOKEN", "AM_UI_TOKEN", "AM_HOOK_TOKEN"],
  // Build runs on OpenRouter only (developer decision, 2026-10-16): BUILD_MODEL is optional.
  runner: ["AM_AGENT_TOKEN", "AM_HOOK_TOKEN", ...LLM, "OPENROUTER_BUILD_MODEL"],
  simulator: ["AM_UI_TOKEN", ...LLM],
  web: [],
} as const satisfies Record<App, readonly (keyof z.input<typeof ConfigSchema>)[]>;

type Key = keyof z.input<typeof ConfigSchema>;
const NO_DEFAULT: readonly Key[] = [
  "AM_AGENT_TOKEN",
  "AM_UI_TOKEN",
  "AM_HOOK_TOKEN",
  ...LLM,
  "BUILD_MODEL",
  "OPENROUTER_BUILD_MODEL",
];

/** Variables with no default stay `string | undefined`; an app only gets the ones it requires. */
export type Config = Omit<z.output<typeof ConfigSchema>, (typeof NO_DEFAULT)[number]> &
  Partial<Pick<z.output<typeof ConfigSchema>, (typeof NO_DEFAULT)[number]>>;

export class ConfigError extends Error {
  constructor(
    readonly app: App,
    readonly problems: string[],
  ) {
    super(
      `Cannot start ${app}: invalid configuration.\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\nSet these in .env (see .env.example) or in the environment.",
    );
    this.name = "ConfigError";
  }
}

/** Reads the environment for one app. Throws ConfigError that names every bad variable. */
export function loadConfig(env: Record<string, string | undefined>, app: App): Config {
  const needed: readonly Key[] = REQUIRED_BY_APP[app];
  const shape = Object.fromEntries(
    Object.entries(ConfigSchema.shape).map(([name, schema]) => [
      name,
      NO_DEFAULT.includes(name as Key) && !needed.includes(name as Key)
        ? optional // ponytail: a variable this app ignores is not validated beyond being text
        : schema,
    ]),
  );
  const result = z.object(shape).safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      app,
      result.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`),
    );
  }
  return result.data as Config;
}
