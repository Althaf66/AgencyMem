# AgencyMem

AgencyMem helps the delivery lead of a small software agency turn client meeting notes into an
approved plan, a live Kanban board and tested code. Every result traces back to the client's
words, and each finished project makes the next estimate more accurate.

Nine agents share one memory: a FalkorDB graph that only one gateway may touch. Meeting notes
become sourced facts; facts become questions, a proposal, design documents and cards; OpenCode
builds each card through MCP; and the gateway closes a card only on the evidence of a real commit
and a passing Playwright test.

Four proof moments carry the demo:

1. **A contradiction question with its sources.** Discovery shows the two lines from two different
   client files that disagree.
2. **A change request flags only the linked cards.** One superseded fact moves exactly the cards
   and document sections built on it to Rework.
3. **A card is rejected without evidence.** No commit, or a failing test, and the card cannot close.
4. **A lesson reused in the next estimate.** Project 2's estimate links to a lesson from project 1.

## Tracks

- **Track 02 (Agent Memory and Coordination)**, primary: nine agents and up to two OpenCode workers
  claim, lease and hand off work on one shared graph, behind guards that reject stale, foreign or
  unproven writes.
- **Track 03 (Company Brain)**, secondary: every project leaves anonymous lessons in the agency
  graph, and the next proposal reads them.

## Demo video

_Link to be added after recording (it shows the four proof moments)._

## Architecture

One TypeScript monorepo (pnpm workspaces) with 4 apps and 5 packages. **One gateway process is the
only door to FalkorDB**, and only the memory package sends write Cypher. Agents, OpenCode, the web
client, the simulator and git hooks reach the graph only through the gateway.

| App              | Job                                                                                                                                                            | May import                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `apps/gateway`   | Express 5 + `ws` on one server: the MCP endpoint (`/mcp`), the REST API (`/api`), live events (`/ws`), the git hook receiver (`/hooks/commit`) and every guard | contracts, graph, memory, ingest |
| `apps/runner`    | The loops of the 7 model agents, the rule-based Launch agent, and 1 or 2 OpenCode build workers                                                                | contracts, llm                   |
| `apps/web`       | Vite + React: board, graph panel, questionnaire, documents, gates and the health panel. It draws only gateway events                                           | contracts                        |
| `apps/simulator` | Demo mode: synthetic notes, the client persona, gate decisions and actual hours                                                                                | contracts, llm                   |

