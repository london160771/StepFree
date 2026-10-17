import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { useEffect, useMemo } from 'react';
import type { GraphEdge, LineId, Route, Station } from '../api';
import {
  LIFT_OFFSET,
  LINE_COLORS,
  journeySeconds,
  labelAnchor,
  pointAt,
  routeDrawSeconds,
  routePoints,
  stationPoint,
  toPath,
  type Point,
} from './layout';
import { REVEAL } from './timeline';

export const ROUTE_COLOR = '#111827';
const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

export interface MapFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  frame: MapFrame;
  /** Schematic positions of the stations (offline fallback). */
  positions: Record<string, Point>;
  stations: Station[];
  edges: GraphEdge[];
  route: Route | null;
  /** Route being replaced; drawn fading out. */
  fadingRoute: Route | null;
  /** Stations where a lift/pathway is unavailable (pulse red). */
  outageStationIds: string[];
  /** Live Mode: where the user is, placed on the map. */
  userPoint: Point | null;
  /** Changing this replays the figure's journey along the route. */
  journeyKey: string;
  /**
   * Opening entrance: 'hidden' while the intro photo plays, 'reveal' to build the city and
   * network in, 'none' to show everything at once (no intro, or reduced motion).
   */
  entrance: 'none' | 'hidden' | 'reveal';
}

