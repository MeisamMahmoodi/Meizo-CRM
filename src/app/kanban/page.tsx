'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession, Lead, CustomStatus, getStatusOptions, loadSettingFromDB, DEAD_STATUSES, dateKey } from '@/lib/crm'

const COLUMNS = [
  { id: '',               label: 'Offen',              color: '#6b7280', bg: '#f3f4f6' },
  { id: 'NDG',            label: 'Nicht Durchgekommen', color: '#374151', bg: '#f3f4f6' },
  { id: 'AP NE',          label: 'AP Nicht Erreicht',   color: '#92400e', bg: '#fef3c7' },
  { id: 'Info per Email', label: 'Info per E-Mail',     color: '#5b21b6', bg: '#ede9fe' },
  { id: 'Nur Email',      label: 'Nur E-Mail',          color: '#1e40af', bg: '#dbeafe' },
  { id: 'Closing Termin', label: 'Closing Termin',      color: '#065f46', bg: '#d1fae5' },
  { id: 'KI',             label: 'Kein Interesse',      color: '#991b1b', bg: '#fee2e2' },
]

export default function KanbanPage() {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [customStatuses, setCustomStatuses] = useState<CustomStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const session = getSession()

  const fetchLeads = useCallback(async () => {
    try {
      const assignedParam = session && session.role !== 'admin' ? '?assignedTo=' + session.userId : ''
      const res = await fetch('/api/leads' + assignedParam)
      if (res.ok) setLeads(await res.json())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!getSession()) { router.replace('/'); return }
    loadSettingFromDB('custom_statuses').then(s => { if (s.length) setCustomStatuses(s) })
    fetchLeads()
    const iv = setInterval(fetchLeads, 10000)
    return () => clearInterval(iv)
  }, [router, fetchLeads])

  async function moveLeadToStatus(leadId: string, newStatus: string) {
    await fetch(`/api/leads/${leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    fetchLeads()
  }

  const today = dateKey()
  const allColumns = [
    ...COLUMNS,
    ...customStatuses.map(s => ({ id: s.value, label: s.label, color: s.color, bg: s.bg }))
  ]

  const filteredLeads = search
    ? leads.filter(l => l.name.toLowerCase().includes(search.toLowerCase()) || l.phone.includes(search))
    : leads

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Laden…</div>

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)' }}>← Dashboard</button>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Kanban</div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Suchen…"
          style={{ padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', fontSize: 13, width: 200, marginLeft: 'auto' }}
        />
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{leads.length} Leads</div>
      </div>

      {/* Board */}
      <div style={{ display: 'flex', gap: 12, padding: 20, overflowX: 'auto', minHeight: 'calc(100vh - 57px)', alignItems: 'flex-start' }}>
        {allColumns.map(col => {
          const colLeads = filteredLeads.filter(l => (l.status || '') === col.id)
          const isDragTarget = dragOver === col.id
          const wvCount = colLeads.filter(l => l.wiedervorlage && l.wiedervorlage <= today).length

          return (
            <div
              key={col.id}
              data-col-id={col.id}
              onDragOver={e => { e.preventDefault(); setDragOver(col.id) }}
              onDragLeave={() => setDragOver(null)}
              onDrop={async e => {
                e.preventDefault()
                setDragOver(null)
                const id = e.dataTransfer.getData('leadId')
                if (id) await moveLeadToStatus(id, col.id)
              }}
              style={{
                width: 240, flexShrink: 0, background: isDragTarget ? 'rgba(22,163,74,0.05)' : 'var(--bg)',
                border: `2px solid ${isDragTarget ? '#16a34a' : 'transparent'}`,
                borderRadius: 12, transition: 'all .15s', minHeight: 200
              }}
            >
              {/* Column Header */}
              <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{col.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '1px 7px' }}>{colLeads.length}</span>
                {wvCount > 0 && <span style={{ fontSize: 11, color: '#d97706', background: '#fef3c7', borderRadius: 99, padding: '1px 6px' }}>{wvCount}</span>}
              </div>

              {/* Cards */}
              <div style={{ padding: '0 8px 8px' }}>
                {colLeads.map(lead => {
                  const isWdv = !!(lead.wiedervorlage && lead.wiedervorlage <= today)
                  const isDraggingThis = dragging === lead.id

                  return (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={e => { e.dataTransfer.setData('leadId', lead.id); setDragging(lead.id) }}
                      onDragEnd={() => setDragging(null)}
                      onTouchStart={e => { (e.currentTarget as any)._touchLeadId = lead.id; setDragging(lead.id) }}
                      onTouchEnd={async e => {
                        setDragging(null)
                        const touch = e.changedTouches[0]
                        const el = document.elementFromPoint(touch.clientX, touch.clientY)
                        const col = el?.closest('[data-col-id]')
                        const targetColId = col?.getAttribute('data-col-id')
                        if (targetColId != null && targetColId !== lead.status) {
                          await moveLeadToStatus(lead.id, targetColId)
                        }
                      }}
                      style={{
                        background: 'var(--surface)', border: `1px solid ${isWdv ? '#fbbf24' : 'var(--border)'}`,
                        borderRadius: 10, padding: '10px 12px', marginBottom: 8, cursor: 'grab',
                        opacity: isDraggingThis ? 0.4 : 1, boxShadow: 'var(--shadow-sm)',
                        transition: 'opacity .15s', touchAction: 'none'
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: 'var(--text)' }}>{lead.name}</div>
                      {lead.owner && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{lead.owner}</div>}
                      {lead.phone && (
                        <a href={`tel:${lead.phone}`} style={{ fontSize: 12, color: '#378ADD', display: 'block', marginBottom: 4, textDecoration: 'none' }}>{lead.phone}</a>
                      )}
                      {lead.callNote && (
                        <div
                          onClick={e=>{
                            const existing = document.getElementById('note-popup')
                            if(existing){existing.remove();return}
                            const popup = document.createElement('div')
                            popup.id='note-popup'
                            popup.style.cssText='position:fixed;z-index:9999;background:#111110;border-radius:14px;padding:14px 18px;max-width:300px;font-size:13px;line-height:1.6;color:#f5f5f5;box-shadow:0 8px 32px rgba(0,0,0,0.22),0 2px 8px rgba(0,0,0,0.12);white-space:pre-wrap;word-break:break-word;pointer-events:auto'
                            popup.textContent=lead.callNote
                            const rect=(e.target as HTMLElement).getBoundingClientRect()
                            popup.style.top=(rect.bottom+8)+'px'
                            popup.style.left=Math.min(rect.left,window.innerWidth-340)+'px'
                            document.body.appendChild(popup)
                            const close=(ev:MouseEvent)=>{if(!popup.contains(ev.target as Node)){popup.remove();document.removeEventListener('click',close)}}
                            setTimeout(()=>document.addEventListener('click',close),0)
                            e.stopPropagation()
                          }}
                          style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg)', borderRadius: 6, padding: '4px 7px', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                          title={lead.callNote}
                        >
                          {lead.callNote}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                        {lead.callCount > 0 && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 99, padding: '1px 6px' }}>
                            📞 {lead.callCount}×
                          </span>
                        )}
                        {isWdv && (
                          <span style={{ fontSize: 10, color: '#92400e', background: '#fef3c7', borderRadius: 99, padding: '1px 6px' }}>
                            WDV fällig
                          </span>
                        )}
                        {lead.wiedervorlage && !isWdv && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg)', borderRadius: 99, padding: '1px 6px', border: '1px solid var(--border)' }}>
                            {lead.wiedervorlage}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {colLeads.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px 12px', fontSize: 12, color: 'var(--text-faint)', border: '2px dashed var(--border)', borderRadius: 8 }}>
                    Hierher ziehen
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