| Package              | Holds                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/contracts` | zod schemas and types for every MCP tool, REST body, WebSocket event and config variable          |
| `packages/graph`     | The FalkorDB client, the router (project id to graph), the `.cypher` loader and app-side joins    |
| `packages/memory`    | Every write function, lease and version logic: the only code that sends write Cypher              |
| `packages/llm`       | The OpenAI SDK client, the OpenRouter fallback, thin and deep tiers, and the token and cost meter |
| `packages/ingest`    | PDF, DOCX, TXT and MD text extraction and the split into episodes                                 |

Rules CI enforces (`pnpm deps`, `pnpm check:cypher`): the runner imports only contracts and llm;
the web client and simulator talk to the gateway over HTTP and WebSocket; only `packages/memory`
sends write Cypher; and no TypeScript file holds a Cypher string, so the list below is every query
the product runs.

Every write goes through the guards, in this order: **tenancy, ownership, gate, source, version,
lease, evidence**. A rejection is counted on the project and sent as a `write.rejected` event.
Every write is one Cypher query, so a claim, a version check or a lease can never half-apply.

A project moves through intake, discovery, proposal, design, planning, build, e2e, launch,
case_study (the Curator writes the lessons) and closed, with three human gates (G1 questions
answered, G2 proposal, G3 design). After launch writes its readiness report, the lead closes the
project with the actual hours of each feature. Build workers run `opencode run` in a git worktree
per card; OpenCode reads its card through the gateway's MCP tools, commits, and a post-commit hook
records the commit in the graph; the Test agent runs the card's Playwright specs on that commit.

Every MCP tool, REST body, WebSocket event and setting is a zod schema in
[`packages/contracts/src/`](packages/contracts/src/).

## Graph model

FalkorDB holds three kinds of graph. Every node carries a source chain back to an Episode (the
client's words), and facts carry time, so a replaced fact ends but never disappears.

| Graph        | Name                | Holds                                                                             |
| ------------ | ------------------- | --------------------------------------------------------------------------------- |
| Registry     | `registry`          | Client and Project nodes, so the router maps a project id to its client graph     |
| Client graph | `client_<clientId>` | All project content for one client: sources, knowledge, product, design, delivery |
| Agency graph | `agency`            | Anonymous Lesson, CaseStudy and EstimateRecord nodes. No client names             |

Every node has `id` (ULID), `projectId`, `createdBy`, `createdAt` and `version`.

| Group     | Labels (client graph)                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| Sources   | Document, Episode                                                                                                     |
| Knowledge | Entity, Fact (`validFrom`, `validTo`), Contradiction, Question, Assumption                                            |
| Product   | Requirement, Feature (`featureKind`), Estimate (`rawHours`, `hours`, `lessonIds`), AcceptanceCriterion, ChangeRequest |
| Design    | Decision, Component, Screen, DataEntity, Endpoint, Risk, DocSection                                                   |
| Delivery  | Gate, WorkItem, Task (the card), TestCase, TestRun, CodeChange, Run, ReadinessReport                                  |

Edges point from the derived node to its source. The impact query follows them backward (what a
fact touches); the why query follows them forward (where a node came from).

| Edge            | From → To                                        |
| --------------- | ------------------------------------------------ |
| PART_OF         | Episode → Document                               |
| SOURCED_FROM    | Fact → Episode                                   |
| ABOUT           | Fact → Entity                                    |
| SUPERSEDES      | new Fact → old Fact (the old one gets `validTo`) |
| BETWEEN         | Contradiction → Fact                             |
| RAISED_ON       | Question → Fact or Contradiction                 |
| ASSUMES         | Question → Assumption                            |
| ANSWERS         | answer Episode → Question                        |
| RESOLVED_BY     | Assumption → answer Episode                      |
| DERIVED_FROM    | Requirement → Fact; design node → Requirement    |
| HAS_REQUIREMENT | Feature → Requirement                            |
| FOR             | Estimate → Feature                               |
| OF              | AcceptanceCriterion → Requirement                |
| RENDERS         | DocSection → product or design node              |
| IMPLEMENTS      | Task → Requirement                               |
| USES            | Task → design node                               |
| HAS_CRITERION   | Task → AcceptanceCriterion                       |
| DEPENDS_ON      | Task → Task                                      |
| VERIFIES        | TestCase → AcceptanceCriterion                   |
| RUNS            | TestRun → TestCase                               |
| FOR_TASK        | CodeChange → Task                                |
| FROM            | ChangeRequest → change-request Episode           |
| ENDS            | ChangeRequest → old Fact                         |
| FLAGGED_BY      | Task or DocSection → ChangeRequest               |
| RECALLED        | WorkItem or Task → a node its context read named |

Edges cannot cross graphs: an Estimate stores the ids of the agency Lessons it used, and
[`packages/graph/src/joins.ts`](packages/graph/src/joins.ts) joins the two in the app. Every
label's properties are in [`packages/contracts/src/nodes.ts`](packages/contracts/src/nodes.ts).

## Cypher queries

<!-- cypher:start -->

112 files under `packages/graph/cypher/`. Generated by `pnpm list:cypher`; do not edit by hand.

### The six queries that carry the product

- [`write/claim-task`](packages/graph/cypher/write/claim-task.cypher): Claims a build card (contracts.md claim_task, C1): a Ready card, or an In progress or Testing card whose lease ended, under 2 attempts, with every card it depends on Done.
- [`write/write-versioned`](packages/graph/cypher/write/write-versioned.cypher): Versioned write (technical design "Key Cypher queries").
- [`write/supersede-fact`](packages/graph/cypher/write/supersede-fact.cypher): record_change_request, write 1 (technical design "supersede-fact.cypher"): all or nothing.
- [`read/impact`](packages/graph/cypher/read/impact.cypher): What a fact touches (technical design "Key Cypher queries", impact.cypher): every node derived from it, following the source edges backward.
- [`read/why`](packages/graph/cypher/read/why.cypher): Route 17 (why): from one node along the source edges forward to the Episodes it comes from (technical design "Edges": they point from the derived node to its source).
- [`read/evidence`](packages/graph/cypher/read/evidence.cypher): What the evidence guard needs to close a card (complete_task, contracts.md section 7): the card's build commits (not the Test agent's spec commits, which get no test run), its TestCases with their criterion keys and every run of each, and the commits that still have an open or claimed test_run item.

### Schema

- [`schema/agency`](packages/graph/cypher/schema/agency.cypher): Agency graph: anonymous lessons, case studies and estimate records.
- [`schema/client`](packages/graph/cypher/schema/client.cypher): Client graph (client_<clientId>): a range index on id for every label.
- [`schema/registry`](packages/graph/cypher/schema/registry.cypher): Registry graph: Client and Project nodes only.

### Read queries

- [`read/answer-context`](packages/graph/cypher/read/answer-context.cypher): What an intake_answer item reads (agent-prompts.md section 2): the answer Episode, the Question it answers, and the facts that Question is raised on (through its Contradiction for a contradiction), each with its episodes and, once superseded, the fact that replaced it.
- [`read/board-items`](packages/graph/cypher/read/board-items.cypher): Route 12, the agent strip: the project's WorkItems that are open, claimed or blocked, and the done ones newest first (the gateway keeps five).
- [`read/board`](packages/graph/cypher/read/board.cypher): Route 12: the project's cards with what a card face and its drawer show (CardView): the requirement, dependencies, the CRs that flagged it, its commits, its criteria with their TestCases, and the TestRuns of those TestCases (the gateway works out the test status).
- [`read/case-metrics`](packages/graph/cypher/read/case-metrics.cypher): The inputs of a project's CaseMetrics (contracts.md section 5; recall_context for curator, and routes 24 and 25 in task 5.6): the counts, each current Feature's estimate and actual hours, and each card with its reopened count, its build commits (not the Test agent's spec commits) and the card-scope runs of its TestCases.
- [`read/case-study`](packages/graph/cypher/read/case-study.cypher): write_case_study is one per project: the project's CaseStudy, if any, with its EstimateRecords and the Lessons that name the project (agency graph).
- [`read/change-request`](packages/graph/cypher/read/change-request.cypher): One ChangeRequest with the episode it comes FROM (recall_context for a change_request item).
- [`read/clarity`](packages/graph/cypher/read/clarity.cypher): The clarity inputs of a project (contracts.md, Clarity band): whether a discovery item is done, the contradiction and unclear questions, and the words of the processed documents.
- [`read/code-change`](packages/graph/cypher/read/code-change.cypher): One CodeChange and the card it is linked to: the subject of a test_run item.
- [`read/commit`](packages/graph/cypher/read/commit.cypher): The project's CodeChange with this sha, if any: a diff is served only for the project's commits.
- [`read/conversation`](packages/graph/cypher/read/conversation.cypher): The Memory screen's turns (GET /api/projects/:id/memory): every uploaded file, question, answer and change request of the project, each with the Facts sourced from it and, for a CR, the Facts it ended.
- [`read/coverage`](packages/graph/cypher/read/coverage.cypher): Current requirements with no passing test (TD coverage.cypher): a requirement is covered when every criterion of every card that implements it has TestCases, and each passed in the latest e2e run (every run of one submit_test_run shares its ranAt).
- [`read/curator-done`](packages/graph/cypher/read/curator-done.cypher): The stage machine's repair of T29 (stage-machine.md): how many curator items are done.
- [`read/current-facts`](packages/graph/cypher/read/current-facts.cypher): The project's current Facts (no validTo) with the Episodes each is sourced from: the source guard of write_question and the facts of recall_context.
- [`read/design`](packages/graph/cypher/read/design.cypher): The project's design nodes with the requirement keys they derive from (recall_context for the architect and planner kinds).
- [`read/doc-sections`](packages/graph/cypher/read/doc-sections.cypher): The project's DocSections, of one document or ($doc null) of all three, each with the nodes it RENDERS: their label, id, key and text (a requirement's text, else the node's name).
- [`read/document-episodes`](packages/graph/cypher/read/document-episodes.cypher): The Episodes of one Document in reading order, with the Document's name (recall_context, intake).
- [`read/documents`](packages/graph/cypher/read/documents.cypher): The project's Documents in upload order (route 5).
- [`read/ended-facts`](packages/graph/cypher/read/ended-facts.cypher): The Facts a ChangeRequest ended (it ENDS them), each with its Episodes and the Fact that replaced it: recall_context for a replan item (agent-prompts.md section 6, "facts with the replaced ones").
- [`read/entities`](packages/graph/cypher/read/entities.cypher): The project's Entities, for matching names and aliases (write_fact) and for recall_context.
- [`read/episode-ids`](packages/graph/cypher/read/episode-ids.cypher): Which of $ids are Episodes of the project (the source guard of write_fact).
- [`read/evidence`](packages/graph/cypher/read/evidence.cypher): What the evidence guard needs to close a card (complete_task, contracts.md section 7): the card's build commits (not the Test agent's spec commits, which get no test run), its TestCases with their criterion keys and every run of each, and the commits that still have an open or claimed test_run item.
- [`read/fact-history`](packages/graph/cypher/read/fact-history.cypher): Every Fact of the project, current and ended, for the Memory screen's "what we knew then" (GET /api/projects/:id/memory).
- [`read/features`](packages/graph/cypher/read/features.cypher): The project's current Features, each with its requirement keys and its Estimate (recall_context for proposal, route 26).
- [`read/flagged-rework`](packages/graph/cypher/read/flagged-rework.cypher): The cards a ChangeRequest flagged that are in Rework: the cards a replan item updates.
- [`read/gates`](packages/graph/cypher/read/gates.cypher): The project's Gates for route 10, with what their rules read (stage-machine.md section 5): G1 is decidable when a discovery item is done and no Question is open; G2 when a proposal item is done and none is open or claimed; G3 when an architect item is done and no architect or architect_revise item is open or claimed.
- [`read/graph-focus`](packages/graph/cypher/read/graph-focus.cypher): Route 16 with a focus: the nodes up to $depth hops from it, either direction.
- [`read/graph-links`](packages/graph/cypher/read/graph-links.cypher): Route 16: every edge between the nodes it returns.
- [`read/graph-nodes`](packages/graph/cypher/read/graph-nodes.cypher): Route 16 without a focus: the project's nodes in creation (ULID) order, up to $limit.
- [`read/handoffs`](packages/graph/cypher/read/handoffs.cypher): The handoffs of a project's done work items, newest first (recall_context `handoffs`).
- [`read/impact-path`](packages/graph/cypher/read/impact-path.cypher): Route 18 (impact): impact.cypher with its paths, so the panel can draw the links from a fact to every node derived from it.
- [`read/impact`](packages/graph/cypher/read/impact.cypher): What a fact touches (technical design "Key Cypher queries", impact.cypher): every node derived from it, following the source edges backward.
- [`read/indexes`](packages/graph/cypher/read/indexes.cypher): The indexes of one graph: one row per label with its indexed properties.
- [`read/item-runs`](packages/graph/cypher/read/item-runs.cypher): The Run records of one work item or card, oldest first.
- [`read/migrate-readiness`](packages/graph/cypher/read/migrate-readiness.cypher): One-time migration (`pnpm migrate:scope-cut`, client graph): the ReadinessReports that still carry the removed open_defects check.
- [`read/node-links`](packages/graph/cypher/read/node-links.cypher): Route 6: one node with its label, and every edge to or from it with the other node's label and the properties its title is made from (api/nodes.ts).
- [`read/node`](packages/graph/cypher/read/node.cypher): Any node by id, with its label: the facts the tenancy and lease guards need.
- [`read/product-versions`](packages/graph/cypher/read/product-versions.cypher): The current product and design versions of a project (contracts.md section 4): the highest productVersion among current Features and the highest designVersion among DocSections and design nodes, or 0. Design nodes count too, because a revision may write nodes only (task 3.4).
- [`read/progress-assumptions`](packages/graph/cypher/read/progress-assumptions.cypher): Route 15, metric openAssumptions.
- [`read/progress-coverage`](packages/graph/cypher/read/progress-coverage.cypher): Route 15, metric coverage: the current requirements with a passing TestRun (the numerator).
- [`read/progress-lane`](packages/graph/cypher/read/progress-lane.cypher): Route 15, metric lane:<Lane>: the cards of one lane.
- [`read/progress`](packages/graph/cypher/read/progress.cypher): Route 14, the progress header: done and total cards per lane, current requirements with a passing TestRun (coverage) and open Assumptions.
- [`read/project-graph`](packages/graph/cypher/read/project-graph.cypher): The client graph of a project.
- [`read/project-info`](packages/graph/cypher/read/project-info.cypher): A Project and its client's name, from the registry graph (ProjectInfo).
- [`read/project`](packages/graph/cypher/read/project.cypher): One Project node from the registry graph.
- [`read/projects`](packages/graph/cypher/read/projects.cypher): Every Project in the registry graph, with its client.
- [`read/questions`](packages/graph/cypher/read/questions.cypher): The project's Questions for route 8 (QuestionView): each with its Assumption, its Contradiction, its answer Episode (task 2.7), and the Episode behind each of its facts (through the Contradiction for a contradiction).
- [`read/readiness-report`](packages/graph/cypher/read/readiness-report.cypher): Route 27: the project's newest ReadinessReport (C8), or no row.
- [`read/readiness`](packages/graph/cypher/read/readiness.cypher): Two of the Launch agent's checks (agent-prompts.md section 10): the cards not Done and the open Assumptions, with their ids, and the totals their details name.
- [`read/recalled`](packages/graph/cypher/read/recalled.cypher): The Read view: one WorkItem or Task and every node it read (its RECALLED edges), as one path.
- [`read/requirements`](packages/graph/cypher/read/requirements.cypher): The project's current Requirements with the facts they derive from (recall_context, proposal).
- [`read/run-costs`](packages/graph/cypher/read/run-costs.cypher): Route 24 and the cost check (task 6.5): one project's model calls (Run nodes) by agent and model, with their tokens and the cost each Run recorded.
- [`read/similar-lessons`](packages/graph/cypher/read/similar-lessons.cypher): Lessons for the Proposal agent (agent-prompts.md section 4) and route 26, from the agency graph: every Lesson of the given featureKinds in any clarityBand, so the runner can fall back from (featureKind, clarityBand) to featureKind alone (C3).
- [`read/stage-state`](packages/graph/cypher/read/stage-state.cypher): What the stage machine reads from a client graph (stage-machine.md section 1): the project's Gates, the open or claimed intake and intake_answer items (T3, T6, T7), the processed Documents (T3), and the processed Documents and answer Episodes that never got their item (startup repair of T2 and T5).
- [`read/task-claim`](packages/graph/cypher/read/task-claim.cypher): Why a named card could not be claimed: its column, attempts and lease, and the keys of the cards it depends on that are not Done.
- [`read/task-context`](packages/graph/cypher/read/task-context.cypher): Everything a build run needs for one card (get_task_context, contracts.md section 7): the card, its requirement and current facts, criteria, design nodes, TestCases, CodeChanges, the source episodes with their document names.
- [`read/task-test-runs`](packages/graph/cypher/read/task-test-runs.cypher): A card's test runs, newest first: TestRun -RUNS-> TestCase -VERIFIES-> criterion of the Task.
- [`read/task`](packages/graph/cypher/read/task.cypher): One Task (or, with $taskId null, every Task: the e2e run) with what recall_context's `tasks` group holds: its requirement, the design nodes it uses, the cards it depends on, its criteria and the TestCases that verify them.
- [`read/tasks`](packages/graph/cypher/read/tasks.cypher): The project's Tasks with their column, version and the cards they depend on: write_cards refuses a key that exists (create), a card that is not in Rework or an old version (update), and a cycle.
- [`read/why`](packages/graph/cypher/read/why.cypher): Route 17 (why): from one node along the source edges forward to the Episodes it comes from (technical design "Edges": they point from the derived node to its source).

### Write queries (sent only by packages/memory)

- [`write/answer-question`](packages/graph/cypher/write/answer-question.cypher): Answers one open Question in one query (stage-machine.md T5): the answer Episode ANSWERS the Question, the Question is answered, its Assumption confirmed (accepted) or rejected (own answer) and RESOLVED_BY the Episode, and its Contradiction, if any, resolved.
- [`write/cancel-items`](packages/graph/cypher/write/cancel-items.cypher): Cancels the project's open and claimed WorkItems of the given kinds (stage-machine.md T30: a card left Done during e2e or launch).
- [`write/case-study`](packages/graph/cypher/write/case-study.cypher): write_case_study (contracts.md section 7), agency graph, one query: 1. Each Lesson MERGEs on (featureKind, clarityBand): its text becomes this project's, version + 1, and the projectId joins projectIds.
- [`write/claim-item`](packages/graph/cypher/write/claim-item.cypher): Claims the oldest open WorkItem of the given kinds (or the given item) whose lease is empty or ended.
- [`write/claim-task`](packages/graph/cypher/write/claim-task.cypher): Claims a build card (contracts.md claim_task, C1): a Ready card, or an In progress or Testing card whose lease ended, under 2 attempts, with every card it depends on Done.
- [`write/close-project`](packages/graph/cypher/write/close-project.cypher): Route 29 (T28): closedAt on the registry Project, once, while it is in launch.
- [`write/complete-item`](packages/graph/cypher/write/complete-item.cypher): Completes a WorkItem whose live lease the caller holds.
- [`write/complete-merge`](packages/graph/cypher/write/complete-merge.cypher): Completes a merge WorkItem whose live lease the caller holds, with its result (contracts.md section 7, complete_item).
- [`write/complete-task`](packages/graph/cypher/write/complete-task.cypher): Ends a build run on a card (complete_task, contracts.md section 7).
- [`write/count-rejection`](packages/graph/cypher/write/count-rejection.cypher): Adds 1 to one rejection counter of a Project (contracts.md section 6, "Counting").
- [`write/create-change-request`](packages/graph/cypher/write/create-change-request.cypher): Route 22 (stage-machine.md C1): the change_request Episode with the client's words, and the ChangeRequest (status open) FROM it.
- [`write/create-gates`](packages/graph/cypher/write/create-gates.cypher): Creates the project's Gates that do not exist yet, each waiting (stage-machine.md T1 and the startup repair).
- [`write/create-project`](packages/graph/cypher/write/create-project.cypher): Creates a Project in the registry graph.
- [`write/delete-project-agency`](packages/graph/cypher/write/delete-project-agency.cypher): A project delete (route DELETE /api/projects/:id) and test cleanup (agency graph): removes the given projects' CaseStudies and EstimateRecords, and the Lessons that name only those projects.
- [`write/delete-project-nodes`](packages/graph/cypher/write/delete-project-nodes.cypher): A project delete (route DELETE /api/projects/:id, client graph): every node of the project with its edges.
- [`write/delete-project`](packages/graph/cypher/write/delete-project.cypher): A project delete (route DELETE /api/projects/:id, registry graph), last of the three writes: the Project node.
- [`write/delete-test-client`](packages/graph/cypher/write/delete-test-client.cypher): Test cleanup only: removes a test client from the registry with its Projects.
- [`write/expire-item-leases`](packages/graph/cypher/write/expire-item-leases.cypher): Frees the claimed WorkItems of a project whose lease ended: back to open with one more attempt, or blocked at 3 (stage-machine.md failure rules).
- [`write/expire-task-leases`](packages/graph/cypher/write/expire-task-leases.cypher): Frees the cards of a project whose build lease ended (contracts.md section 10): an In progress or Testing card goes back to Ready with one more attempt, so the board shows the recovery after a runner stops.
- [`write/feature-actuals`](packages/graph/cypher/write/feature-actuals.cypher): Route 29 (T28): the actual hours of each current Feature, version + 1, in one query.
- [`write/flag-impact`](packages/graph/cypher/write/flag-impact.cypher): record_change_request, write 2 (technical design "impact.flag"): every node the old facts touch, by the edges of read/impact.cypher.
- [`write/migrate-fix-items`](packages/graph/cypher/write/migrate-fix-items.cypher): One-time migration (`pnpm migrate:scope-cut`, client graph), step 1: the criteria of every fix card and the work items about one, before the cards themselves go in step 2.
- [`write/migrate-scope-cut`](packages/graph/cypher/write/migrate-scope-cut.cypher): One-time migration (`pnpm migrate:scope-cut`, client graph), step 2: every node of the removed maintenance phase (Defects, Deployments, G5 and G6, maintenance items, bug reports, fix cards).
- [`write/migrate-stage`](packages/graph/cypher/write/migrate-stage.cypher): One-time migration (`pnpm migrate:scope-cut`, registry graph): G5 and maintenance were removed, so a project left in maintenance goes back to launch, where the close now runs (T28).
- [`write/open-item`](packages/graph/cypher/write/open-item.cypher): Opens one WorkItem, unless an open or claimed item of the same kind and subject already exists (stage-machine.md section 1, rule 2).
- [`write/override-readiness`](packages/graph/cypher/write/override-readiness.cypher): Route 29 (T28): a close over a failed readiness report keeps that it was overridden, and why, on the newest ReadinessReport.
- [`write/patch-task`](packages/graph/cypher/write/patch-task.cypher): Route 13, a person's edit of a card (stage-machine.md section 6, H1 to H6) in one query.
- [`write/record-commit`](packages/graph/cypher/write/record-commit.cypher): Records one commit from the post-commit hook (contracts.md section 9).
- [`write/record-recall`](packages/graph/cypher/write/record-recall.cypher): recall_context and get_task_context: the item gets one RECALLED edge to each node its answer named, by id or by key; a second recall moves the edge's `at`.
- [`write/renew-lease`](packages/graph/cypher/write/renew-lease.cypher): Renews a lease that the caller holds and that has not ended, on a WorkItem or a Task (a card).
- [`write/reopen-gate`](packages/graph/cypher/write/reopen-gate.cypher): Sets a rejected Gate back to waiting (stage-machine.md T8: the revision after a G2 rejection is done).
- [`write/retry-item`](packages/graph/cypher/write/retry-item.cypher): Route 31: a blocked WorkItem back to open with attempts 0 (stage-machine.md section 3).
- [`write/set-stage`](packages/graph/cypher/write/set-stage.cypher): Moves a Project to another stage, only from the stage the caller saw (stage-machine.md section 1, rule 2), so a repeated or late effect changes nothing.
- [`write/submit-test-run`](packages/graph/cypher/write/submit-test-run.cypher): One TestRun per result (submit_test_run, contracts.md section 7), each RUNS its TestCase and carries the commit's sha.
- [`write/supersede-fact`](packages/graph/cypher/write/supersede-fact.cypher): record_change_request, write 1 (technical design "supersede-fact.cypher"): all or nothing.
- [`write/task-note`](packages/graph/cypher/write/task-note.cypher): Writes why a card could not close onto the card itself (an evidence rejection, so the board shows the reason on the card).
- [`write/test-seed-design`](packages/graph/cypher/write/test-seed-design.cypher): Test seed only (task 3.3, until write_design exists in 3.4): Endpoints DERIVED_FROM a Requirement and DocSections that RENDER a Requirement.
- [`write/test-seed-tasks`](packages/graph/cypher/write/test-seed-tasks.cypher): Test seed only (task 3.3, until write_cards exists in 3.6): build Tasks that IMPLEMENT a Requirement and USE an Endpoint (when `uses` names one).
- [`write/write-cards-update`](packages/graph/cypher/write/write-cards-update.cypher): Writes one write_cards call in update mode (replan) in one query (contracts.md section 7, write_cards): 1. Every card exists, is in Rework and has the version the caller sent, and every requirement is current; else no row and nothing is written.
- [`write/write-cards`](packages/graph/cypher/write/write-cards.cypher): Writes one write_cards call in create mode in one query (contracts.md section 7, write_cards): 1. No Task of the project has one of $keys yet, and every card's requirement is current; else no row and nothing is written.
- [`write/write-design`](packages/graph/cypher/write/write-design.cypher): Writes one write_design call in one query (contracts.md section 7, write_design): 1. Version check: the current design version (the highest designVersion among DocSections and design nodes, or 0) must equal $baseVersion.
- [`write/write-episodes`](packages/graph/cypher/write/write-episodes.cypher): Writes one uploaded file in one query: its Document and, for a new file, all its Episodes with a PART_OF edge each.
- [`write/write-facts`](packages/graph/cypher/write/write-facts.cypher): Writes one write_fact call in one query: the Entities (MERGE on key; the gateway has already matched names and aliases and sends the full alias list), each Fact with ABOUT its Entity and SOURCED_FROM its Episodes, and for a replaced fact: validTo on the old one and SUPERSEDES to it.
- [`write/write-handoff`](packages/graph/cypher/write/write-handoff.cypher): Leaves a handoff on a WorkItem: the summary and the ids of what it wrote.
- [`write/write-human-edit`](packages/graph/cypher/write/write-human-edit.cypher): Route 21 before G3 (stage-machine.md T12): the human_edit Episode with the person's words.
- [`write/write-product`](packages/graph/cypher/write/write-product.cypher): Writes one write_product call in one query (contracts.md section 7, write_product): 1. Version check: the current product version (the highest productVersion among current Features, or 0) must equal $baseVersion.
- [`write/write-questions`](packages/graph/cypher/write/write-questions.cypher): Writes one write_question call in one query: each Question (open) with its Assumption (ASSUMES); for a contradiction a Contradiction BETWEEN its facts with the Question RAISED_ON it; for the other kinds the Question RAISED_ON its facts.
- [`write/write-run`](packages/graph/cypher/write/write-run.cypher): One Run node for a build run's final step (route 30 with final: true).
- [`write/write-tests`](packages/graph/cypher/write/write-tests.cypher): Writes one write_tests call in one query (contracts.md section 7, write_tests): 1. Every case's criterion is a criterion of the Task; else no row and nothing is written.
- [`write/write-versioned`](packages/graph/cypher/write/write-versioned.cypher): Versioned write (technical design "Key Cypher queries").

<!-- cypher:end -->

## Setup

You need Node.js 22.13 or later, pnpm 11.28.0, Docker, and git.

```sh
git clone https://github.com/Althaf66/AgencyMem.git
cd AgencyMem
pnpm i
npm install -g opencode-ai@1.18.32     # the build workers run OpenCode; the runner checks this version
npx playwright install chromium        # the Test agent runs Playwright specs
cp .env.example .env                   # then fill it in (below)
docker compose up -d                   # FalkorDB on host port 6380
pnpm seed                              # the registry and agency graphs; safe to run twice
pnpm dev                               # gateway (http://127.0.0.1:4000), runner and web client
```

`.env` holds every setting; each app checks the variables it needs at start-up and stops with a
clear message when one is missing. Keys come from environment variables only and never go into a
file in this repository.

| Variable                                                                                        | What it is |
| ----------------------------------------------------------------------------------------------- | ---------- |
| Required (no default; the gateway, runner, simulator and web dev server refuse to start without |
| the ones they use):                                                                             |

| Variable                                                               | What it is                                                                              |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `AM_AGENT_TOKEN`, `AM_UI_TOKEN`, `AM_HOOK_TOKEN`                       | Any long random strings: the runner's, the web client's and the git hook's tokens       |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_THIN`, `LLM_MODEL_DEEP`      | The OpenAI-compatible endpoint the agents call, and its thin and deep models            |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_THIN`, `OPENROUTER_MODEL_DEEP` | The fallback when the primary endpoint fails (required by the runner and the simulator) |
| `TOKENHARBOR_API_KEY`, `BUILD_MODEL`                                   | The TokenHarbor key and the model OpenCode builds cards with                            |
| `ZEN_API_KEY`, `ZEN_BUILD_MODEL`                                       | The OpenCode Zen key and model Build falls back to                                      |

With defaults (set them only to change them):

| Variable                   | Default                   | What it is                                                                                                     |
| -------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `FALKORDB_URL`             | `redis://localhost:6380`  | FalkorDB, at the compose port                                                                                  |
| `WORKSPACES_DIR`           | `../agencymem-workspaces` | Where the client project repositories live, **outside this repository**; the runner refuses a folder inside it |
| `SIM_SEED`, `SIM_PROJECTS` | 100, 3                    | The simulator's seed and number of projects (at most 3)                                                        |
| `OPENCODE_VERSION`         | 1.18.32                   | The OpenCode version the runner checks at start-up                                                             |

