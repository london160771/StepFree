# StepFree Graph Hacks — agent instructions

## Source of truth

- `SPEC.md` is authoritative for MVP scope, routing behavior, data, architecture, and delivery milestones.
- `DESIGN.md` is authoritative for the three-page information architecture and the visual and interaction details.
- If a proposed change conflicts with either document, keep the locked scope and ask the project owner before adding or changing product behavior.
- Keep both documents aligned when an approved change is made. Do not silently add features, pages, services, or data sources.

## Project layout

Keep the client and server as separate folders at the project root:

```text
stepfree/
├── frontend/    # React installable PWA, map, and user interface
├── backend/     # Express API, FalkorDB routing, and TfL integration
├── AGENTS.md
├── SPEC.md
├── DESIGN.md
├── README.md
└── .gitignore
```

Do not combine the frontend and backend into one application folder.

## Locked stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, Framer Motion, SVG, `vite-plugin-pwa`, and MapLibre GL JS with OpenFreeMap vector tiles (no API key) for the 3D London map, approved by the project owner. The SVG map remains the offline/no-WebGL fallback.
- Backend: Node.js, Express, TypeScript, FalkorDB, the official FalkorDB Node client, and TfL APIs/topology data.
- Agent (Track 01 — Agents That Act on Connected Data): Google Gemini (`gemini-3.8-flash`) through `@google/genai`, isolated behind the `AgentModel` interface; the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, `/client`, `/node`) with Streamable HTTP at `/mcp`; Zod for tool arguments. Nothing else: no LangChain, LlamaIndex, CrewAI, AutoGen or second agent framework.
- Tests: Vitest and Supertest.
- Deployment targets: Vercel for the frontend, Render for the backend, and FalkorDB Cloud when available; otherwise use a self-hosted or Docker-compatible FalkorDB deployment.
- Do not introduce Supabase, MongoDB, Next.js, another graph database, or an unnecessary supporting service.

## Implementation rules

- Implement only the MVP in `SPEC.md`. In particular, do not add accounts, profiles, saved trips, a notification system, full-London routing, or accessibility preference controls.
- FalkorDB is the routing engine for the supported station graph. Compute valid step-free routes and reroutes through the graph; do not replace it with a hard-coded route result.
- Use official TfL topology data to validate the supported network and identify the exact Green Park lift/pathway used by the outage scenario. Never invent or guess a `LiftUniqueId`.
- Keep Demo Mode deterministic and centered on the controlled Green Park outage. Live Mode uses real TfL lift disruption data, is London-only, and requires location permission. Demo Mode does not request location. In Live Mode, use browser location to place the animated user figure and map the user to the nearest supported station within the 17-station graph for routing. If location permission is denied, Live Mode must not start; Demo Mode remains available.
- Preserve the map-first, phone-first design and the three pages in `DESIGN.md`. Do not add a dashboard or sidebar. Keep the locked subtle train movement restrained and non-distracting.
- Show the safety note exactly as specified in `SPEC.md`. The installable PWA app shell may work offline, but Live Mode requires internet access for current TfL disruption data.
- Keep implementation choices lean. Add no user-facing capability merely because a library or service makes it convenient. Keep the product story centered on wheelchair users, elderly people, injured people, and parents with strollers, with emphasis on independence, confidence, and practical social impact.

## Agent rules

- Runtime path: Gemini chooses a tool, the backend agent host executes it through a real MCP client against the StepFree MCP server, FalkorDB/TfL answer, the host enforces the evidence guards, and a grounded decision plus action trace go to the UI. Do not fake MCP with direct function calls.
- The fixed tool catalogue is `resolve_station`, `plan_step_free_journey`, `inspect_route_dependencies`, `get_accessibility_disruptions`, `find_alternative_route`, `record_journey_decision`. Add no tool that accepts query text, code, files, shell or arbitrary HTTP. The model never writes Cypher; every query is fixed, human-written and parameterised, with arguments validated by Zod and then against the graph.
- FalkorDB stays the routing brain; the model does not compute routes and the browser does not decide to reroute. The frontend only reports state (for example `demoOutage`) and renders what the agent decided.
- Never expose `GEMINI_API_KEY` to the frontend or commit it. Never send raw GPS to the model; Live Mode passes only the nearest supported station.
- Do not silently bypass the agent when the model is down: say "Journey agent is temporarily unavailable." Deterministic fake models are for automated tests only.
- Keep `README.md` accurate about AI use: Claude Code (Anthropic) as the coding assistant, Gemini as the separate runtime model.

## Project storytelling

Use the same story for `README.md`, demo-video narration, hackathon submission copy, and launch/social posts. Do not lead with the database or technical architecture.

- Start with people who need step-free journeys: wheelchair users, elderly people, injured people, and parents with strollers.
- Explain why an inaccessible or suddenly broken route can reduce independence and confidence, and keep the social impact practical rather than exaggerated.
- Make FalkorDB central to the solution story: TfL tells StepFree what changed; FalkorDB represents the connected transit network, determines what that change affects, and computes the new valid step-free route.
- Use this core line where appropriate: **“The shortest route isn’t useful if you can’t use it. StepFree finds the route you actually can.”**
- Do not claim guaranteed accessibility; preserve the safety wording in `SPEC.md`.

## Delivery

Follow the deliverable milestones in `SPEC.md` in order. They describe outputs and acceptance evidence only; do not attach fixed hours, durations, or deadlines.
