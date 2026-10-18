# StepFree

**The shortest route isn’t useful if you can’t use it. StepFree finds the route you actually can.**

For wheelchair users, elderly people, injured people and parents with strollers, one broken lift can turn a familiar journey into a dead end. When that happens mid-trip, it costs more than time: it chips away at the confidence to travel independently. StepFree is an accessibility journey agent for public transport. It shows a step-free route and, when something the route depends on becomes unavailable, works out whether your journey is affected and finds another route you can still use.

## What it does

StepFree is a proof of concept covering **17 London Underground stations**: Victoria, Green Park, St James’s Park, Westminster, Waterloo, Southwark, London Bridge, Bond Street, Tottenham Court Road, King’s Cross St Pancras, Paddington, Liverpool Street, Farringdon, Moorgate, Canary Wharf, Tower Hill and Canada Water. It is not a London-wide journey planner. Routes are **based on currently available TfL accessibility data.**

- **Route Health** — Clear, Affected, Rerouted or No step-free route, computed from tool evidence only.
- **Plan B** — a backup step-free route found before anything breaks, shown as a preview. It is not a reroute.
- **Why this route?** — short plain-language reasons, assembled deterministically from the same tool results.
- **How StepFree decided** — the safe tool-call trace (tools, arguments, results, timings), never the model’s private reasoning.
- **Demo Mode** — the universal judge experience: no location, no London visit, no real disruption needed. Three simulated events: lift outage, station closure, line disruption. A deterministic agent policy runs it, so it needs no Gemini quota.
- **Live Mode** — London only, needs location permission. Uses the nearest supported station and real TfL lift-disruption data, with Gemini 3.8 Flash as the agent.
- **Installable PWA** — an Install page explains adding it to the home screen on iPhone and Android.

### How the map behaves

