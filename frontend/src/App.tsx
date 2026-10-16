import { motion, useReducedMotion } from 'framer-motion';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Mode } from './api';
import { RoutePanel } from './components/RoutePanel';
import { TransitMap } from './map/TransitMap';
import { Intro } from './components/Intro';
import { INTRO } from './map/timeline';
import { useMapFrame } from './map/useMapFrame';
import { About } from './pages/About';
import { InstallGuide } from './pages/InstallGuide';
import { useStepFree } from './useStepFree';

// MapLibre is loaded on demand so the app shell stays light; the schematic map is the offline fallback.
const LondonMap = lazy(() =>
  // If the map code itself can't load (offline before it was cached), fall back straight away.
  import('./map/LondonMap').catch(() => ({ default: MapUnavailable as typeof import('./map/LondonMap').default })),
);

function MapUnavailable({ onFail }: { onFail: () => void }) {
  useEffect(onFail, [onFail]);
  return <></>;
}

type Page = 'map' | 'install' | 'about';

function pageFromHash(): Page {
  if (window.location.hash === '#/install') return 'install';
  return window.location.hash === '#/about' ? 'about' : 'map';
}

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const reduceMotion = useReducedMotion() ?? false;
  // The intro plays once, on a first load of the map, and never with reduced motion.
  const [introEnabled] = useState(() => pageFromHash() === 'map' && !reduceMotion);
  const [stage, setStage] = useState<IntroStage>(introEnabled ? 'photo' : 'done');
  // The photo holds until the 3D city has loaded (within a limit), so it never dissolves into an empty map.
  const mapReady = useRef(false);
  const photoDone = useRef(false);
  const tryReveal = useCallback(() => {
    if (mapReady.current && photoDone.current) setStage((current) => (current === 'photo' ? 'reveal' : current));
  }, []);
  useEffect(() => {
    if (stage !== 'photo') return;
    const minimum = setTimeout(() => {
      photoDone.current = true;
      tryReveal();
    }, INTRO.photoMs);
    const limit = setTimeout(() => setStage('reveal'), INTRO.photoMs + INTRO.mapWaitMs);
    return () => {
      clearTimeout(minimum);
      clearTimeout(limit);
    };
  }, [stage, tryReveal]);
  useEffect(() => {
    if (stage !== 'reveal') return;
    const timer = setTimeout(() => setStage('done'), INTRO.overlayMs);
    return () => clearTimeout(timer);
  }, [stage]);
  const onMapReady = useCallback(() => {
    mapReady.current = true;
    tryReveal();
  }, [tryReveal]);
  const skipIntro = () => setStage((current) => (current === 'photo' ? 'reveal' : current));
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="relative h-dvh overflow-hidden bg-[var(--map-ground)] text-slate-900">
      <motion.header
        {...settleIn(introEnabled, stage, -8)}
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <a href="#/" className="pointer-events-auto rounded-full bg-white/90 px-3 py-1.5 text-lg font-bold tracking-tight shadow-sm backdrop-blur">
          Step<span className="text-teal-700">Free</span>
        </a>
        <nav aria-label="Pages" className="pointer-events-auto flex gap-1 rounded-full bg-white/90 p-1 shadow-sm backdrop-blur">
          <a href="#/" className={`nav-link ${page === 'map' ? 'nav-link-active' : ''}`} aria-current={page === 'map' ? 'page' : undefined}>
            Map
          </a>
          <a href="#/install" className={`nav-link ${page === 'install' ? 'nav-link-active' : ''}`} aria-current={page === 'install' ? 'page' : undefined}>
            Install
          </a>
          <a href="#/about" className={`nav-link ${page === 'about' ? 'nav-link-active' : ''}`} aria-current={page === 'about' ? 'page' : undefined}>
            About
          </a>
        </nav>
      </motion.header>
      {page === 'map' ? <MapHome introEnabled={introEnabled} stage={stage} onSkip={skipIntro} onMapReady={onMapReady} /> : page === 'install' ? <InstallGuide /> : <About />}
    </div>
  );
}

type IntroStage = 'photo' | 'reveal' | 'done';

/** Hidden (and not tappable) during the photo, then eased in once the map has started to build. */
function settleIn(introEnabled: boolean, stage: IntroStage, y: number) {
  if (!introEnabled) return {};
  const hidden = stage === 'photo';
  return {
    initial: { opacity: 0, y },
    animate: hidden ? { opacity: 0, y } : { opacity: 1, y: 0 },
    transition: { delay: hidden ? 0 : INTRO.controls, duration: 0.6, ease: 'easeOut' as const },
    style: { pointerEvents: hidden ? ('none' as const) : undefined },
  };
}

