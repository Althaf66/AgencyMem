import { reject, type GuardResult } from "./run";

/** Rejects claiming a card while a card it depends on is not Done. `openKeys` are those cards. */
export function deps(openKeys: string[]): GuardResult | null {
  if (openKeys.length === 0) return null;
  return reject("deps", "DEPS_OPEN", `Waiting for ${openKeys.join(", ")} to be Done.`, {
    openKeys,
  });
}