MapLibre GL JS with the [OpenFreeMap](https://openfreemap.org) Positron style (no API key). StepFree opens on a fast flat 2D overview of the 17 stations. When a route fits at a zoom where buildings are meaningful, the camera tilts into a route-focused 3D view; on narrower screens a route may stay in 2D. If WebGL or the map tiles are unavailable (offline, blocked), the app falls back to a schematic SVG map. The map is presentation only: every route comes from FalkorDB.

## How it works

- **TfL tells StepFree what changed.** Lift disruptions come from TfL’s lift-disruption feed. Stations, platforms, lifts and step-free paths come from TfL’s official detailed station topology; ride times come from TfL timetable data.
- **FalkorDB understands the connected network.** Stations have street and line-specific access nodes, linked by `RIDE` relationships (timetable minutes) and `STEP_FREE_TRANSFER` relationships (lifts and level paths from TfL topology).
- **FalkorDB finds the valid step-free route.** Routes come from FalkorDB’s weighted shortest path (`algo.SPpaths`). When something is unavailable, the connections that depend on it are removed (`UNAVAILABLE_TRANSFER`, `UNAVAILABLE_RIDE`) in a copy of the graph and FalkorDB returns the next valid route.
- **An agent decides which tool to call; it never routes.** In Live Mode that agent is Gemini; in Demo Mode it is a deterministic StepFree policy (below). Neither computes routes or writes queries.

### Agent architecture (Track 01 — Agents That Act on Connected Data)

StepFree has one agent host and one set of tools. Only the tool-selection policy depends on the mode, and the app says which one ran (in **How StepFree decided**):

| | Demo Mode | Live Mode |
|---|---|---|
| Chooses the next tool | **Deterministic StepFree policy** (`stepfree-demo-policy`, `backend/src/agent/demoPolicyModel.ts`) | **Gemini 3.8 Flash** (`gemini-3.8-flash`) |
| Gemini requests | None, whatever the configuration | Yes (needs `GEMINI_API_KEY`) |
| Tools, MCP, FalkorDB, guards, trace | Identical | Identical |
| If the agent is unavailable | Always available | “Journey agent is temporarily unavailable.” (no silent fallback to the Demo policy) |

Why: the Demo is the repeatable experience that judges and visitors run again and again, and a free Gemini quota can run out. A deterministic policy keeps it reliable, fast and quota-independent, and it is disclosed rather than disguised. It is not Gemini and is never called Gemini. It chooses from the same seven validated MCP tools by reading the previous tool results (plan, check disruptions, reroute if something the route needs is unavailable, find Plan B, record). It contains no routes, times, stations or lifts: FalkorDB computes every route, backup and dependency, and the policy accepts whatever it returns.

```text
Frontend (Run Demo, From / To, Simulate disruption)
  → POST /api/agent/journey
  → Agent host (backend)         Demo: deterministic policy · Live: Gemini 3.8 Flash. Picks the next tool
  → MCP client                   tools/list → tool catalogue, tools/call → execution
  → StepFree MCP server (/mcp)   seven fixed tools, Streamable HTTP
  → FalkorDB + TfL lift feed     fixed, parameterised Cypher; algo.SPpaths
  → grounded decision            route / reroute / no route, plus a visible action trace
```

The agent host calls the backend’s own `/mcp` endpoint through a real MCP client (TypeScript SDK v2). That endpoint is internal: it needs a bearer token generated at start-up, is not covered by CORS and is never called by the browser.

**The seven MCP tools** (`backend/src/agent/mcpServer.ts`):

| Tool | What it does |
|---|---|
| `resolve_station` | Matches a name or id to a supported station in FalkorDB. |
| `plan_step_free_journey` | Shortest step-free route between two stations; returns the route and the connections it depends on. |
| `inspect_route_dependencies` | Per-connection detail on which lifts a route cannot work without. |
| `get_journey_disruptions` | What is unavailable now (lift, station or line), flagged as relevant to the route or not. |
| `find_alternative_route` | Recomputes the route with the unavailable connections excluded. |
| `find_backup_route` | Plan B: the fastest distinct backup route. |
| `record_journey_decision` | The one write: stores the decision in FalkorDB. |

There is no tool that accepts query text, code, files, shell commands or arbitrary HTTP. Every Cypher query is fixed, human-written and parameterised; tool arguments are validated with Zod and then against the graph.

**Guards the host enforces regardless of the model:** a route can only be selected if a tool returned it; a reroute needs a real disruption on a connection the route requires; the final sentence is checked against tool results; at most 8 tool calls per request; every model and tool step has a timeout. If the model, MCP or TfL feed is unavailable, StepFree says “Journey agent is temporarily unavailable.” and never presents a non-agent route as the agent’s decision.

**Memory.** Each decision is written to FalkorDB as `(:JourneySession)-[:HAS_DECISION]->(:AgentDecision)` with factual metadata only (action, reason code, Route Health, backup availability, affected connection ids). No model reasoning and no raw location is stored or sent to the model; Live Mode passes only the nearest supported station.

## Demo Mode flows

**Run Demo** sets Victoria → London Bridge and runs the healthy journey through the agent. **Simulate disruption** then offers three controlled events, each labelled as a simulated Demo Mode event, not a real TfL disruption. **Reset demo** starts a fresh journey with no restart or refresh.

| Scenario | Journey | Route Health | Plan B |
|---|---|---|---|
| Normal | 35 min | Clear | 39 min |
| Lift outage (Green Park Lift 2) | 39 min | Rerouted | 52 min (recalculated for the new route) |
| Station closure (Green Park) | 39 min | Rerouted | 52 min |
| Line disruption (Jubilee line) | 52 min | Rerouted | 59 min |

A lift, a station and a line are the same thing to the graph: a *connection id* that is unavailable (`940GZZLUGPK-Lift-2`, `STATION:GPK`, `LINE:jubilee`). A disruption affects a journey only if it intersects the connections the route needs; otherwise the agent says so and keeps the route. Station and line events exist only as Demo Mode simulations.

## Limitations

- 17 Underground stations only; no full-London routing. St James’s Park has no step-free access and is pass-through only.
- Live Mode is London-only and needs location permission and internet access.
- Live data covers **lift disruptions only**; live station closures and line disruptions are not covered.
- Travel times are timetable-based, not delay-adjusted live ETAs. Step-free transfer times are estimates.
- The installable app shell works offline; finding a route needs internet.

## Run locally

Requirements: Node.js 20+ and a running FalkorDB on `localhost:6379`.

1. Start FalkorDB, for example with Docker:

   ```bash
   docker run -p 6379:6379 -it --rm falkordb/falkordb
   ```

2. Start the API (it seeds the `stepfree` graph on startup):

   ```bash
   cd backend
   npm install
   cp .env.example .env     # add GEMINI_API_KEY to enable Live Mode (Demo Mode needs no key)
   npm run dev
   ```

3. Start the app and open http://localhost:5173:

   ```bash
   cd frontend
   npm install
   cp .env.example .env.local
   npm run dev
   ```

Rebuild the graph data from TfL’s published files with `npm run topology` in `backend`. The service worker only runs in a production build; to try installing locally, run `npm run build` and `npm run preview` in `frontend` and set `CORS_ORIGIN=http://localhost:4173` in `backend/.env`.

## Tests

```bash
cd backend && npm test && npm run typecheck && npm run build    # needs FalkorDB running; makes no real Gemini request (Demo uses the deterministic policy; tests use doubles for Live)
cd frontend && npm test && npm run typecheck && npm run lint && npm run build
```

## Environment variables

**Backend** (`backend/.env` locally, Render environment in production):

| Variable | Required | Secret | Purpose |
|---|---|---|---|
| `FALKORDB_URL` | Yes in production (defaults to `redis://127.0.0.1:6379`) | Yes (may contain credentials) | FalkorDB connection, `redis://` or `rediss://` |
| `GEMINI_API_KEY` | Only for Live Mode | Yes | Gemini key. Backend only. Without it Live Mode reports “Journey agent is temporarily unavailable.”; Demo Mode is unaffected. |
| `TFL_APP_KEY` | Optional, recommended | Yes | TfL Unified API key. Without it TfL’s lower anonymous rate limit applies. |
| `CORS_ORIGIN` | Yes in production (defaults to `http://localhost:5173`) | No | The one allowed frontend origin, no trailing slash |
| `PORT` | No | No | Defaults to 4000. Render supplies it: do not set it there. |

**Frontend** (`frontend/.env.local` locally, Vercel environment in production):

| Variable | Required | Secret | Purpose |
|---|---|---|---|
| `VITE_API_URL` | Yes in production (defaults to `http://localhost:4000`) | No, it is public | Backend origin, no trailing slash. Read at build time. |

## Deploying StepFree

StepFree deploys as three parts: a FalkorDB database, the backend on Render and the frontend on Vercel.

**1. FalkorDB.** Create a FalkorDB instance reachable from Render and copy its connection URL. `FALKORDB_URL` takes the shape `rediss://<username>:<password>@<host>:<port>` (use `redis://` if the instance has no TLS). `127.0.0.1` will not work in production. The backend seeds the `stepfree` graph itself on every start; there is nothing to import.

**2. Render (backend).** New Web Service from `london160771/StepFree`.

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Environment | `FALKORDB_URL`, `GEMINI_API_KEY` (Live Mode only), `TFL_APP_KEY` (optional), `CORS_ORIGIN` |

**3. Vercel (frontend).** Import the same repository.

| Setting | Value |
|---|---|
| Framework Preset | Vite |
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Environment | `VITE_API_URL=<your Render backend origin>` |

**4. Close the loop.** Once Vercel gives you the final URL, set Render’s `CORS_ORIGIN` to exactly that origin (for example `https://<project>.vercel.app`, no trailing slash) and restart the backend. Never put `GEMINI_API_KEY`, `FALKORDB_URL` or `TFL_APP_KEY` in Vercel.

### Production smoke test

1. `https://<render-host>/api/health` returns `{"ok":true}`; `/api/network` returns 17 stations.
2. The Vercel site loads; Map, Install and About pages open; the map shows the 17 stations.
3. **Run Demo** (the response's `agent.model` reads `stepfree-demo-policy`, so it uses no Gemini quota): Victoria → London Bridge, 35 min, Route Health Clear, Plan B 39 min.
4. **Simulate disruption → Lift outage**: 39 min, Rerouted, Plan B 52 min. **Reset demo**, then **Station closure**: 39 min, Rerouted. **Reset demo**, then **Line disruption → Jubilee**: 52 min, Rerouted, Plan B 59 min.
5. Open **How StepFree decided** and check the tool trace appears.
6. On a phone: the page loads, the 2D overview is quick, a route displays, the app can be installed.
7. Live Mode only if you are in London.

## AI use disclosure

- **Coding assistant:** this repository was built with Claude Code (Anthropic’s Claude models, Opus 5.5 and Sonnet 5.5) directed by the project owner, who reviews and runs the work. Commits made with it carry a `Co-Authored-By` trailer.
- **Runtime model (Live Mode only):** in Live Mode the journey agent calls Google’s Gemini (`gemini-3.8-flash`, `@google/genai`) from the backend. It only chooses among the StepFree MCP tools; it does not compute routes or write queries.
- **Demo Mode uses no AI model:** a deterministic StepFree policy chooses the tools, through the same MCP server, FalkorDB graph and guards. It is not Gemini and is not presented as Gemini.
- The coding assistant is not part of the running product.

## Project layout

```text
frontend/   React + Vite + TypeScript + Tailwind CSS + Framer Motion, MapLibre GL map, PWA via vite-plugin-pwa
backend/    Node.js + Express + TypeScript API, FalkorDB routing, MCP server and agent host, TfL integration
  data/network.json         17-station graph built from TfL data (committed)
  scripts/build-network.ts  rebuilds network.json from TfL topology, timetable and StopPoint APIs
```

## Credits

Graph routing by [FalkorDB](https://www.falkordb.com/). Agent tools served over the [Model Context Protocol](https://modelcontextprotocol.io) (TypeScript SDK v2); tool selection by Google Gemini in Live Mode. Transit, station topology and lift data from Transport for London. Powered by TfL Open Data. StepFree is an independent project and is not endorsed by TfL.

Map: [MapLibre GL JS](https://maplibre.org/) with the [OpenFreeMap](https://openfreemap.org) Positron style and vector tiles; © OpenMapTiles, data from [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors, ODbL).

Fallback city backdrop: built from [OpenStreetMap](https://www.openstreetmap.org/copyright) data (© OpenStreetMap contributors, ODbL) by `frontend/scripts/build-city.mjs`; no OSM data is bundled.

Intro photo: [Big Ben and Westminster Bridge at dusk](https://commons.wikimedia.org/wiki/File:Big_Ben_and_Westminster_Bridge_at_dusk_2017-unsplash.jpg), CC0, via Wikimedia Commons.
