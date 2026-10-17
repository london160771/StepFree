# StepFree Graph Hacks — design and interaction

## Design direction

Build a modern mobility app with a subtle SimCity feel. Keep the map clean and legible rather than playful or childish. The interface is phone-first; on desktop, give the same map more room so it reads like a larger transit view.

Use soft isometric building shapes as quiet context, simple roads/transit lines, clear station markers, and generous whitespace. The transit network and step-free route must remain the visual focus. Use large, readable text and large touch targets.

The visual language is:

- **Map:** a calm 3D map of real central London (MapLibre GL JS, OpenFreeMap/OpenStreetMap tiles, extruded buildings in stone and brick tones) with the 17-station network drawn on top at real coordinates. A schematic SVG map is the offline/no-WebGL fallback.
- **Motion:** Framer Motion and the map camera for the intro hand-off and route changes, the station outage pulse, the user figure's small journey animation, and subtle train movement. Keep train motion restrained and non-distracting.
- **Route:** a high-contrast line drawn over the network with clear origin/destination and transfer points.
- **Accessibility cues:** lift icons and explicit text labels; do not communicate an outage by color alone.
- **Tone:** calm and reassuring, especially while a route is being recalculated.

## Information architecture

Provide exactly these three pages:

1. **Map / Home**
2. **PWA Install Guide**
3. **About StepFree**

Map / Home is the primary experience. Keep the navigation small and direct. Do not add a dashboard, sidebar, account flow, or additional page.

## Map / Home layout

On mobile, the map fills the screen. Place a clear **Demo / Live** selector at the top and a bottom sheet over the map containing:

- **From** station selector
- **To** station selector
- **Find Step-Free Route** button

The bottom sheet must leave enough of the map visible to understand the network and route. Keep the primary action large and easy to reach.

On wider screens, retain the same content and hierarchy while giving the map more area and arranging the controls beside or over the map. Do not turn the layout into a control dashboard.

### Route result

After a route is found, show the route line on the map and a concise result with:

- Origin and destination
- Calculated travel time
- **Step-free route** badge
- Simple wheelchair-user figure
- Lift icons at relevant stations

The wheelchair-user figure is a small illustrative map character, not a user profile or account avatar. A sample result may read “Victoria → London Bridge” and “18 min”; display the graph's calculated result rather than treating the sample time as fixed.

Show the safety note exactly as written: **based on currently available TfL accessibility data.**

### How StepFree decided

Beside the route result, three compact additions stay within the existing cards and type: a small **Route Health** status (Clear, Affected, Rerouted, No step-free route) under the **Step-free route** badge; a collapsed **Plan B** row (“Backup available · 39 min +4 min”, expanding to stations, lines and duration, or “No backup route currently available”); and a collapsed **Why this route?** disclosure of plain-language reasons. Plan B is a preview and is never drawn as the active route. **Why this route?** is the user's explanation and is kept separate from the technical trace below.

Below the route result, a compact, collapsed-by-default disclosure titled **How StepFree decided** lists the agent's actions in plain words (for example “Asked FalkorDB for a step-free route: 35 min via …”, “Detected Green Park Lift 2 unavailable”), each with the tool name and duration in small type. Lines come from structured tool results returned by the backend, never from model text or reasoning. It is a native `<details>` disclosure (keyboard and screen-reader friendly), not a chatbot, floating assistant or AI branding. Above the route card, one short sentence states the agent's result in plain language (for example “Your step-free route is ready. It takes about 35 minutes.”). After the outage, the banner carries the agent's explanation of what changed.

## Demo Mode flow

Demo Mode is the primary experience, for anyone anywhere. It never asks for location.

1. The user selects **Demo**. Beside the From / To pickers (which stay available for other journeys) a prominent **Run Judge Demo** button sets Victoria → London Bridge, clears any simulated event and runs the healthy journey.
2. The route is drawn over the station graph, with Route Health **Clear**, Plan B, **Why this route?** and **How StepFree decided**. No disruption is triggered automatically.
3. A compact **Simulate disruption** control follows: a select with exactly three options (**Lift outage**, **Station closure**, **Line disruption**, each with what it affects) and a **Simulate** button. It is labelled as a Demo Mode event, not a real TfL disruption.
4. On activation, a banner reads **Simulated disruption: Green Park Lift 2 unavailable** (or **Green Park station closed**, or **Jubilee line unavailable**). Affected stations pulse red on the map: the station for a lift or station event, the stations the journey rides that line through for a line event.
5. The app reports the event to the journey agent, fades the old route and shows **Finding another step-free route…** while the agent checks whether the journey is affected.
6. If it is affected, draw the route returned by FalkorDB and show Route Health **Rerouted** with Plan B recalculated for the new route. If it is not, the banner says the disruption does not affect the journey and the route stays (Route Health stays Clear).
7. **Reset demo** starts a clean Demo journey (no stale event, route or exclusions) and brings back the Simulate control.

Only one simulated event is active at a time. Do not color a whole station as inaccessible for a lift event, and do not imply any of the three events is a real current TfL disruption.

## Live Mode flow

When the user selects **Live**, introduce the location request with:

> Use your location to find step-free routes around you.

Provide an **Allow Location** action. Request browser location only in this mode; Demo Mode works without permission. If permission is granted, use the browser location to place the animated user figure and map the user to the nearest supported station within the 17-station graph for routing. If permission is denied, Live Mode must not start and Demo Mode remains available. Use Live Mode with TfL lift disruption data and the 17-station graph. Do not present the MVP as supporting routes across all of London.

When the location is outside London, show:

> Live Mode is currently available in London only.

Keep the location and live-data state clear, without adding a notification, account, or saved-location flow. Live Mode requires an internet connection for current TfL disruption data.

## Install Guide page

Keep this page short and practical. Include separate installation steps for iPhone and Android, using the browser's available add-to-home-screen flow. The page explains how to install the PWA; it is not a new onboarding or account flow. The installed app shell may work offline, but Live Mode still requires internet access for current TfL disruption data.

## About StepFree page

Keep the page brief. Center the story on people who need step-free journeys: wheelchair users, elderly people, injured people, and parents with strollers. Emphasize independence, confidence, and practical social impact. Explain in a few sentences how StepFree reacts when accessibility infrastructure changes, and credit FalkorDB for graph routing and TfL for transit/accessibility data. Do not turn this page into a technical dashboard or add unrelated content.

## Motion and state treatment

- Animate the baseline route into view after it is found.
- Include subtle train movement as ambient map motion; keep it secondary to route clarity and never let it obscure labels, controls, or accessibility state.
- On outage, pulse the affected station, fade the old route, show the recalculation message, then animate the replacement route.
- Keep the map stable while route state changes so the user can follow the connection that failed and the path that replaced it.
- Use red only as one cue for the unavailable lift/pathway; pair it with the written outage label and lift icon.
- Keep transitions smooth and restrained. Do not add decorative motion that obscures station labels, route links, or controls.
