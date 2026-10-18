# StepFree Graph Hacks — MVP specification

## Hackathon track and agent

StepFree enters **Track 01 — Agents That Act on Connected Data**. It is a journey agent that chooses among a fixed catalogue of MCP tools: in Live Mode Gemini (`gemini-3.8-flash`) chooses; in Demo Mode a deterministic StepFree tool policy chooses (so the repeatable judge experience needs no AI quota, and it is never presented as Gemini); the MCP server runs human-written, parameterised Cypher against FalkorDB and reads TfL lift disruptions; the agent host enforces what the evidence allows and returns a grounded decision with a visible action trace. FalkorDB remains the routing brain. The model never writes Cypher, never computes a route and never sees raw location.

## Product

StepFree demonstrates how an accessible transit route can change when a lift or step-free connection becomes unavailable. It uses a small, real TfL London network subset and FalkorDB to calculate the valid route and the reroute.

The MVP has two modes:

- **Demo Mode** is the primary, universal judge experience. It needs no location and works from anywhere. **Run Demo** runs the healthy Victoria to London Bridge journey; **Simulate disruption** then activates one of three controlled, simulated events (Green Park Lift 2 outage, Green Park station closure, Jubilee line disruption); **Reset demo** restores a clean journey.
- **Live Mode** uses the user's location and real TfL lift disruption data. It is available in London only and requires location permission.

This is a 17-station proof of concept, not a London-wide journey planner.

## Locked MVP scope

### Required capabilities

1. **17-station graph:** support Victoria, Green Park, St James's Park, Westminster, Waterloo, Southwark, London Bridge, Bond Street, Tottenham Court Road, King's Cross St Pancras, Paddington, Liverpool Street, Farringdon, Moorgate, Canary Wharf, Tower Hill and Canada Water (London Underground only). Platforms or directions without step-free access are not boardable; RIDE edges between supported stations aggregate unsupported intermediate stops, which are not selectable. Model line-specific station/platform nodes where needed to represent travel and interchange correctly. St James's Park is a District line pass-through on the fallback journey; the passenger remains on the train and does not transfer or alight there.
2. **Step-free routing:** FalkorDB computes the valid step-free route using the graph's travel-time weights. The same graph engine computes the reroute after a connection is unavailable.
3. **Demo Mode:** show the baseline Victoria-to-London Bridge route via Green Park, trigger the controlled Green Park lift/pathway outage with the **Simulate disruption** control (lift outage option), then show the alternate route via the District line to Westminster and the Jubilee line onward to London Bridge. The District line journey passes St James's Park without requiring it to be step-free.
4. **Live Mode:** request browser location permission only after the user chooses Live Mode. If permission is granted, use the browser location to place the animated user figure and map the user to the nearest supported station within the 17-station graph for routing. If permission is denied, Live Mode must not start and Demo Mode remains available. Use real TfL lift disruption data and keep route calculation within the 17-station graph. Outside London, show: **Live Mode is currently available in London only.** Live Mode requires internet access for current TfL disruption data.
5. **Animated map:** present the supported network on a clean, animated 3D map of central London (MapLibre GL JS with OpenFreeMap/OpenStreetMap vector tiles and extruded buildings), with stations at their real coordinates and a schematic SVG map as the offline fallback. Include a simple animated wheelchair-user figure, route line, station markers, lift icons, and subtle non-distracting train movement.
6. **Installable PWA:** make the frontend installable on mobile and provide a simple install guide with iPhone and Android steps. The installed app shell may work offline, but Live Mode requires internet access for current TfL disruption data.
7. **Safety note:** display the exact note **based on currently available TfL accessibility data.**
8. **FalkorDB proof:** make the graph and pathfinding legible in the demo through the supported station/connection map and the visible route change when the Green Park connection is disabled. The proof is part of the map experience; it does not require a separate dashboard.
9. **About StepFree:** provide a short project story centered on wheelchair users, elderly people, injured people, and parents with strollers. Emphasize independence, confidence, and practical social impact, and credit FalkorDB and TfL.

10. **Journey agent (Track 01):** both modes plan and re-check journeys through `POST /api/agent/journey`: the agent selects MCP tools (`resolve_station`, `plan_step_free_journey`, `inspect_route_dependencies`, `get_journey_disruptions`, `find_alternative_route`, `record_journey_decision`) and decides `ROUTE_SELECTED`, `ROUTE_RETAINED`, `REROUTED` or `NO_ROUTE`. At most 8 tool calls per request; the common flows take 4 (plan, disruptions, Plan B, record), because the planner resolves both stations and returns the route's accessibility dependencies itself. The one write tool records a `JourneySession` / `AgentDecision` in FalkorDB. The frontend reports state (for example that the demo outage was triggered) and never decides to reroute. If the model is unavailable the app says so; it does not silently bypass the agent. The UI shows a collapsed **How StepFree decided** disclosure built from the structured tool trace. Unsupported stations return “That station isn't in StepFree's current supported network.”

