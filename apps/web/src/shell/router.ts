// Hash routes (ui.md section 2) for the screens built so far.
import { useEffect, useState } from "react";
import { Doc } from "@agencymem/contracts";

export type Screen = "files" | "questions" | "gates";
export type Route =
  | { screen: "projects" }
  | { screen: Screen; projectId: string }
  | { screen: "docs"; projectId: string; doc: Doc };

const SCREENS: Screen[] = ["files", "questions", "gates"];

export function parseHash(hash: string): Route {
  const match = /^#\/p\/([0-9A-Za-z]+)\/([a-z]+)(?:\/([a-z]+))?/.exec(hash);
  const screen = match?.[2];
  if (!match || !screen) return { screen: "projects" };
  const projectId = match[1]!;
  if (screen === "docs") {
    const doc = Doc.safeParse(match[3]);
    return { screen, projectId, doc: doc.success ? doc.data : "prd" };
  }
  if (SCREENS.includes(screen as Screen)) return { screen: screen as Screen, projectId };
  return { screen: "projects" };
}

export function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parseHash(hash);
}
