# StepFree

**The shortest route isn’t useful if you can’t use it. StepFree finds the route you actually can.**

For wheelchair users, elderly people, injured people and parents with strollers, one broken lift can turn a familiar journey into a dead end. When that happens mid-trip, it costs more than time: it chips away at the confidence to travel independently. StepFree shows a step-free route and, when a lift becomes unavailable, calmly finds another one you can still use.

## How it works

- **TfL tells StepFree what changed.** Lift disruptions come from TfL’s live lift disruption feed. Stations, platforms, lifts and step-free paths come from TfL’s official detailed station topology.
- **FalkorDB understands the connected transit graph.** Each station has street and line-specific nodes, linked by `RIDE` relationships (with TfL timetable run times) and `STEP_FREE_TRANSFER` relationships (lift and level paths taken from TfL topology).
- **FalkorDB finds the new usable step-free route.** Routes come from FalkorDB’s weighted shortest path (`algo.SPpaths`) over `RIDE` and `STEP_FREE_TRANSFER`, weighted by travel time. When a lift is unavailable, the step-free connections that depend on it become `UNAVAILABLE_TRANSFER`, and FalkorDB returns the next valid route.

This is a proof of concept covering seven central London stations: Victoria, Green Park, St James’s Park, Westminster, Waterloo, Southwark and London Bridge. It is not a London-wide journey planner. Routes are **based on currently available TfL accessibility data.**

### Demo Mode

A controlled, repeatable outage. Victoria → London Bridge first goes via Green Park (Victoria line, then Jubilee line). **Simulate lift outage** makes Green Park **Lift 2** (`940GZZLUGPK-Lift-2`) unavailable. FalkorDB then reroutes via the District line to Westminster, passing St James’s Park without stopping, and the Jubilee line onward to London Bridge.

The lift is derived from TfL data, not chosen by hand. In TfL’s topology, Lift 2 is the only lift whose loss breaks every step-free path between Green Park’s Victoria line and Jubilee line platforms. The Victoria line lifts (5 and 6) back each other up. Only that interchange, and street access to the Jubilee line, are disabled. Green Park’s Victoria line access stays available.

### Live Mode

Live Mode asks for your location only after you choose it and tap **Allow Location**. It places the wheelchair-user figure on the map, starts from the nearest supported station with step-free street access, and routes with current TfL lift disruptions. If location is denied, Live Mode doesn’t start and Demo Mode stays available. Outside London it shows “Live Mode is currently available in London only.” Live Mode needs an internet connection for current TfL data.

## Project layout

```text
frontend/   React + Vite + TypeScript + Tailwind CSS + Framer Motion (SVG map)
backend/    Node.js + Express + TypeScript API, FalkorDB routing, TfL integration
  data/network.json         seven-station graph built from TfL data (committed)
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
   cp .env.example .env
   npm run dev
   ```

3. Start the app, then open http://localhost:5173.

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

To rebuild the graph data from TfL’s current published files, run `npm run topology` in `backend`.

## Environment variables

| Variable | Where | Required | Public? | Purpose |
|---|---|---|---|---|
| `FALKORDB_URL` | `backend/.env` | No (defaults to `redis://127.0.0.1:6379`) | No, it may contain credentials | FalkorDB connection |
| `TFL_APP_KEY` | `backend/.env` | No | No | TfL Unified API key for higher rate limits |
| `PORT` | `backend/.env` | No (4000) | Yes | API port |
| `CORS_ORIGIN` | `backend/.env` | No (`http://localhost:5173`) | Yes | Allowed frontend origin |
| `VITE_API_URL` | `frontend/.env.local` | No (`http://localhost:4000`) | Yes, it is built into the app | API base URL |

## Tests

```bash
cd backend && npm test      # topology proof, FalkorDB routing, API (needs FalkorDB running)
cd frontend && npm test     # map layout and route descriptions
```

## Travel times

Ride times come from the TfL timetable API. Step-free transfer times assume 3 km/h and 2 minutes per lift. Walking distance uses TfL’s published step-free interchange distance where one exists (Green Park). Otherwise it is estimated from TfL topology area coordinates with a 1.3 corridor factor. These times are estimates for comparing routes.

## Credits

Graph routing by [FalkorDB](https://www.falkordb.com/). Transit, station topology and lift data from Transport for London. Powered by TfL Open Data.