Others with defaults: `AM_PORT` (4000), `GATEWAY_URL`, `BUILD_WORKERS` (1 or 2), `LEASE_MS`,
`HEARTBEAT_MS`, `LLM_TIMEOUT_MS`, `CONTEXT_MAX_CHARS`, `UPLOADS_DIR`. The full list is
[`packages/contracts/src/config.ts`](packages/contracts/src/config.ts).

Open http://localhost:5173, create a project and upload meeting notes (PDF, DOCX, TXT or MD), or
run the simulator below.

## Running the demo

```sh
pnpm sim:run                    # simulated projects A, B and C, each to closed, with no person involved
pnpm sim:run --set A --live-demo  # one new project for the live demo; stops before launch
pnpm pre-run                    # the pre-run: sim:run on an empty graph, the curve check, then a backup
pnpm backup --name rehearsal    # FalkorDB data, workspaces, uploads and sim-state to ../agencymem-backups/
pnpm restore rehearsal          # put a backup back (stop the runner and simulator first)
pnpm migrate:scope-cut          # once, for data from before G5 and maintenance were removed
pnpm cost:report --project <id> # tokens and cost of one project, by agent and model
```

## The seed and the curve

The simulator draws each project's hidden traits (clarity, scope creep, complexity) from
`SIM_SEED=100` with mulberry32, and a project's actual hours from its raw estimate. The demo uses
this one fixed seed so every rehearsal gives the same curve:

