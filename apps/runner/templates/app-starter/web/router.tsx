// A small hash router (sample-app.md section 1): #/doctors?specialty=skin gives the path
// "/doctors" and its query parameters.
import { useEffect, useState } from "react";

export type Route = { path: string; params: URLSearchParams };

export function parse(hash: string): Route {
  const [path, query] = hash.replace(/^#/, "").split("?");
  return { path: path || "/", params: new URLSearchParams(query ?? "") };
}

export function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parse(hash);
}
