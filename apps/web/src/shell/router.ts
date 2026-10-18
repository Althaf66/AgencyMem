// Hash routes (ui.md section 2) for the screens built so far.
import { useEffect, useState } from "react";
import { Doc } from "@agencymem/contracts";

export type Screen =
  "home" | "pipeline" | "preview" | "board" | "files" | "questions" | "memory" | "gates" | "health";
export type GraphViewName = "all" | "why" | "impact" | "read";
export const GRAPH_VIEWS: GraphViewName[] = ["all", "why", "impact", "read"];
export type Route =
  | { screen: "projects" }
  | { screen: Screen; projectId: string }
  | { screen: "docs"; projectId: string; doc: Doc }
  | { screen: "card"; projectId: string; key: string }
  | { screen: "code"; projectId: string; key: string | null }
  | { screen: "graph"; projectId: string; focus: string | null; view: GraphViewName };

/** The hash of a graph view (ui.md section 2: `#/p/:id/graph?focus=&view=`). */
export const graphHash = (projectId: string, view: GraphViewName, focus: string | null) =>
  `#/p/${projectId}/graph?${new URLSearchParams(focus ? { focus, view } : { view }).toString()}`;

const SCREENS: Screen[] = [
  "home",
  "pipeline",
  "preview",
  "board",
  "files",
  "questions",
  "memory",
  "gates",
  "health",
];

/** The hash of the Code screen on main or on one card. */
export const codeHash = (projectId: string, key: string) => `#/p/${projectId}/code/${key}`;

/** The hash of a card's story. */
export const cardHash = (projectId: string, key: string) => `#/p/${projectId}/card/${key}`;

export function parseHash(hash: string): Route {
  const match = /^#\/p\/([0-9A-Za-z]+)(?:\/([a-z]+)(?:\/([A-Za-z0-9-]+))?)?/.exec(hash);
  if (!match) return { screen: "projects" };
  const projectId = match[1]!;
  const screen = match[2] ?? "home"; // Home is a project's default screen
  if (screen === "docs") {
    const doc = Doc.safeParse(match[3]);
    return { screen, projectId, doc: doc.success ? doc.data : "prd" };
  }
  if (screen === "card" && match[3]) return { screen, projectId, key: match[3] };
  if (screen === "code") return { screen, projectId, key: match[3] ?? null };
  if (screen === "graph") {
    const query = new URLSearchParams(hash.split("?")[1] ?? "");
    const view = query.get("view") as GraphViewName;
    return {
      screen,
      projectId,
      focus: query.get("focus"),
      view: GRAPH_VIEWS.includes(view) ? view : "all",
    };
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
