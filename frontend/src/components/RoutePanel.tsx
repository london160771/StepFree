import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import type { LiftDisruption, Route, RouteHealth } from '../api';
import type { useStepFree } from '../useStepFree';
import { DecisionTrace } from './DecisionTrace';
import { RunJudgeDemoButton, SimulateDisruption, SimulatedDisruptionBanner } from './DemoControls';
import { PlanBSection, RouteHealthStatus, WhyThisRouteSection } from './JourneyInsights';
import { describeLeg, SAFETY_NOTE } from './describe';
import { CheckGlyph, InfoGlyph, LiftGlyph, LocationGlyph } from './icons';

type Store = ReturnType<typeof useStepFree>;

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.28 },
};

export function RoutePanel({ store }: { store: Store }) {
  const { network, mode, live } = store;
  if (!network) {
    return (
      <Card>
        <p className="text-base text-slate-600">{store.loadError ?? 'Loading the step-free network…'}</p>
      </Card>
    );
  }
  if (mode === 'live' && live.status !== 'ready') return <LiveEntry store={store} />;
  return <Planner store={store} />;
}

function Card({ children }: { children: ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}

function LiveEntry({ store }: { store: Store }) {
  const { live, allowLocation, setMode } = store;
  const backToDemo = (
    <button type="button" className="btn-secondary" onClick={() => setMode('demo')}>
      Use Demo Mode
    </button>
  );
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div key={live.status} {...fade} className="space-y-4">
        {(live.status === 'prompt' || live.status === 'locating') && (
          <>
            <div className="flex items-start gap-3">
              <LocationGlyph className="mt-0.5 h-6 w-6 shrink-0 text-teal-700" />
              <div>
                <p className="text-lg font-semibold text-slate-900">Use your location to find step-free routes around you.</p>
                <p className="mt-1 text-base text-slate-600">
                  StepFree places you on the map and starts from the nearest of its 17 supported stations. Live Mode uses
                  current TfL lift data, needs an internet connection and works in London only.
                </p>
              </div>
            </div>
            <button type="button" className="btn-primary" onClick={allowLocation} disabled={live.status === 'locating'}>
              {live.status === 'locating' ? 'Finding your location…' : 'Allow Location'}
            </button>
            {backToDemo}
          </>
        )}
        {live.status === 'denied' && (
          <Notice title="Live Mode needs your location">
            Location permission wasn’t given, so Live Mode hasn’t started. Demo Mode works without your location.
            <div className="mt-4">{backToDemo}</div>
          </Notice>
        )}
        {live.status === 'outside' && (
          <Notice title={live.message}>
            StepFree Live covers 17 Underground stations in London. You can still try the Demo.
            <div className="mt-4">{backToDemo}</div>
          </Notice>
        )}
        {live.status === 'error' && (
          <Notice title="Live Mode couldn’t start">
            {live.message}
            <div className="mt-4 grid gap-3">
              <button type="button" className="btn-primary" onClick={allowLocation}>
                Try again
              </button>
              {backToDemo}
            </div>
          </Notice>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-lg font-semibold text-slate-900">{title}</p>
      <div className="mt-1 text-base text-slate-600">{children}</div>
    </div>
  );
}

function Planner({ store }: { store: Store }) {
  const { network, mode, live, from, to, setFrom, setTo, phase, route, findRoute, runJudgeDemo } = store;
  const stations = network!.stations;
  const name = (id: string) => stations.find((s) => s.id === id)?.name ?? id;
  const busy = phase === 'finding' || phase === 'outage' || phase === 'recalculating';
  const nearest = live.status === 'ready' ? live.nearest : null;

  return (
    <div className="space-y-4">
      {mode === 'live' && live.status === 'ready' && <LiveStatusLine disruptions={live.disruptions} fetchedAt={live.fetchedAt} name={name} />}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">From</span>
          <select
            className="field"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={busy || mode === 'live'}
            aria-describedby={nearest ? 'from-hint' : undefined}
          >
            {stations.map((s) => (
              <option key={s.id} value={s.id} disabled={!s.stepFreeStreetAccess}>
                {s.name}
                {s.stepFreeStreetAccess ? '' : ' (not step-free)'}
              </option>
            ))}
          </select>
          {nearest && (
            <span id="from-hint" className="mt-1 block text-sm text-slate-500">
              Nearest to you
            </span>
          )}
        </label>
        <label className="block">
          <span className="field-label">To</span>
          <select className="field" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy}>
            {stations
              .filter((s) => s.id !== from)
              .map((s) => (
                <option key={s.id} value={s.id} disabled={!s.stepFreeStreetAccess}>
                  {s.name}
                  {s.stepFreeStreetAccess ? '' : ' (not step-free)'}
                </option>
              ))}
          </select>
        </label>
      </div>

      {(phase === 'idle' || phase === 'noroute' || phase === 'finding') && (
        <div className="space-y-3">
          {mode === 'demo' && <RunJudgeDemoButton onClick={runJudgeDemo} disabled={busy} />}
          <button type="button" className={mode === 'demo' ? 'btn-secondary' : 'btn-primary'} onClick={() => void findRoute()} disabled={busy || from === to}>
            {phase === 'finding' ? 'Finding a step-free route…' : 'Find Step-Free Route'}
          </button>
        </div>
      )}

      <div aria-live="polite">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={phase === 'route' || phase === 'rerouted' ? `result-${route?.stations.join('-')}` : phase} {...fade}>
            <PhaseContent store={store} name={name} />
          </motion.div>
        </AnimatePresence>
      </div>

      {store.error && <p className="rounded-xl bg-amber-50 p-3 text-base text-amber-900">{store.error}</p>}

      <p className="flex items-start gap-2 text-sm text-slate-500">
        <InfoGlyph className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{SAFETY_NOTE}</span>
      </p>
    </div>
  );
}

function PhaseContent({ store, name }: { store: Store; name: (id: string) => string }) {
  const { phase, route, fadingRoute, mode, network, unavailableLifts, simulateDisruption, resetDemo, noRouteReason, agentMessage, trace, agentRuntime, routeHealth, planB, why } = store;
  const { activeDisruption, selectedKind, setSelectedKind, agentStatus } = store;

  if (phase === 'outage' || phase === 'recalculating') {
    return (
      <div className="space-y-3">
        {activeDisruption && <SimulatedDisruptionBanner info={activeDisruption} detail="A Demo Mode event, not a real TfL disruption. Checking whether it affects your journey…" />}
        {phase === 'recalculating' && (
          <p className="flex items-center gap-3 text-base font-medium text-slate-700">
            <span className="calm-spinner" aria-hidden />
            Finding another step-free route…
          </p>
        )}
      </div>
    );
  }

  if (phase === 'noroute') {
    return (
      <Notice title="No step-free route right now">
        {noRouteReason ?? 'No step-free route is currently available in the supported network.'}
        {mode === 'demo' && activeDisruption && (
          <div className="mt-4">
            <button type="button" className="btn-secondary" onClick={resetDemo}>
              Reset demo
            </button>
          </div>
        )}
        {routeHealth && (
          <div className="mt-3">
            <RouteHealthStatus health={routeHealth} />
          </div>
        )}
        {trace.length > 0 && (
          <div className="mt-4">
            <DecisionTrace trace={trace} agent={agentRuntime} />
          </div>
        )}
      </Notice>
    );
  }

  if ((phase === 'route' || phase === 'rerouted') && route) {
    const unaffected = phase === 'rerouted' && agentStatus === 'ROUTE_RETAINED';
    return (
      <div className="space-y-4">
        {phase === 'rerouted' && activeDisruption && (
          <SimulatedDisruptionBanner
            compact
            info={activeDisruption}
            detail={unaffected ? 'This disruption does not affect your journey, so StepFree kept your route.' : (agentMessage ?? 'Here is another step-free route.')}
          />
        )}
        {mode === 'live' && unavailableLifts.length > 0 && <LiveDisruptions lifts={unavailableLifts} name={name} />}
        {phase === 'route' && agentMessage && <p className="text-base font-medium text-slate-800">{agentMessage}</p>}
        <RouteResult route={route} name={name} previousMinutes={phase === 'rerouted' ? fadingRoute?.totalMinutes : undefined} health={routeHealth} />
        {planB && <PlanBSection planB={planB} name={name} />}
        {why && <WhyThisRouteSection why={why} />}
        <DecisionTrace trace={trace} agent={agentRuntime} />
        {mode === 'demo' && phase === 'route' && network!.demoDisruptions.length > 0 && (
          <SimulateDisruption options={network!.demoDisruptions} selected={selectedKind} onSelect={setSelectedKind} onSimulate={() => void simulateDisruption(selectedKind)} />
        )}
        {mode === 'demo' && phase === 'rerouted' && (
          <button type="button" className="btn-secondary" onClick={resetDemo}>
            Reset demo
          </button>
        )}
      </div>
    );
  }
  return null;
}

function RouteResult({ route, name, previousMinutes, health }: { route: Route; name: (id: string) => string; previousMinutes?: number; health?: RouteHealth | null }) {
  const openSteps = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  const origin = name(route.stations[0]);
  const destination = name(route.stations.at(-1)!);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold leading-snug text-slate-900">
            {origin} → {destination}
          </p>
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200">
            <CheckGlyph className="h-4 w-4" />
            Step-free route
          </span>
          {health && (
            <div className="mt-2">
              <RouteHealthStatus health={health} />
            </div>
          )}
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold tabular-nums text-slate-900">
            {route.totalMinutes}
            <span className="ml-1 text-base font-semibold text-slate-500">min</span>
          </p>
          {previousMinutes !== undefined && previousMinutes !== route.totalMinutes && (
            <p className="text-sm text-slate-500">was {previousMinutes} min</p>
          )}
        </div>
      </div>
      <details className="group mt-3 border-t border-slate-100 pt-2" open={openSteps}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-base font-semibold text-slate-700">
          Journey steps
          <span className="text-sm text-slate-500 group-open:hidden">Show</span>
          <span className="hidden text-sm text-slate-500 group-open:inline">Hide</span>
        </summary>
      <ol className="mt-1 space-y-2">
        {route.legs.map((leg, i) => (
          <li key={i} className="flex items-start gap-3 text-base text-slate-700">
            {leg.type === 'transfer' ? (
              <LiftGlyph className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
            ) : (
              <span className={`mt-1.5 h-3 w-5 shrink-0 rounded-full line-${leg.line}`} aria-hidden />
            )}
            <span className="flex-1">{describeLeg(leg, name)}</span>
            <span className="tabular-nums text-slate-500">{leg.minutes} min</span>
          </li>
        ))}
      </ol>
      </details>
    </div>
  );
}

function LiveStatusLine({ disruptions, fetchedAt, name }: { disruptions: LiftDisruption[]; fetchedAt: string; name: (id: string) => string }) {
  const time = new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <p className="flex items-center gap-2 text-sm text-slate-600">
      <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
      Live TfL lift data, updated {time}.{' '}
      {disruptions.length === 0
        ? 'No lift disruptions reported at supported stations.'
        : `Lift disruptions at ${[...new Set(disruptions.map((d) => name(d.stationId)))].join(', ')}.`}
    </p>
  );
}

function LiveDisruptions({ lifts, name }: { lifts: LiftDisruption[]; name: (id: string) => string }) {
  return (
    <ul className="space-y-2">
      {lifts.map((lift) => (
        <li key={lift.liftUniqueId} className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-3">
          <LiftGlyph unavailable className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
          <div>
            <p className="text-base font-semibold text-red-900">Lift unavailable at {name(lift.stationId)}</p>
            <p className="text-sm text-red-800">{lift.message}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
