import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createApi } from "./api";
import { App } from "./App";
import { connectLive, pageSocketUrl } from "./live";
import { getActor } from "./shell/actor";
import { createAppStore } from "./store";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// The Vite dev proxy adds the UI token to /api and /ws, so the page never holds it.
const store = createAppStore(createApi({ base: "", actor: () => `human:${getActor()}` }));
connectLive(store, pageSocketUrl());

createRoot(root).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
