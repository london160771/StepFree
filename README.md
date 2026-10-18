# StepFree

**The shortest route isn’t useful if you can’t use it. StepFree finds the route you actually can.**

For wheelchair users, elderly people, injured people and parents with strollers, one broken lift can turn a familiar journey into a dead end. When that happens mid-trip, it costs more than time: it chips away at the confidence to travel independently. StepFree shows a step-free route and, when a lift becomes unavailable, calmly finds another one you can still use.

## How it works

- **TfL tells StepFree what changed.** Lift disruptions come from TfL’s live lift disruption feed. Stations, platforms, lifts and step-free paths come from TfL’s official detailed station topology.
- **FalkorDB understands the connected transit graph.** Each station has street and line-specific nodes, linked by `RIDE` relationships (with TfL timetable run times) and `STEP_FREE_TRANSFER` relationships (lift and level paths taken from TfL topology).
- **FalkorDB finds the new usable step-free route.** Routes come from FalkorDB’s weighted shortest path (`algo.SPpaths`) over `RIDE` and `STEP_FREE_TRANSFER`, weighted by travel time. When a lift is unavailable, the step-free connections that depend on it become `UNAVAILABLE_TRANSFER`, and FalkorDB returns the next valid route.

This is a proof of concept covering 17 London Underground stations: Victoria, Green Park, St James’s Park, Westminster, Waterloo, Southwark, London Bridge, Bond Street, Tottenham Court Road, King’s Cross St Pancras, Paddington, Liverpool Street, Farringdon, Moorgate, Canary Wharf, Tower Hill and Canada Water. Only Underground lines are modelled; platforms without step-free access (for example Liverpool Street’s Central line) are left out of routing, and a station with no step-free access (St James’s Park) is pass-through only. It is not a London-wide journey planner. Routes are **based on currently available TfL accessibility data.**

## Agent architecture

**Track 01 — Agents That Act on Connected Data.** StepFree is a journey agent: it uses the graph to decide and act, and shows how it decided.

```text
Frontend (Run Demo, From / To, Simulate disruption)
  → POST /api/agent/journey
  → Agent host (backend)         Gemini (gemini-3.8-flash) picks the next tool
  → MCP client                   tools/list → the model's tool catalogue, tools/call → execution
  → StepFree MCP server (/mcp)   six fixed tools, Streamable HTTP
  → FalkorDB + TfL lift feed     fixed, parameterised Cypher; algo.SPpaths
  → grounded decision            route / reroute / no route, plus a visible action trace
```

What makes it an agent rather than a route lookup:

- **It chooses tools.** The model is given only the MCP tool definitions and the traveller's goal, and decides which tool to call next from what the previous tools returned. The host executes each choice through a real MCP `tools/call`.
- **It acts on what the graph shows.** It reads which lifts the route depends on (multi-hop: route, to its transfers, to the lifts those transfers need), checks disruptions against them, and only then keeps the route, reroutes (`find_alternative_route`, a new FalkorDB shortest path with those connections excluded) or reports that no route exists.
- **It remembers what it did.** Each decision is written to FalkorDB as `(:JourneySession)-[:HAS_DECISION]->(:AgentDecision)`, linked to the origin and destination stations and to the stations of any affected lift (`[:AFFECTED_BY]`). Only factual metadata is stored (action, reason code, duration, affected connection ids), never model reasoning and never raw location.
- **It says when something is not in the graph.** An unsupported station gets “That station isn't in StepFree's current supported network.” and no route.

Safety rules the host enforces, independent of the model:

- The model never writes Cypher and never computes a route. There is no query tool. Every graph operation is fixed Cypher in `backend/src/graph/routing.ts` with parameters; tool arguments are validated with Zod (types, enums, lengths, array limits, id patterns), then checked against the graph (unknown stations and unknown lift ids are refused).
- A route can only be selected if `plan_step_free_journey` returned it; a reroute needs `find_alternative_route` plus a disruption, reported by `get_journey_disruptions`, on a connection the current route requires; a disruption can only be claimed from tool evidence. Unsupported decisions are rejected back to the model, and repeated attempts end the request.
- At most 8 MCP tool calls per request (a normal journey uses 4, a reroute re-check 4, a fresh journey that must reroute 5), identical repeated calls are refused, and each model and tool step has a timeout.
- The final sentence shown to the traveller is checked against the tool results (minutes, station names, lines, lift names). If anything is unsupported it is replaced by plain copy assembled from the results.
- The `/mcp` endpoint is internal: it needs a bearer token the backend generates at start-up, is not covered by CORS and is never called by the browser. The Gemini key stays on the backend.
- If the model, MCP or TfL feed is unavailable, StepFree says so (“Journey agent is temporarily unavailable.”). It never quietly falls back to a non-agent route and presents it as the agent's decision.

