import { useEffect } from "react";
import { Board } from "./board/Board";
import { Docs } from "./docs/Docs";
import { Gates } from "./gates/Gates";
import { GraphPanel } from "./graph/GraphPanel";
import { Health } from "./health/Health";
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
      {route.screen === "board" && <Board store={store} />}
      {route.screen === "files" && <Files store={store} />}
      {route.screen === "questions" && <Questionnaire store={store} />}
      {route.screen === "gates" && <Gates store={store} />}
      {route.screen === "health" && <Health store={store} />}
      {route.screen === "docs" && <Docs store={store} doc={route.doc} />}
      {route.screen === "graph" && (
        <GraphPanel
          store={store}
          projectId={route.projectId}
          view={route.view}
          focus={route.focus}
        />
      )}
    </Shell>
  );
}
