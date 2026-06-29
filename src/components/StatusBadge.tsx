import { CustomStatus, LeadStatus, getStatusMeta } from '@/lib/crm'

export function StatusBadge({ status, customStatuses = [] }: { status: LeadStatus; customStatuses?: CustomStatus[] }) {
  if (!status) return <span style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--accent-subtle)', padding: '3px 10px', borderRadius: 100, fontWeight: 500 }}>Offen</span>
  const m = getStatusMeta(status, customStatuses)
  if (!m) return <span>{status}</span>
  return (
    <span style={{
      fontSize: 12, fontWeight: 500,
      color: m.color, background: m.bg,
      padding: '3px 10px', borderRadius: 100,
      whiteSpace: 'nowrap',
    }}>
      {m.label}
    </span>
  )
}
