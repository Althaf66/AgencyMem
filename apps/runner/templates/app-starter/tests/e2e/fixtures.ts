import type { APIRequestContext } from "@playwright/test";

export async function resetApp(request: APIRequestContext, opts: { now: string }) {
  const res = await request.post("/api/test/reset", { data: { now: opts.now } });
  if (!res.ok()) throw new Error(`reset failed: ${res.status()}`);
}