export function TransitMap({ frame, positions, stations, edges, route, fadingRoute, outageStationIds, userPoint, journeyKey, entrance }: Props) {
  const reduceMotion = useReducedMotion() ?? false;
  const staged = entrance !== 'none' && !reduceMotion;
  const shown = entrance === 'reveal';
  const lines = useMemo(() => lineSegments(edges, positions), [edges, positions]);
  const routeLifts = useMemo(() => liftStations(route), [route]);
  const points = route ? routePoints(route, positions) : null;
  const drawSeconds = points ? routeDrawSeconds(points) : 0;
  const journey = points && userPoint ? [userPoint, ...points] : points;
  const stepFree = new Map(stations.map((s) => [s.id, s.stepFreeStreetAccess]));
  const names = new Map(stations.map((s) => [s.id, s.name]));
  const stationOrder = Object.keys(positions);

  /** Entrance props for a layer: hidden during the intro, then shown at `delay` once the reveal starts. */
  const enter = (delay: number, from: Record<string, number> = {}, duration = 0.8) =>
    staged
      ? {
          initial: { opacity: 0, ...from },
          animate: shown ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, ...from },
          transition: { delay: shown ? delay : 0, duration, ease: EASE_OUT },
        }
      : { initial: false as const };
  const draw = (delay: number) =>
    staged
      ? {
          initial: { pathLength: 0, opacity: 0 },
          animate: shown ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 },
          transition: { delay, duration: 0.8, ease: EASE_IN_OUT, opacity: { delay, duration: 0.15 } },
        }
      : { initial: false as const };

  const viewBox = `${frame.x} ${frame.y} ${frame.w} ${frame.h}`;
  return (
    <div className="relative h-full w-full select-none">
      {/* London backdrop in its own SVG and compositing layer, so trains and route motion above never repaint it. */}
      <svg viewBox={viewBox} className="absolute inset-0 h-full w-full" aria-hidden style={{ willChange: 'transform' }}>
        <defs>
          <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eef1f4" stopOpacity="0.7" />
            <stop offset="30%" stopColor="#eef1f4" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="vignette" cx="50%" cy="45%" r="75%">
            <stop offset="58%" stopColor="#f3f1ec" stopOpacity="0" />
            <stop offset="100%" stopColor="#e9e6df" stopOpacity="0.9" />
          </radialGradient>
          <radialGradient id="cloud">
            <stop offset="0%" stopColor="#1e293b" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#1e293b" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="var(--map-ground)" />

        {/* Calm the city so the network stays the strongest layer. */}
        <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="var(--map-ground)" opacity={0} />
        <motion.g {...enter(REVEAL.network, {}, 0.8)}>
          {lines.map((segment) => (
            <line
              key={segment.key}
              x1={segment.a.x}
              y1={segment.a.y}
              x2={segment.b.x}
              y2={segment.b.y}
              stroke="#fbfaf7"
              strokeWidth={30}
              strokeLinecap="round"
              opacity={0.55}
            />
          ))}
          {stationOrder.map((id) => (
            <circle key={id} cx={positions[id].x} cy={positions[id].y} r={24} fill="#fbfaf7" opacity={0.5} />
          ))}
        </motion.g>
        {/* Slow cloud shadows drifting over the city. */}
        {!reduceMotion && entrance !== 'hidden' && (
          <g>
            <motion.ellipse
              cy={frame.y + frame.h * 0.3}
              rx={frame.w * 0.35}
              ry={frame.h * 0.18}
              fill="url(#cloud)"
              initial={{ cx: frame.x - frame.w * 0.2 }}
              animate={{ cx: frame.x + frame.w * 1.2 }}
              transition={{ duration: 70, ease: 'linear', repeat: Infinity }}
            />
            <motion.ellipse
              cy={frame.y + frame.h * 0.72}
              rx={frame.w * 0.28}
              ry={frame.h * 0.14}
              fill="url(#cloud)"
              initial={{ cx: frame.x + frame.w * 0.6 }}
              animate={{ cx: frame.x + frame.w * 1.3 }}
              transition={{ duration: 55, ease: 'linear', repeat: Infinity, repeatType: 'loop' }}
            />
          </g>
        )}
        {/* Atmospheric haze toward the top, and a soft vignette. */}
        <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="url(#haze)" pointerEvents="none" />
        <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="url(#vignette)" pointerEvents="none" />
      </svg>

      <svg
        viewBox={viewBox}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={
          route
            ? `Map of the supported network. Step-free route: ${route.stations.map((id) => names.get(id)).join(', ')}.`
            : 'Map of the 17 supported stations.'
        }
      >
        <defs>
          <filter id="soft-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" floodColor="#0f172a" floodOpacity="0.18" />
          </filter>
          {/* Lifts the network above the city for gentle depth. */}
          <filter id="network-lift" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="2.5" stdDeviation="2.2" floodColor="#0f172a" floodOpacity="0.18" />
          </filter>
        </defs>

        {/* Network from FalkorDB, drawn in on first load. */}
        <g aria-hidden filter="url(#network-lift)">
          {lines.map((segment, i) => (
            <motion.g key={segment.key} animate={{ opacity: route ? 0.5 : 1 }} transition={{ duration: 0.6 }}>
              <motion.line
                x1={segment.a.x}
                y1={segment.a.y}
                x2={segment.b.x}
                y2={segment.b.y}
                stroke="#ffffff"
                strokeWidth={10}
                strokeLinecap="round"
                {...draw(REVEAL.network + i * 0.08)}
              />
              <motion.line
                x1={segment.a.x}
                y1={segment.a.y}
                x2={segment.b.x}
                y2={segment.b.y}
                stroke={LINE_COLORS[segment.line]}
                strokeWidth={6}
                strokeLinecap="round"
                {...draw(REVEAL.network + i * 0.08)}
              />
            </motion.g>
          ))}
        </g>

        {!reduceMotion && entrance !== 'hidden' && <Trains lines={lines} dimmed={route !== null} startDelay={staged ? REVEAL.trains : 0} />}

        {/* Old route: fades to a quiet grey dashed trace so the change stays readable. */}
        <AnimatePresence>
          {fadingRoute && (
            <motion.path
              key={`fade-${fadingRoute.stations.join('-')}`}
              d={toPath(routePoints(fadingRoute, positions))}
              fill="none"
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="2 11"
              initial={{ opacity: 0.9, stroke: ROUTE_COLOR }}
              animate={{ opacity: 0.35, stroke: '#64748b' }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 1.2, ease: EASE_OUT }}
            />
          )}
        </AnimatePresence>

        {/* Current step-free route from FalkorDB */}
        <AnimatePresence>
          {points && (
            <motion.g key={`route-${journeyKey}`} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              <motion.path
                d={toPath(points)}
                fill="none"
                stroke="#ffffff"
                strokeWidth={15}
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#network-lift)"
                initial={{ pathLength: reduceMotion ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: reduceMotion ? 0 : drawSeconds, ease: EASE_IN_OUT }}
              />
              <motion.path
                d={toPath(points)}
                fill="none"
                stroke={ROUTE_COLOR}
                strokeWidth={8}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: reduceMotion ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: reduceMotion ? 0 : drawSeconds, ease: EASE_IN_OUT }}
              />
              {!reduceMotion && (
                // Slow flowing dashes show the direction of travel once the line is drawn.
                <motion.path
                  d={toPath(points)}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="1 13"
                  initial={{ opacity: 0, strokeDashoffset: 0 }}
                  animate={{ opacity: 0.75, strokeDashoffset: -28 }}
                  transition={{
                    opacity: { delay: drawSeconds, duration: 0.5 },
                    strokeDashoffset: { delay: drawSeconds, duration: 1.8, ease: 'linear', repeat: Infinity },
                  }}
                />
              )}
            </motion.g>
          )}
        </AnimatePresence>

        {/* Stations */}
        {stationOrder.map((id, i) => {
          const p = positions[id];
          const onRoute = route?.stations.includes(id) ?? false;
          const interchange = route?.legs.some((l) => l.type === 'transfer' && l.kind === 'interchange' && l.stationId === id);
          const isEnd = route ? id === route.stations[0] || id === route.stations.at(-1) : false;
          const accessible = stepFree.get(id) ?? true;
          const label = labelAnchor(id);
          return (
            <motion.g key={id} {...enter(REVEAL.stations + i * 0.06, { y: -6 }, 0.5)}>
              {outageStationIds.includes(id) && <OutagePulse at={p} reduceMotion={reduceMotion} />}
              <circle
                cx={p.x}
                cy={p.y}
                r={accessible ? (isEnd || interchange ? 11 : 9) : 6}
                fill="#ffffff"
                stroke={outageStationIds.includes(id) ? 'var(--danger)' : onRoute ? ROUTE_COLOR : '#334155'}
                strokeWidth={accessible ? 3.5 : 2.5}
                filter="url(#soft-shadow)"
              />
              {isEnd && <circle cx={p.x} cy={p.y} r={4.5} fill={ROUTE_COLOR} />}
              <text
                x={p.x + label.dx}
                y={p.y + label.dy}
                textAnchor={label.anchor}
                className="map-label"
                fontWeight={onRoute ? 700 : 600}
              >
                {names.get(id) ?? id}
              </text>
              {!accessible && (
                <text x={p.x + label.dx} y={p.y + label.dy + 13} textAnchor={label.anchor} className="map-sublabel">
                  not step-free · pass through
                </text>
              )}
            </motion.g>
          );
        })}

        {/* Lift icons appear once the route line has reached them; the unavailable lift shows at once. */}
        {[...routeLifts].filter((id) => !outageStationIds.includes(id)).map((id) => (
          <LiftIcon key={`${journeyKey}-${id}`} at={liftSpot(id, positions)} state="ok" delay={reduceMotion ? 0 : drawSeconds * 0.8} />
        ))}
        {outageStationIds.map((id) => (
          <LiftIcon key={`out-${id}`} at={liftSpot(id, positions)} state="unavailable" delay={0} />
        ))}

        {journey && (
          <JourneyFigure key={`figure-${journeyKey}`} points={journey} reduceMotion={reduceMotion} startDelay={drawSeconds + 0.3} />
        )}
        {!journey && userPoint && <JourneyFigure key="figure-user" points={[userPoint]} reduceMotion={reduceMotion} startDelay={0} />}
      </svg>
    </div>
  );
}

