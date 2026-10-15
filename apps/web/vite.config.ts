import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig(({ command, mode }) => {
  // The dev proxy carries the UI token to the gateway, so the page never holds it (AGENTS.md
  // rule 10). Only the dev server reads it; builds and tests need no environment. The proxy
  // holds the token, so do not expose it with `vite --host`.
  // ponytail: reads the two variables itself; the config is TypeScript source that Vite does not
  // compile for its own config file.
  const proxy = () => {
    const env = { ...loadEnv(mode, ROOT, ""), ...process.env };
    if (!env.AM_UI_TOKEN) throw new Error("web: AM_UI_TOKEN is required (see .env.example)");
    const gateway = env.GATEWAY_URL || "http://127.0.0.1:4000";
    const token = encodeURIComponent(env.AM_UI_TOKEN);
    return {
      "/api": { target: gateway, headers: { "X-AM-Token": env.AM_UI_TOKEN } },
      "/ws": {
        target: gateway.replace(/^http/, "ws"),
        ws: true,
        rewrite: (path: string) => `${path}${path.includes("?") ? "&" : "?"}token=${token}`,
        // Browsers apply no CORS to WebSockets: refuse a page from another origin, which would
        // otherwise get the token attached.
        configure: (proxy: { on(event: "proxyReqWs", fn: (...args: never[]) => void): void }) =>
          proxy.on(
            "proxyReqWs",
            (
              _req: unknown,
              incoming: { headers: { origin?: string; host?: string } },
              socket: { destroy(): void },
            ) => {
              const { origin, host } = incoming.headers;
              if (origin && new URL(origin).host !== host) socket.destroy();
            },
          ),
      },
    };
  };
  return {
    plugins: [react()],
    server: command === "serve" && mode !== "test" ? { proxy: proxy() } : {},
    test: { name: "web", environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
  };
});