11. **Plan B, Route Health and Why this route?:** the response also carries `routeHealth` (`CLEAR`, `AFFECTED`, `REROUTED`, `NO_ROUTE`; computed from tool evidence only, no scores), `planB` (a graph-computed backup that is genuinely different from the primary route, from the `find_backup_route` MCP tool, or `available: false`) and `whyThisRoute` (plain-language reasons assembled deterministically from tool results, with no extra model call). Plan B is a preview, never auto-selected, and is distinct from a reroute (the route the agent selects after a disruption). After a reroute Plan B is recalculated for the new route. The MCP catalogue is seven tools: `resolve_station`, `plan_step_free_journey`, `inspect_route_dependencies`, `get_journey_disruptions`, `find_alternative_route`, `find_backup_route`, `record_journey_decision`.

12. **Universal Demo:** Demo Mode never requests location and has no geographic guard. The three simulated disruptions are one generic model (a connection id that is unavailable: a LiftUniqueId, `STATION:<id>` or `LINE:<line>`), at most one active at a time, all labelled as simulated Demo Mode events and never presented as real TfL data. Semantics: a **lift** removes the step-free transfers that depend on it; a **closed station** removes every step-free transfer at it (street access, boarding, alighting, interchange) while trains run through it; a **disrupted line** removes the rides only that line provides. FalkorDB computes every replacement route; the frontend only reports which event was activated; the agent decides, from the route's dependencies, whether the journey is affected and keeps the route if it is not. The MCP catalogue stays seven tools: `get_accessibility_disruptions` became `get_journey_disruptions`, covering all three types. Live Mode is unchanged (London-only, real TfL lift disruptions) and is a bonus.

### Explicitly out of scope

- User accounts, profiles, and saved trips.
- A notification system.
- Full-London routing or a graph beyond the 17-station subset.
- Additional accessibility preferences or user-specific route settings.
- Dashboards, sidebars, or pages beyond Map / Home, PWA Install Guide, and About StepFree.
- A chat interface, a general-purpose assistant, or any agent tool that accepts query text, code, files or arbitrary HTTP.
- Live station or line disruption feeds, entrance or platform disruption, multiple simultaneous disruptions, planned works, and the follow-on agent features not named here (the station and line events exist only as Demo Mode simulations).
- Any extra feature, data provider, or service not named in this specification.

## Route and graph behavior

The supported graph represents station/line access and connections, not just a list of station names. Use line-specific nodes where an interchange needs to connect different lines. Represent rideable transit links and usable step-free transfers distinctly (for example, `RIDE` and `STEP_FREE_TRANSFER`). Weight route edges with travel time so FalkorDB can select the shortest valid step-free path, using the weighted shortest-path capability discussed for FalkorDB (`algo.SPpaths`) with the relevant relationship types and travel-time weights.

The normal demonstration journey is:

```text
Victoria → Green Park → Westminster → Waterloo → Southwark → London Bridge
```

The outage journey is:

```text
Victoria → District line (passing St James's Park) → Westminster
         → Jubilee line → Waterloo → Southwark → London Bridge
```

The outage makes the specific Green Park step-free pathway/transfer unavailable. It must not mark Green Park or all its connections unavailable. Resolve the exact TfL lift/pathway identifier from official detailed topology data before encoding the controlled outage. The exact `LiftUniqueId` was not established in the planning conversation, so it is a Phase 0 validation item, not a value to guess.

The map, route summary, and outage animation must reflect the path returned by FalkorDB. Do not hard-code the alternate route as the routing result. Keep the sample route text and travel-time display tied to the graph result; an example such as “Victoria → London Bridge, 18 min” is illustrative, not a fixed journey time.

Live Mode combines the supported graph with current TfL lift disruption data. Browser location is used only after permission is granted to place the animated user figure and map the user to the nearest supported station within the 17-station graph for routing. If permission is denied, Live Mode does not start and Demo Mode remains available. Live Mode requires internet access for current TfL disruption data. It must not imply that routes outside the supported graph are covered. The 17-station graph is the route coverage in both modes.

## User-facing pages and behavior

There are exactly three pages:

1. **Map / Home:** the Demo / Live selector, animated network map, From and To controls, **Find Step-Free Route** action, route result, lift state, and the Demo Mode outage action.
2. **PWA Install Guide:** short iPhone and Android installation steps.
3. **About StepFree:** brief social-impact story centered on people who need step-free journeys, plus FalkorDB and TfL credits.

