import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { useEffect, useMemo } from 'react';
import type { GraphEdge, LineId, Route, Station } from '../api';
import { PARKS, RIVER_POINTS, cityBlocks, isoFaces } from './city';
import {
  LABEL_ANCHORS,
  LIFT_OFFSETS,
  LINE_COLORS,
  STATION_POSITIONS,
  pointAt,
  routePoints,
  stationPoint,
  toPath,
  type Point,
} from './layout';

export const ROUTE_COLOR = '#111827';

export interface MapFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  frame: MapFrame;
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
}

export function TransitMap({ frame, stations, edges, route, fadingRoute, outageStationIds, userPoint, journeyKey }: Props) {
  const reduceMotion = useReducedMotion() ?? false;
  const blocks = useMemo(() => cityBlocks(edges, frame), [edges, frame]);
  const lines = useMemo(() => lineSegments(edges), [edges]);
  const routeLifts = useMemo(() => liftStations(route), [route]);
  const points = route ? routePoints(route) : null;
  const journey = points && userPoint ? [userPoint, ...points] : points;
  const stepFree = new Map(stations.map((s) => [s.id, s.stepFreeStreetAccess]));
  const names = new Map(stations.map((s) => [s.id, s.name]));

  return (
    <svg
      viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
      className="h-full w-full select-none"
      role="img"
      aria-label={
        route
          ? `Map of the supported network. Step-free route: ${route.stations.map((id) => names.get(id)).join(', ')}.`
          : 'Map of the seven supported stations.'
      }
    >
      <defs>
        <filter id="soft-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" floodColor="#0f172a" floodOpacity="0.18" />
        </filter>
      </defs>

      <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="var(--map-ground)" />

      {/* City context */}
      <polyline
        points={RIVER_POINTS.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke="var(--map-water)"
        strokeWidth={30}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {PARKS.map((p) => (
        <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} fill="var(--map-park)" />
      ))}
      <g aria-hidden>
        {blocks.map((block, i) => {
          const faces = isoFaces(block);
          const shade = block.tone > 0.66 ? 'b' : block.tone > 0.33 ? 'a' : 'c';
          return (
            <g key={i}>
              <polygon points={faces.left} fill={`var(--block-${shade}-left)`} />
              <polygon points={faces.right} fill={`var(--block-${shade}-right)`} />
              <polygon points={faces.top} fill={`var(--block-${shade}-top)`} />
            </g>
          );
        })}
      </g>

      {/* Network from FalkorDB */}
      <g aria-hidden>
        {lines.map((segment) => (
          <line
            key={segment.key}
            x1={segment.a.x}
            y1={segment.a.y}
            x2={segment.b.x}
            y2={segment.b.y}
            stroke={LINE_COLORS[segment.line]}
            strokeWidth={6}
            strokeLinecap="round"
            opacity={route ? 0.55 : 0.9}
          />
        ))}
      </g>

      {!reduceMotion && <Trains lines={lines} />}

      {/* Old route fading out */}
      <AnimatePresence>
        {fadingRoute && (
          <motion.path
            key={`fade-${fadingRoute.stations.join('-')}`}
            d={toPath(routePoints(fadingRoute))}
            fill="none"
            stroke={ROUTE_COLOR}
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2 12"
            initial={{ opacity: 0.85 }}
            animate={{ opacity: 0.22 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }}
          />
        )}
      </AnimatePresence>

      {/* Current step-free route */}
      <AnimatePresence mode="wait">
        {points && (
          <motion.g key={`route-${journeyKey}`} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
            <motion.path
              d={toPath(points)}
              fill="none"
              stroke="#ffffff"
              strokeWidth={15}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: reduceMotion ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: reduceMotion ? 0 : 1.1, ease: 'easeInOut' }}
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
              transition={{ duration: reduceMotion ? 0 : 1.1, ease: 'easeInOut' }}
            />
          </motion.g>
        )}
      </AnimatePresence>

      {/* Stations */}
      {Object.entries(STATION_POSITIONS).map(([id, p]) => {
        const onRoute = route?.stations.includes(id) ?? false;
        const interchange = route?.legs.some((l) => l.type === 'transfer' && l.kind === 'interchange' && l.stationId === id);
        const isEnd = route ? id === route.stations[0] || id === route.stations.at(-1) : false;
        const accessible = stepFree.get(id) ?? true;
        const label = LABEL_ANCHORS[id];
        return (
          <g key={id}>
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
          </g>
        );
      })}

      {/* Lift icons on the route, and the unavailable lift */}
      {[...routeLifts].filter((id) => !outageStationIds.includes(id)).map((id) => (
        <LiftIcon key={id} at={liftSpot(id)} state="ok" />
      ))}
      {outageStationIds.map((id) => (
        <LiftIcon key={`out-${id}`} at={liftSpot(id)} state="unavailable" />
      ))}

      {journey && (
        <JourneyFigure key={`figure-${journeyKey}`} points={journey} reduceMotion={reduceMotion} />
      )}
      {!journey && userPoint && <JourneyFigure key="figure-user" points={[userPoint]} reduceMotion={reduceMotion} />}
    </svg>
  );
}