function MapHome({
  introEnabled,
  stage,
  onSkip,
  onMapReady,
}: {
  introEnabled: boolean;
  stage: IntroStage;
  onSkip: () => void;
  onMapReady: () => void;
}) {
  const store = useStepFree();
  const mapRef = useRef<HTMLDivElement>(null);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  // On phones the sheet covers up to ~46% of the screen; reserve that so the map never jumps as results change.
  const frame = useMapFrame(mapRef, { top: 112, left: isDesktop ? 440 : 0, bottom: isDesktop ? 24 : 0, bottomRatio: isDesktop ? 0 : 0.46 });
  const userPoint = store.mode === 'live' && store.live.status === 'ready' ? store.live.userPoint : null;
  const userLocation = store.mode === 'live' && store.live.status === 'ready' ? store.live.location : null;
  const [map3d, setMap3d] = useState(true);
  const size = useElementSize(mapRef);
  const entrance = !introEnabled ? 'none' : stage === 'photo' ? 'hidden' : 'reveal';
  const padding = isDesktop
    ? { top: 140, left: 600, right: 90, bottom: 150 }
    : { top: 160, left: 90, right: 40, bottom: Math.round(size.height * 0.46) + 30 };

  return (
    <main className="relative h-full">
      <div ref={mapRef} className="absolute inset-0">
        {store.network && map3d && (
          <Suspense fallback={null}>
            <LondonMap
              stations={store.network.stations}
              edges={store.network.edges}
              route={store.route}
              fadingRoute={store.fadingRoute}
              outageStationIds={store.outageStationIds}
              userLocation={userLocation}
              journeyKey={store.journeyKey}
              entrance={entrance}
              compact={!isDesktop}
              padding={padding}
              onFail={() => {
                setMap3d(false);
                onMapReady();
              }}
              onReady={onMapReady}
            />
          </Suspense>
        )}
        {store.network && !map3d && (
          <>
            {/* Offline or no WebGL: the schematic map, with the same routes and states. */}
            <motion.div
              className="absolute inset-0"
              style={{ transformOrigin: '62% 40%' }}
              initial={introEnabled ? { scale: 1.3, y: 28 } : false}
              animate={stage === 'photo' ? { scale: 1.3, y: 28 } : { scale: 1, y: 0 }}
              transition={{ duration: 2.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <TransitMap
                frame={frame}
                stations={store.network.stations}
                edges={store.network.edges}
                route={store.route}
                fadingRoute={store.fadingRoute}
                outageStationIds={store.outageStationIds}
                userPoint={userPoint}
                journeyKey={store.journeyKey}
                entrance={entrance}
              />
            </motion.div>
            <p className="pointer-events-none absolute bottom-3 right-3 z-10 hidden rounded bg-white/70 px-1.5 py-0.5 text-[10px] text-slate-600 lg:block">
              Map data © OpenStreetMap contributors
            </p>
          </>
        )}
        {/* Unmounted by a timer (not an exit animation), so it can never linger over the map. */}
        {introEnabled && stage !== 'done' && <Intro leaving={stage === 'reveal'} onSkip={onSkip} />}
        <motion.div
          {...settleIn(introEnabled, stage, -8)}
          className="absolute inset-x-0 top-[calc(max(env(safe-area-inset-top),0.75rem)+3.25rem)] z-10 flex justify-center lg:left-[440px]"
        >
          <ModeSwitch mode={store.mode} onChange={store.setMode} />
        </motion.div>
      </div>

      <motion.section
        aria-label="Plan a step-free route"
        {...(introEnabled ? settleIn(introEnabled, stage, 40) : { initial: { y: 40, opacity: 0 }, animate: { y: 0, opacity: 1 }, transition: { duration: 0.5, ease: 'easeOut' } })}
        className="absolute inset-x-0 bottom-0 z-10 max-h-[48dvh] overflow-y-auto rounded-t-3xl bg-white px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-3 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] lg:inset-x-auto lg:bottom-auto lg:left-6 lg:top-20 lg:max-h-[calc(100dvh-6.5rem)] lg:w-[400px] lg:rounded-3xl lg:pt-6 lg:shadow-xl"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 lg:hidden" aria-hidden />
        <RoutePanel store={store} />
        <p className="mt-3 text-xs text-slate-400 lg:hidden">
          {map3d ? (
            <>
              <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>{' '}
              <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> Data from{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
            </>
          ) : (
            'Map data © OpenStreetMap contributors'
          )}
        </p>
      </motion.section>
    </main>
  );
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div role="radiogroup" aria-label="Mode" className="relative flex rounded-full bg-white/95 p-1 shadow-md backdrop-blur">
      {(['demo', 'live'] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => onChange(value)}
          className="relative z-10 min-h-11 min-w-24 rounded-full px-5 text-base font-semibold transition-colors"
          style={{ color: mode === value ? '#ffffff' : '#334155' }}
        >
          {mode === value && (
            <motion.span layoutId="mode-pill" className="absolute inset-0 -z-10 rounded-full bg-slate-900" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
          )}
          {value === 'demo' ? 'Demo' : 'Live'}
        </button>
      ))}
    </div>
  );
}

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize((prev) => (prev.width === el.clientWidth && prev.height === el.clientHeight ? prev : { width: el.clientWidth, height: el.clientHeight }));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
