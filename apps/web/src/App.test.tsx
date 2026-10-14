import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { App } from "./App";

it("renders the AgencyMem heading with React 18", () => {
  expect(renderToString(<App />)).toContain("<h1>AgencyMem</h1>");
});
