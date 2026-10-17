import type { PlanB, Route, RouteHealth, WhyThisRoute } from '../api';
import { describeLeg } from './describe';
import { CheckGlyph } from './icons';

const HEALTH_LABEL: Record<RouteHealth['status'], string> = {
  CLEAR: 'Clear',
  AFFECTED: 'Affected',
  REROUTED: 'Rerouted',
  NO_ROUTE: 'No step-free route',
};

const HEALTH_STYLE: Record<RouteHealth['status'], string> = {
  CLEAR: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  AFFECTED: 'bg-amber-50 text-amber-900 ring-amber-200',
  REROUTED: 'bg-sky-50 text-sky-900 ring-sky-200',
  NO_ROUTE: 'bg-slate-100 text-slate-800 ring-slate-200',
};

/** Is this journey usable right now? A small status, computed by the backend from disruption evidence. */
export function RouteHealthStatus({ health }: { health: RouteHealth }) {
  return (
    <p className="flex items-center gap-2 text-sm text-slate-600" data-testid="route-health">
      <span>Route Health</span>
      <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ring-1 ${HEALTH_STYLE[health.status]}`}>{HEALTH_LABEL[health.status]}</span>
    </p>
  );
}

/** Plan B: a backup route FalkorDB found before anything broke. A preview only; it never replaces the current route. */
export function PlanBSection({ planB, name }: { planB: PlanB; name: (id: string) => string }) {
  if (!planB.available || !planB.route) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm" data-testid="plan-b">
        <p className="text-base font-semibold text-slate-700">Plan B</p>
        <p className="text-sm text-slate-600">No backup route currently available</p>
      </div>
    );
  }
  return (
    <details className="group rounded-2xl border border-slate-200 bg-white px-4 shadow-sm" data-testid="plan-b">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-1">
        <span>
          <span className="block text-base font-semibold text-slate-700">Plan B</span>
          <span className="block text-sm text-slate-600">
            Backup available · {planB.durationMinutes} min
            {planB.extraMinutes ? <span className="ml-1 font-semibold text-slate-700">+{planB.extraMinutes} min</span> : null}
          </span>
        </span>
        <span className="text-sm text-slate-500 group-open:hidden">Show</span>
        <span className="hidden text-sm text-slate-500 group-open:inline">Hide</span>
      </summary>
      <div className="space-y-2 pb-3 pt-1 text-base text-slate-700">
        <p>This route is ready if your current journey becomes unusable. It is not selected now.</p>
        <p>
          <span className="font-semibold">Via </span>
          {planB.stations.join(' → ')}
        </p>
        <p>
          <span className="font-semibold">Lines </span>
          {planB.lines.join(', then ')}
        </p>
        <p>
          <span className="font-semibold">About </span>
          {planB.durationMinutes} minutes
        </p>
        <BackupSteps route={planB.route} name={name} />
      </div>
    </details>
  );
}

function BackupSteps({ route, name }: { route: Route; name: (id: string) => string }) {
  return (
    <ol className="space-y-1 text-sm text-slate-600">
      {route.legs.map((leg, i) => (
        <li key={i}>{describeLeg(leg, name)}</li>
      ))}
    </ol>
  );
}

/** Why StepFree chose this route, in plain words. Built from the same structured evidence as the route; the technical trace is separate. */
export function WhyThisRouteSection({ why }: { why: WhyThisRoute }) {
  if (why.reasons.length === 0) return null;
  return (
    <details className="group rounded-2xl border border-slate-200 bg-white px-4 shadow-sm" data-testid="why-this-route">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-base font-semibold text-slate-700">
        Why this route?
        <span className="text-sm font-normal text-slate-500 group-open:hidden">Show</span>
        <span className="hidden text-sm font-normal text-slate-500 group-open:inline">Hide</span>
      </summary>
      <ul className="space-y-2 pb-3 pt-1" aria-label="Reasons StepFree chose this route">
        {why.reasons.map((reason) => (
          <li key={reason} className="flex items-start gap-2 text-base text-slate-700">
            <CheckGlyph className="mt-1 h-4 w-4 shrink-0 text-emerald-700" />
            <span>{reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