| Project | Clarity band | Change requests | Estimate error | Lesson match     |
| ------- | ------------ | --------------- | -------------- | ---------------- |
| A       | low          | 1               | 45%            | none             |
| B       | low          | 2               | 12%            | exact (low)      |
| C       | medium       | 2               | 3%             | featureKind only |

One seed is not proof that lessons help in general. Over seeds 1 to 1,000, project 3's error is
lower than project 1's in **94%** of seeds, and the curve falls at every step in **48%**. The
formula is in [`apps/simulator/src/actual-hours.ts`](apps/simulator/src/actual-hours.ts).

## Tests

| Command                                                         | Proves                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                     | Unit, contract and integration tests against a real FalkorDB, including the guards, the evidence guard (no commit, a failing run, a passing run) and this README's checks |
| `pnpm test:load`                                                | 20 MCP clients claim and edit cards while a person edits them: 0 lost writes                                                                                              |
| `pnpm test:restart`                                             | A runner killed mid-card loses its lease; the card goes back to Ready and the project finishes                                                                            |
| `pnpm test:isolation`                                           | Nodes in two client graphs: 0 foreign nodes from either project; an unknown project id fails                                                                              |
| `pnpm eval:discovery --set A`                                   | Discovery's recall and precision on the planted contradictions, with a real model                                                                                         |
| `pnpm lint`, `pnpm typecheck`, `pnpm deps`, `pnpm check:cypher` | Style, types, the import rules, no Cypher in TypeScript                                                                                                                   |

## Why FalkorDB is central

FalkorDB is the only store of project state. The board, documents, guards and traces are all
views of graph nodes: remove the graph and the board has no cards, the documents have no sections,
the guards have nothing to check a claim, version or source against, and no change request,
why path or lesson can be traced.

## Synthetic data

All demo data is synthetic. The three clinics, their meeting notes, the client persona and every
answer are made up for this project (`apps/simulator/fixtures/`); no real client or person appears.

## AI tool disclosure

- **Claude Code** (Anthropic) built AgencyMem: the code, tests and specs were written with it,
  task by task, from a written PRD, technical design and implementation plan.
- **OpenCode** runs inside AgencyMem as the build worker: it writes the client project's code for
  each card, through AgencyMem's MCP tools.
- AgencyMem's own agents call language models through an OpenAI-compatible endpoint, with
  OpenRouter as the fallback.