interface Segment {
  key: string;
  line: LineId;
  a: Point;
  b: Point;
}

function lineSegments(edges: GraphEdge[]): Segment[] {
  const seen = new Map<string, Segment>();
  for (const edge of edges) {
    if (edge.type !== 'RIDE' || !edge.line) continue;
    const [a, b] = [edge.from.split(':')[0], edge.to.split(':')[0]].sort();
    const key = `${edge.line}:${a}-${b}`;
    if (!seen.has(key)) seen.set(key, { key, line: edge.line, a: stationPoint(a), b: stationPoint(b) });
  }
  return [...seen.values()];
}

function liftStations(route: Route | null): Set<string> {
  const ids = new Set<string>();
  for (const leg of route?.legs ?? []) if (leg.type === 'transfer' && leg.lifts.length > 0) ids.add(leg.stationId);
  return ids;
}

function liftSpot(stationId: string): Point {
  const p = stationPoint(stationId);
  const offset = LIFT_OFFSETS[stationId];
  return { x: p.x + offset.x, y: p.y + offset.y };
}

function LiftIcon({ at, state }: { at: Point; state: 'ok' | 'unavailable' }) {
  const danger = state === 'unavailable';
  return (
    <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
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
          r={14}
          fill="none"
          stroke="var(--danger)"
          strokeWidth={3}
          initial={{ scale: 0.8, opacity: 0.9 }}
          animate={{ scale: 2.2, opacity: 0 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
          style={{ transformOrigin: `${at.x}px ${at.y}px`, transformBox: 'view-box' }}
        />
      )}
    </>
  );
}

function Trains({ lines }: { lines: Segment[] }) {
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
    <g aria-hidden>
      {[...byLine.entries()].map(([line, pts], i) => (
        <Train key={line} points={pts} color={LINE_COLORS[line]} duration={10 + pts.length * 3} delay={i * 1.7} />
      ))}
    </g>
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

function JourneyFigure({ points, reduceMotion }: { points: Point[]; reduceMotion: boolean }) {
  const t = useMotionValue(reduceMotion || points.length === 1 ? 1 : 0);
  useEffect(() => {
    if (reduceMotion || points.length === 1) return;
    const controls = animate(t, 1, { duration: 2.2 + points.length * 0.6, delay: 1.1, ease: 'easeInOut' });
    return () => controls.stop();
  }, [t, points.length, reduceMotion]);
  const x = useTransform(t, (v) => pointAt(points, v).x);
  const y = useTransform(t, (v) => pointAt(points, v).y - 20);
  return (
    <motion.g style={{ x, y }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
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
