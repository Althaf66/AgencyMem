import { useEffect } from "react";
import { Docs } from "./docs/Docs";
import { Gates } from "./gates/Gates";
import { Files } from "./intake/Files";
import { Projects } from "./projects/Projects";
import { Questionnaire } from "./questionnaire/Questionnaire";
import { Shell } from "./shell/Shell";
import { useRoute } from "./shell/router";
import type { AppStore } from "./store";

export function App({ store }: { store: AppStore }) {
  const route = useRoute();
  const projectId = route.screen === "projects" ? null : route.projectId;

  useEffect(() => {
    if (projectId) void store.getState().open(projectId);
    else void store.getState().loadProjects();
  }, [store, projectId]);

  return (
    <Shell store={store} route={route}>
      {route.screen === "projects" && <Projects store={store} />}
      {route.screen === "files" && <Files store={store} />}
      {route.screen === "questions" && <Questionnaire store={store} />}
      {route.screen === "gates" && <Gates store={store} />}
      {route.screen === "docs" && <Docs store={store} doc={route.doc} />}
    </Shell>
  );
}
