import { reject, type GuardResult } from "./run";

/**
 * Rejects a version that is not the current one. The versioned write repeats this check inside its
 * one Cypher query; this guard gives the caller the current version to read again from.
 */
export function version(sent: number, current: number): GuardResult | null {
  if (sent === current) return null;
  return reject(
    "version",
    "VERSION_OLD",
    `Version ${sent} is old; the current version is ${current}.`,
    {
      current,
      sent,
    },
  );
}
