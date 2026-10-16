# StepFree Graph Hacks — design and interaction

## Design direction

Build a modern mobility app with a subtle SimCity feel. Keep the map clean and legible rather than playful or childish. The interface is phone-first; on desktop, give the same map more room so it reads like a larger transit view.

Use soft isometric building shapes as quiet context, simple roads/transit lines, clear station markers, and generous whitespace. The transit network and step-free route must remain the visual focus. Use large, readable text and large touch targets.

The visual language is:

- **Map:** a calm 3D map of real central London (MapLibre GL JS, OpenFreeMap/OpenStreetMap tiles, extruded buildings in stone and brick tones) with the seven-station network drawn on top at real coordinates. A schematic SVG map is the offline/no-WebGL fallback.
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

## Demo Mode flow

1. The user selects **Demo**.
2. The user chooses From and To, then taps **Find Step-Free Route**. The baseline example is Victoria to London Bridge via Green Park.
3. The route is drawn over the station graph. Keep the route and transfer links visually distinct.
4. Show a prominent **Simulate lift outage** action.
5. On activation, label the event **Lift unavailable at Green Park**. Pulse the affected station red and identify the affected lift/pathway with its lift icon.
6. Fade the old route and show **Finding another step-free route…**.
7. Draw the route returned by FalkorDB: use the District line from Victoria to Westminster, passing St James's Park without alighting, then the Jubilee line to London Bridge via Waterloo and Southwark.
8. Present the updated route and travel time as a calm success state.

The demo outage affects the specific verified Green Park step-free pathway/transfer. Do not color the whole station as inaccessible or imply that St James's Park needs step-free access for this journey.

## Live Mode flow

When the user selects **Live**, introduce the location request with:

> Use your location to find step-free routes around you.

Provide an **Allow Location** action. Request browser location only in this mode; Demo Mode works without permission. If permission is granted, use the browser location to place the animated user figure and map the user to the nearest supported station within the seven-station graph for routing. If permission is denied, Live Mode must not start and Demo Mode remains available. Use Live Mode with TfL lift disruption data and the seven-station graph. Do not present the MVP as supporting routes across all of London.

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
