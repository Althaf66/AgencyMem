// Every "now" in the app comes from here, never from Date.now() directly (sample-app.md section 7).
// Order: the clock a test set through POST /api/test/reset, then APP_NOW, then the real time.
let testNow: number | null = null;

export function setTestNow(iso: string | null): void {
  testNow = iso ? Date.parse(iso) : null;
}

export function now(): Date {
  if (testNow !== null) return new Date(testNow);
  if (process.env.APP_NOW) return new Date(process.env.APP_NOW);
  return new Date();
}
