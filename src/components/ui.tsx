import type { Kind, RoadmapStage, Severity, Status } from '../lib/types'

const STATUS_STYLE: Record<Status, string> = {
  New: 'bg-blue-50 text-blue-700 ring-blue-200',
  Triaging: 'bg-violet-50 text-violet-700 ring-violet-200',
  'In progress': 'bg-amber-50 text-amber-800 ring-amber-200',
  'Ready to verify': 'bg-cyan-50 text-cyan-800 ring-cyan-200',
  Resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
}

const SEVERITY_STYLE: Record<Severity, string> = {
  Low: 'bg-slate-100 text-slate-700 ring-slate-200',
  Medium: 'bg-yellow-50 text-yellow-800 ring-yellow-200',
  High: 'bg-orange-50 text-orange-800 ring-orange-200',
  Blocker: 'bg-red-50 text-red-700 ring-red-200',
}

const KIND_STYLE: Record<Kind, string> = {
  Bug: 'bg-rose-50 text-rose-700 ring-rose-200',
  'UAT finding': 'bg-orange-50 text-orange-800 ring-orange-200',
  'Feature request': 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  Question: 'bg-teal-50 text-teal-700 ring-teal-200',
}

const STAGE_STYLE: Record<RoadmapStage, string> = {
  'Under review': 'bg-slate-100 text-slate-700 ring-slate-200',
  Planned: 'bg-violet-50 text-violet-700 ring-violet-200',
  'In progress': 'bg-amber-50 text-amber-800 ring-amber-200',
  Done: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
}

const pill = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap'

export const StatusBadge = ({ status }: { status: Status }) => <span className={`${pill} ${STATUS_STYLE[status]}`}>{status}</span>
export const SeverityChip = ({ severity }: { severity: Severity }) => <span className={`${pill} ${SEVERITY_STYLE[severity]}`}>{severity}</span>

export const KindChip = ({ kind }: { kind: Kind }) => <span className={`${pill} ${KIND_STYLE[kind]}`}>{kind}</span>
export const StageBadge = ({ stage }: { stage: RoadmapStage }) => <span className={`${pill} ${STAGE_STYLE[stage]}`}>{stage}</span>

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100'

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50'
export const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