interface Segment {
  key: string;
  line: LineId;
  a: Point;
  b: Point;
}

function lineSegments(edges: GraphEdge[], positions: Record<string, Point>): Segment[] {
  const seen = new Map<string, Segment>();
  for (const edge of edges) {
    if (edge.type !== 'RIDE' || !edge.line) continue;
    const [a, b] = [edge.from.split(':')[0], edge.to.split(':')[0]].sort();
    const key = `${edge.line}:${a}-${b}`;
    if (!seen.has(key)) seen.set(key, { key, line: edge.line, a: stationPoint(positions, a), b: stationPoint(positions, b) });
  }
  return [...seen.values()];
}

function liftStations(route: Route | null): Set<string> {
  const ids = new Set<string>();
  for (const leg of route?.legs ?? []) if (leg.type === 'transfer' && leg.lifts.length > 0) ids.add(leg.stationId);
  return ids;
}

function liftSpot(stationId: string, positions: Record<string, Point>): Point {
  const p = stationPoint(positions, stationId);
  return { x: p.x + LIFT_OFFSET.x, y: p.y + LIFT_OFFSET.y };
}

function LiftIcon({ at, state, delay }: { at: Point; state: 'ok' | 'unavailable'; delay: number }) {
  const danger = state === 'unavailable';
  return (
    <motion.g initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4, ease: EASE_OUT }}>
      <title>{danger ? 'Lift unavailable' : 'Lift on this route'}</title>
      <rect
        x={at.x - 8}
        y={at.y - 8}
        width={16}
        height={16}
        rx={4}
        fill={danger ? 'var(--danger-soft)' : '#ffffff'}
        stroke={danger ? 'var(--danger)' : '#0f766e'}
        strokeWidth={1.8}
        filter="url(#soft-shadow)"
      />
      <path d={`M ${at.x - 3.5} ${at.y - 1} l 3.5 -4 l 3.5 4 Z`} fill={danger ? 'var(--danger)' : '#0f766e'} />
      <path d={`M ${at.x - 3.5} ${at.y + 1.5} l 3.5 4 l 3.5 -4 Z`} fill={danger ? 'var(--danger)' : '#0f766e'} />
      {danger && <line x1={at.x - 9} y1={at.y + 9} x2={at.x + 9} y2={at.y - 9} stroke="var(--danger)" strokeWidth={2.2} />}
    </motion.g>
  );
}

