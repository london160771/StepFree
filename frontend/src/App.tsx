import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { Mode } from './api';
import { RoutePanel } from './components/RoutePanel';
import { TransitMap } from './map/TransitMap';
import { Intro } from './components/Intro';
import { INTRO } from './map/timeline';
import { useMapFrame } from './map/useMapFrame';
import { About } from './pages/About';
import { InstallGuide } from './pages/InstallGuide';
import { useStepFree } from './useStepFree';

type Page = 'map' | 'install' | 'about';

function pageFromHash(): Page {
  if (window.location.hash === '#/install') return 'install';
  return window.location.hash === '#/about' ? 'about' : 'map';
}

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const reduceMotion = useReducedMotion() ?? false;
  // The intro plays once, on a first load of the map, and never with reduced motion.
  const [intro, setIntro] = useState(() => pageFromHash() === 'map' && !reduceMotion);
  useEffect(() => {
    if (!intro) return;
    const timer = setTimeout(() => setIntro(false), INTRO.settledMs);
    return () => clearTimeout(timer);
  }, [intro]);
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="relative h-dvh overflow-hidden bg-[var(--map-ground)] text-slate-900">
      <motion.header
        initial={intro ? { opacity: 0, y: -8 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: INTRO.controls, duration: 0.5 }}
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
      {page === 'map' ? <MapHome intro={intro} /> : page === 'install' ? <InstallGuide /> : <About />}
    </div>
  );
}

function MapHome({ intro }: { intro: boolean }) {
  const store = useStepFree();
  const [heroVisible, setHeroVisible] = useState(intro);
  useEffect(() => {
    if (!heroVisible) return;
    const timer = setTimeout(() => setHeroVisible(false), INTRO.heroMs);
    return () => clearTimeout(timer);
  }, [heroVisible]);
  const controlsIn = (y: number) =>
    intro ? { initial: { opacity: 0, y }, animate: { opacity: 1, y: 0 }, transition: { delay: INTRO.controls, duration: 0.5, ease: 'easeOut' as const } } : {};
  const mapRef = useRef<HTMLDivElement>(null);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  // On phones the sheet covers up to ~46% of the screen; reserve that so the map never jumps as results change.
  const frame = useMapFrame(mapRef, { top: 112, left: isDesktop ? 440 : 0, bottom: isDesktop ? 24 : 0, bottomRatio: isDesktop ? 0 : 0.46 });
  const userPoint = store.mode === 'live' && store.live.status === 'ready' ? store.live.userPoint : null;

  return (
    <main className="relative h-full">
      <div ref={mapRef} className="absolute inset-0">
        {/* Camera: a soft settle from slightly closer in, so the city feels like it comes alive. */}
        <motion.div
          className="absolute inset-0"
          initial={intro ? { scale: 1.08, y: 10 } : false}
          animate={{ scale: 1, y: 0 }}
          transition={{ duration: 2.1, ease: [0.22, 1, 0.36, 1] }}
        >
        {store.network && (
          <TransitMap
            frame={frame}
            stations={store.network.stations}
            edges={store.network.edges}
            route={store.route}
            fadingRoute={store.fadingRoute}
            outageStationIds={store.outageStationIds}
            userPoint={userPoint}
            journeyKey={store.journeyKey}
            intro={intro}
          />
        )}
        </motion.div>
        {/* Unmounted by a timer (not an exit animation), so it can never linger over the map. */}
        {intro && <Intro leaving={!heroVisible} />}
        <motion.div
          {...controlsIn(-8)}
          className="absolute inset-x-0 top-[calc(max(env(safe-area-inset-top),0.75rem)+3.25rem)] z-10 flex justify-center lg:left-[440px]"
        >
          <ModeSwitch mode={store.mode} onChange={store.setMode} />
        </motion.div>
      </div>

      <motion.section
        aria-label="Plan a step-free route"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut', delay: intro ? INTRO.controls : 0 }}
        className="absolute inset-x-0 bottom-0 z-10 max-h-[48dvh] overflow-y-auto rounded-t-3xl bg-white px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-3 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] lg:inset-x-auto lg:bottom-auto lg:left-6 lg:top-20 lg:max-h-[calc(100dvh-6.5rem)] lg:w-[400px] lg:rounded-3xl lg:pt-6 lg:shadow-xl"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 lg:hidden" aria-hidden />
        <RoutePanel store={store} />
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