On a successful route, show the route line, travel time, a **Step-free route** badge, the simple wheelchair-user figure, and lift icons. In Live Mode, begin with the location request prompt described in `DESIGN.md`. Do not request location in Demo Mode.

When the Demo Mode outage is triggered, show **Lift unavailable at Green Park**, pulse the affected station red, fade the old route, show **Finding another step-free route…**, and animate in the graph-computed alternate. Do not present this as a frightening error screen.

Display the safety note on the route experience: **based on currently available TfL accessibility data.**

## Project storytelling

Use one consistent story across `README.md`, the demo video, hackathon submission materials, and launch/social posts.

- Begin with the people StepFree is for: wheelchair users, elderly people, injured people, and parents with strollers.
- Explain that the shortest route is not useful when a traveller cannot actually use it, and frame the benefit around independence, confidence, and practical social impact.
- Keep the sponsor technology visible in the story: TfL supplies transit/accessibility state and disruption updates; FalkorDB stores the connected supported network and computes the valid step-free route and reroute when accessibility infrastructure changes.
- Use the core line where appropriate: **“The shortest route isn’t useful if you can’t use it. StepFree finds the route you actually can.”**
- Do not overstate coverage or safety. The MVP remains limited to the 17-station graph and must retain the exact safety note required above.

## Architecture and stack

```text
stepfree/
├── frontend/    React + Vite + TypeScript PWA
├── backend/     Node.js + Express + TypeScript API
├── AGENTS.md
├── SPEC.md
├── DESIGN.md
├── README.md
└── .gitignore
```

The frontend owns the responsive interface, the MapLibre 3D map (presentation only) and SVG fallback map, Framer Motion transitions, and PWA installation experience. The backend owns the route API, FalkorDB graph operations, and TfL topology/disruption integration. Keep all graph pathfinding in FalkorDB; the client must not become a second routing engine.

Use only this agreed stack:

| Area | Choice |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS |
| Map and motion | MapLibre GL JS with OpenFreeMap vector tiles (3D buildings), SVG fallback, and Framer Motion |
| PWA | `vite-plugin-pwa` |
| Backend | Node.js, Express, TypeScript |
| Graph and routing | FalkorDB with the official FalkorDB Node client |
| Agent | Live Mode: Google Gemini (`gemini-3.8-flash`) through `@google/genai`; Demo Mode: the deterministic `stepfree-demo-policy`; both behind the `AgentModel` interface and run by the same agent host; MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, `/client`, `/node`) over Streamable HTTP; Zod for tool arguments |
| Transit data | TfL APIs and official topology data |
| Tests | Vitest and Supertest |
| Deployment | Frontend on Vercel; backend on Render; FalkorDB Cloud if available, otherwise self-hosted/Docker-compatible FalkorDB |

## Delivery milestones

Milestones are deliverables and acceptance evidence, not time estimates.

| Phase | Deliverable |
|---|---|
| 0 — Topology proof | Official TfL detailed topology is inspected for the 17-station subset; the exact Green Park lift/pathway identifier is verified and recorded; the intended normal and fallback paths are supported by the data. |
| 1 — Graph and routing | The 17-station graph is seeded in FalkorDB with travel-time weights; FalkorDB returns a valid baseline step-free route and a different valid route when the Green Park connection is disabled. |
| 2 — Demo Mode | A repeatable user-visible Demo Mode flow starts from the normal route, simulates the Green Park outage, and displays the graph-computed reroute. |
| 3 — Live Mode and location | Live Mode requests location only on entry; on permission, it places the animated user figure and maps the user to the nearest supported station within the 17-station graph; on denial, Live Mode does not start and Demo Mode remains available. It uses real TfL lift disruption data, requires internet access for current disruption data, and communicates that Live Mode is London-only. |
| 4 — Animated interface | The phone-first map, route states, lift states, user figure, subtle train movement, and outage transition match `DESIGN.md`; desktop adapts the same map as a larger transit view. |
| 5 — PWA and guide | The frontend is installable as a PWA, the iPhone/Android Install Guide page is complete, the app shell can be available offline, and Live Mode clearly requires internet for current TfL disruption data. |
| Agent alignment | Live: Gemini → MCP → FalkorDB; Demo: deterministic policy → MCP → FalkorDB. Seven fixed tools, bounded loop, evidence guards, grounded copy, journey decision memory in FalkorDB, and the **How StepFree decided** trace; Demo (35 → 39 min), Lift 2 outage and unknown-station scenarios pass through the agent. |
| 6 — Verification and demo readiness | Vitest and Supertest cover the core routing/API behavior; the safety note, three pages, credits, and route demo are checked; the frontend/backend/FalkorDB deployment targets are prepared for the demonstration. |