Current limits: 17 Underground stations; one disruption type (lift outages); the Demo outage is a controlled simulation, Live Mode uses TfL's real lift feed; journey sessions live in FalkorDB's `stepfree` graph and are cleared when the API reseeds on start.

## MCP tools

The StepFree MCP server (`backend/src/agent/mcpServer.ts`, `@modelcontextprotocol/server` v2, Streamable HTTP at `/mcp`) exposes exactly these tools:

| Tool | Reads or writes | What it does |
|---|---|---|
| `resolve_station` | read | Matches a name or id to a supported station in FalkorDB (`MATCH (s:Station) WHERE s.key = $key OR $key IN s.aliases OR s.id = $id`). Unknown names return `found: false`. `plan_step_free_journey` and `find_alternative_route` run the same lookup internally, so the agent only calls this when a name is ambiguous. |
| `plan_step_free_journey` | read | `algo.SPpaths` over `RIDE` and `STEP_FREE_TRANSFER`, weighted by `minutes`, between two station street nodes. Returns a `routeId`, canonical station names, duration, stations, lines, changes, and the accessibility connections the route depends on (`requiredConnectionIds`), so the agent does not need a second call for them. |
| `find_backup_route` | read | **Plan B.** For each lift the primary route uses, runs the same `algo.SPpaths` query in a graph where that lift (and anything already unavailable) is out, rejects any candidate that is the same journey as the primary, and returns the fastest distinct route with its extra minutes. `available: false` if there is none. |
| `inspect_route_dependencies` | read | Reads the `STEP_FREE_TRANSFER` relationships on the route's path and the lifts each uses (`liftsUsed`) or cannot work without (`requiredLifts`). The planner runs this same query when it returns a route; the tool gives the per-connection detail on request. |
| `get_journey_disruptions` | read | What is unavailable now, as one list whatever the type (`LIFT`, `STATION`, `LINE`; each with `simulated`, `label` and the connection ids it affects). Demo: the single simulated event the user activated. Live: TfL's real lift disruptions (`simulated: false`). Each disruption is flagged relevant to the current route or not. |
| `find_alternative_route` | read | Copies the graph with the affected `STEP_FREE_TRANSFER` relationships re-typed `UNAVAILABLE_TRANSFER`, then runs the same shortest-path query. |
| `record_journey_decision` | write | The one write: creates the `AgentDecision` under the `JourneySession` and links it to stations. |

There is no tool that runs query text, code, shell, files or HTTP.

## Example decision trace

Demo Mode, Victoria → London Bridge (each line is an executed MCP call: tool, arguments, compact result, duration):

```text
1  plan_step_free_journey {origin:"Victoria", destination:"London Bridge"}
                                                     → 35 min via Green Park, Westminster, Waterloo, Southwark; requires 940GZZLUGPK-Lift-2, HUBLBG-Lift-2
2  get_journey_disruptions {mode:"demo", relevantConnectionIds:[…]}  → no active disruption
3  find_backup_route {primaryRouteId, …}             → Plan B: 39 min via St James's Park, Westminster, … (+4 min)
4  record_journey_decision {action:"ROUTE_SELECTED"} → recorded (Route Health CLEAR, backup available)
```