function OutagePulse({ at, reduceMotion }: { at: Point; reduceMotion: boolean }) {
  return (
    <>
      <circle cx={at.x} cy={at.y} r={16} fill="var(--danger-soft)" />
      {!reduceMotion && (
        <motion.circle
          cx={at.x}
          cy={at.y}
          fill="none"
          stroke="var(--danger)"
          strokeWidth={2.5}
          initial={{ r: 12, opacity: 0.8 }}
          animate={{ r: 30, opacity: 0 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
    </>
  );
}

function Trains({ lines, dimmed, startDelay }: { lines: Segment[]; dimmed: boolean; startDelay: number }) {
  const byLine = new Map<LineId, Point[]>();
  for (const seg of lines) {
    const pts = byLine.get(seg.line);
    if (!pts) byLine.set(seg.line, [seg.a, seg.b]);
    else if (pts.at(-1) === seg.a) pts.push(seg.b);
    else if (pts[0] === seg.b) pts.unshift(seg.a);
    else if (pts.at(-1) === seg.b) pts.push(seg.a);
    else if (pts[0] === seg.a) pts.unshift(seg.b);
  }
  return (
    // Trains step back while a route is shown so they never compete with it.
    <motion.g aria-hidden initial={{ opacity: 0 }} animate={{ opacity: dimmed ? 0.35 : 0.9 }} transition={{ delay: dimmed ? 0 : startDelay, duration: 0.8 }}>
      {[...byLine.entries()].map(([line, pts], i) => (
        <Train key={line} points={pts} color={LINE_COLORS[line]} duration={12 + pts.length * 3} delay={startDelay + i * 1.7} />
      ))}
    </motion.g>
  );
}

function Train({ points, color, duration, delay }: { points: Point[]; color: string; duration: number; delay: number }) {
  const t = useMotionValue(0);
  useEffect(() => {
    const controls = animate(t, 1, { duration, delay, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' });
    return () => controls.stop();
  }, [t, duration, delay]);
  const x = useTransform(t, (v) => pointAt(points, v).x);
  const y = useTransform(t, (v) => pointAt(points, v).y);
  const rotate = useTransform(t, (v) => {
    const a = pointAt(points, Math.max(0, v - 0.01));
    const b = pointAt(points, Math.min(1, v + 0.01));
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  });
  return (
    <motion.g style={{ x, y }}>
      <motion.rect x={-7} y={-3} width={14} height={6} rx={3} fill="#ffffff" stroke={color} strokeWidth={2} style={{ rotate }} />
    </motion.g>
  );
}

function JourneyFigure({ points, reduceMotion, startDelay }: { points: Point[]; reduceMotion: boolean; startDelay: number }) {
  const still = reduceMotion || points.length === 1;
  const t = useMotionValue(still ? 1 : 0);
  const duration = journeySeconds(points);
  useEffect(() => {
    if (still) return;
    const controls = animate(t, 1, { duration, delay: startDelay, ease: 'easeInOut' });
    return () => controls.stop();
  }, [t, duration, still, startDelay]);
  const x = useTransform(t, (v) => pointAt(points, v).x);
  const y = useTransform(t, (v) => pointAt(points, v).y - 20);
  return (
    <motion.g style={{ x, y }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: still ? 0 : startDelay * 0.6 }}>
      <title>Wheelchair user</title>
      <WheelchairUser />
    </motion.g>
  );
}

/** Simple wheelchair-user figure centred on (0, 0). */
function WheelchairUser() {
  return (
    <g>
      <circle r={13} fill="#ffffff" filter="url(#soft-shadow)" />
      <circle r={13} fill="none" stroke="#0f766e" strokeWidth={2} />
      <circle cx={-0.5} cy={-7.2} r={2.2} fill="#0f766e" />
      <path
        d="M -1.5 -4.2 L -1.5 1.6 L 4 1.6 L 6.2 6.2"
        fill="none"
        stroke="#0f766e"
        strokeWidth={2.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M -1.5 -1.6 L 3 -1.6" stroke="#0f766e" strokeWidth={1.8} strokeLinecap="round" />
      <circle cx={-1.8} cy={4.4} r={4.2} fill="none" stroke="#0f766e" strokeWidth={1.7} />
    </g>
  );
}
