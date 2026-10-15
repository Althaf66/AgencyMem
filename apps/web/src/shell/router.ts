// Hash routes (ui.md section 2) for the screens built so far.
import { useEffect, useState } from "react";

export type Screen = "files" | "questions" | "gates";
export type Route = { screen: "projects" } | { screen: Screen; projectId: string };

const SCREENS: Screen[] = ["files", "questions", "gates"];

export function parseHash(hash: string): Route {
  const match = /^#\/p\/([0-9A-Za-z]+)\/([a-z]+)/.exec(hash);
  const screen = match?.[2] as Screen | undefined;
  if (match && screen && SCREENS.includes(screen)) return { screen, projectId: match[1]! };
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
