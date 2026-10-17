import type { DemoDisruptionInfo, DemoDisruptionKind } from '../api';
import { LiftGlyph } from './icons';

const KIND_LABEL: Record<DemoDisruptionKind, string> = {
  LIFT: 'Lift outage',
  STATION: 'Station closure',
  LINE: 'Line disruption',
};

/** "Green Park Lift 2 unavailable", "Green Park station closed", "Jubilee line unavailable". */
const describeDisruption = (d: Pick<DemoDisruptionInfo, 'label' | 'closed'>) => `${d.label} ${d.closed ? 'closed' : 'unavailable'}`;

/** The one obvious way into the demo for anyone, anywhere: no location, no real disruption needed. */
export function RunJudgeDemoButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="btn-primary" onClick={onClick} disabled={disabled} data-testid="run-judge-demo">
      Run Judge Demo
    </button>
  );
}

/**
 * Activate one of the three controlled Demo Mode events. This only says which event happened; whether it affects the
 * current journey is decided by the agent from the graph.
 */
export function SimulateDisruption({
  options,
  selected,
  onSelect,
  onSimulate,
  disabled,
}: {
  options: DemoDisruptionInfo[];
  selected: DemoDisruptionKind;
  onSelect: (kind: DemoDisruptionKind) => void;
  onSimulate: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-red-100 bg-white p-3" data-testid="simulate-disruption">
      <label className="block">
        <span className="field-label">
          Simulate disruption <span className="font-normal text-slate-500">· Demo Mode event, not a real TfL disruption</span>
        </span>
        <select className="field" value={selected} onChange={(e) => onSelect(e.target.value as DemoDisruptionKind)} disabled={disabled}>
          {options.map((o) => (
            <option key={o.kind} value={o.kind}>
              {KIND_LABEL[o.kind]} · {o.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn-outage" onClick={onSimulate} disabled={disabled}>
        <LiftGlyph unavailable className="h-5 w-5" />
        Simulate
      </button>
    </div>
  );
}

/** What was simulated, clearly labelled as a Demo Mode event and never as a real TfL disruption. */
export function SimulatedDisruptionBanner({ info, detail, compact = false }: { info: DemoDisruptionInfo; detail?: string; compact?: boolean }) {
  return (
    <div className={`flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 ${compact ? 'p-3' : 'p-4'}`} role="status" data-testid="simulated-disruption">
      <LiftGlyph unavailable className="mt-0.5 h-6 w-6 shrink-0 text-red-700" />
      <div>
        <p className="text-base font-semibold text-red-900">Simulated disruption: {describeDisruption(info)}</p>
        <p className="text-sm text-red-800">{detail ?? 'A Demo Mode event, not a real TfL disruption.'}</p>
      </div>
    </div>
  );
}