After **Simulate disruption → Lift outage** (the app only reports which event was activated; the agent re-checks the same session, given the stored route's required connections):

```text
1  get_journey_disruptions {mode:"demo", relevantConnectionIds:[…]}  → Green Park Lift 2 unavailable (simulated, relevant)
2  find_alternative_route {…, unavailableConnectionIds:["940GZZLUGPK-Lift-2"]} → 39 min via St James's Park, Westminster, Waterloo, Southwark
3  find_backup_route {primaryRouteId: <the new route>, unavailableConnectionIds:[…]} → Plan B recalculated: 52 min via Green Park, King's Cross St Pancras, Moorgate (+13 min)
4  record_journey_decision {action:"REROUTED", reasonCode:"REQUIRED_LIFT_UNAVAILABLE"} → recorded (Route Health REROUTED)
```

The app shows this under **How StepFree decided** (collapsed by default), in plain words generated from the structured results.

## Plan B, Route Health and Why this route?

Beside the route, the app answers three questions without making anyone read graph terms:

- **Route Health** (Clear, Affected, Rerouted, No step-free route). Computed in the backend from tool evidence only: Clear when a route exists and no current disruption touches a connection it requires; Affected when one does; Rerouted when the agent replaced an affected route with a valid one; No step-free route when FalkorDB finds none. No scores or percentages, and no model judgement.
- **Plan B** (“Backup available · 39 min +4 min”). A backup route FalkorDB found *before* anything broke, shown as a collapsed preview with its stations, lines and duration. It is not selected, and never replaces the current route. The agent chooses to call `find_backup_route`; the tool tries each lift the primary route uses (bounded to 8, and only lifts whose loss removes a connection are queried), rejects candidates that are the same journey as the primary, and keeps the fastest distinct one. If there is none it says so.
- **Why this route?** Short human reasons (shortest usable step-free route, connections available, lines, changes, lifts it cannot do without, whether a Plan B exists), assembled deterministically from the same tool results. It costs no extra model call and never shows reasoning or Cypher. It is separate from **How StepFree decided**, which is the technical tool trace.

**Plan B is not a reroute.** Plan B is a preview computed in advance; a reroute is the route the agent actually selects after a disruption makes the current one unusable, and after a reroute Plan B is recalculated for the new route. Route Health, whether a backup exists and its route id are stored on the `AgentDecision` node (`routeHealth`, `backupAvailable`, `backupRouteId`).

## AI use disclosure

- **Coding assistant:** this repository was built with Claude Code (Anthropic's Claude models, Opus 5.5 and Sonnet 5.5) directed by the project owner, who reviews and runs the work. Commits made with it carry a `Co-Authored-By` trailer.
- **Runtime model:** at run time the journey agent calls Google's Gemini (`gemini-3.8-flash`, `@google/genai`) from the backend. It only chooses among the StepFree MCP tools and words the result; it does not compute routes or write queries. These are separate things: the coding assistant is not part of the running product.

### Demo Mode: the universal judge experience

Demo Mode is the main way to experience StepFree, for a judge anywhere in the world. It needs **no location, no London visit and no real disruption**: it never asks the browser for location, and nothing about it is geofenced. Live Mode (below) is a London-only bonus.

1. **Run Demo** sets Victoria → London Bridge, clears any simulated event and runs the healthy journey through the agent: 35 min via Green Park, Route Health **Clear**, a Plan B (39 min, +4 min), **Why this route?** and **How StepFree decided**. Nothing is disrupted yet.
2. **Simulate disruption** offers exactly three controlled events, each labelled as a *simulated Demo Mode event, not a real TfL disruption*. One can be active at a time:
   - **Lift outage: Green Park Lift 2** (`940GZZLUGPK-Lift-2`). 35 → 39 min via the District line and Westminster.
   - **Station closure: Green Park station.** 35 → 39 min via the District line and Westminster.
   - **Line disruption: Jubilee line.** 35 → 52 min: Victoria line to King's Cross St Pancras, then the Northern line via Moorgate.
3. **Reset demo** runs a fresh journey in a new session. No backend restart, reseed or page refresh is needed, and nothing from the previous event is carried over.

The app only tells the backend *which* event was activated. The agent reads the current disruption, checks it against what the current route depends on, and only then decides: reroute (FalkorDB computes the replacement and Plan B is recalculated for it), or keep the route. If you pick another From/To pair and activate an event that does not touch that journey, the agent says so and keeps the route (Route Health stays Clear).

**One generic disruption model.** A lift, a station and a line are all the same thing to the graph, the tools and the agent: a *connection id* that is unavailable (`940GZZLUGPK-Lift-2`, `STATION:GPK`, `LINE:jubilee`). A route depends on connection ids too (its required lifts, the stations where it enters, leaves or changes, the lines it rides alone). A disruption affects a route exactly when the two intersect. FalkorDB then recomputes with those ids excluded:

| Disruption | What the graph loses |
|---|---|
| Lift | every `STEP_FREE_TRANSFER` that TfL topology says cannot work without that lift (becomes `UNAVAILABLE_TRANSFER`) |
| Station (closed) | every `STEP_FREE_TRANSFER` at the station: no street access, no boarding, no alighting, no interchange. Trains keep running *through* a closed station, so rides along a line are untouched. |
| Line | every `RIDE` that only that line provides (becomes `UNAVAILABLE_RIDE`); a ride another line also serves survives |

Why these scenarios were chosen: they were validated against the 17-station FalkorDB graph for Victoria → London Bridge. **Green Park** is the only station whose closure changes this journey, because it is the only place the route uses a station (the Victoria to Jubilee interchange); every other station on it is passed through, which a closed station allows. The closure therefore produces the same 39-minute route as the lift outage, for a different reason. **Jubilee line** carries most of the journey, and without it FalkorDB finds a genuinely different valid route (52 min, Northern line) rather than the lift route; the Victoria line would also have reproduced the 39-minute route.

Station and line disruptions exist only as Demo Mode simulations. They are not live TfL feeds, and nothing here claims otherwise. Live Mode still uses TfL's real lift disruptions only.

The lift is derived from TfL data, not chosen by hand. In TfL’s topology, Lift 2 is the only lift whose loss breaks every step-free path between Green Park’s Victoria line and Jubilee line platforms. The Victoria line lifts (5 and 6) back each other up. Only that interchange, and street access to the Jubilee line, are disabled. Green Park’s Victoria line access stays available.

### Live Mode

Live Mode asks for your location only after you choose it and tap **Allow Location**. It places the wheelchair-user figure on the map, starts from the nearest supported station with step-free street access, and routes with current TfL lift disruptions. If location is denied, Live Mode doesn’t start and Demo Mode stays available. Outside London it shows “Live Mode is currently available in London only.” Live Mode needs an internet connection for current TfL data.

### Install as an app

StepFree is an installable PWA. The **Install** page has short iPhone (Safari) and Android (Chrome) steps for adding it to the home screen. Once installed, the app shell opens even without a connection. Finding a route needs internet, and Live Mode needs internet for current TfL lift data.

## Project layout

```text
frontend/   React + Vite + TypeScript + Tailwind CSS + Framer Motion, MapLibre GL 3D map, PWA via vite-plugin-pwa
backend/    Node.js + Express + TypeScript API, FalkorDB routing, TfL integration
  data/network.json         17-station graph built from TfL data (committed)
  scripts/build-network.ts  rebuilds network.json from TfL topology, timetable and StopPoint APIs
```

## Run locally

Requirements: Node.js 20+ and a running FalkorDB on `localhost:6379`.

1. Start FalkorDB, for example with Docker:

   ```bash
   docker run -p 6379:6379 -it --rm falkordb/falkordb
   ```

   Without Docker, you can load the FalkorDB module release (`falkordb-x64.so`) into `redis-server` on Linux or WSL with `redis-server --loadmodule ./falkordb-x64.so`.

2. Start the API. It seeds the `stepfree` graph on startup.

   ```bash
   cd backend
   npm install
   cp .env.example .env     # add GEMINI_API_KEY for the journey agent
   npm run dev
   ```

3. Start the app, then open http://localhost:5173.

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

To rebuild the graph data from TfL’s current published files, run `npm run topology` in `backend`.

The service worker only runs in a production build. To try installing locally, run `npm run build` and `npm run preview` in `frontend`, set `CORS_ORIGIN=http://localhost:4173` in `backend/.env`, and open http://localhost:4173. PWA icons are generated from `frontend/public/icon.svg` with `npm run icons`.

## Environment variables

| Variable | Where | Required | Public? | Purpose |
|---|---|---|---|---|
| `FALKORDB_URL` | `backend/.env` | No (defaults to `redis://127.0.0.1:6379`) | No, it may contain credentials | FalkorDB connection |
| `GEMINI_API_KEY` | `backend/.env` | Yes, for the journey agent | No, never expose it | Gemini key for the journey agent (backend only). Without it the agent reports “Journey agent is temporarily unavailable.” |
| `TFL_APP_KEY` | `backend/.env` | No | No | TfL Unified API key for higher rate limits |
| `PORT` | `backend/.env` | No (4000) | Yes | API port |
| `CORS_ORIGIN` | `backend/.env` | No (`http://localhost:5173`) | Yes | Allowed frontend origin |
| `VITE_API_URL` | `frontend/.env.local` | No (`http://localhost:4000`) | Yes, it is built into the app | API base URL |

## Tests

```bash
cd backend && npm test      # topology proof, FalkorDB routing, MCP server, journey agent (fake model), API (needs FalkorDB running)
cd frontend && npm test     # map layout and route descriptions
```

## Travel times

Ride times come from the TfL timetable API. Step-free transfer times assume 3 km/h and 2 minutes per lift. Walking distance uses TfL’s published step-free interchange distance where one exists (Green Park). Otherwise it is estimated from TfL topology area coordinates with a 1.3 corridor factor. These times are estimates for comparing routes.

## Credits

Graph routing by [FalkorDB](https://www.falkordb.com/). Agent tools served over the [Model Context Protocol](https://modelcontextprotocol.io) (TypeScript SDK v2); tool selection by Google Gemini. Transit, station topology and lift data from Transport for London. Powered by TfL Open Data.

3D map: [MapLibre GL JS](https://maplibre.org/) with the [OpenFreeMap](https://openfreemap.org) Positron style and vector tiles (no API key). Map credit shown in the app: OpenFreeMap, © OpenMapTiles, data from OpenStreetMap. The map is presentation only: every route still comes from FalkorDB. If the tiles can't load (offline) the app falls back to the schematic map.

Fallback city backdrop: built from [OpenStreetMap](https://www.openstreetmap.org/copyright) data, © OpenStreetMap contributors, available under the Open Database License. `frontend/scripts/build-city.mjs` warps real central London onto the station layout and renders it as images in `frontend/public/city/`; no OSM data is bundled.

Intro photo: [Big Ben and Westminster Bridge at dusk](https://commons.wikimedia.org/wiki/File:Big_Ben_and_Westminster_Bridge_at_dusk_2017-unsplash.jpg), CC0 (public domain dedication), via Wikimedia Commons. Resized and cropped to WebP in `frontend/public/intro/`.
