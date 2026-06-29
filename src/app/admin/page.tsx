'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate, dateKey } from '@/lib/crm'

interface User { id: string; username: string; role: string; created_at: string }
interface ActivityLog { id: string; username: string; action: string; lead_name: string; detail: string; created_at: string }
interface Lead { id: string; name: string; phone: string; website: string; owner: string; status: string; calledAt: string; assignedTo: string; callCount: number; listId: string }
interface CrmList { id: string; name: string; imported_by: string; total_leads: number; duplicates_skipped: number; created_at: string }

type Tab = 'overview' | 'performance' | 'users' | 'leads' | 'lists' | 'activity'

const ALL_STATUSES = ['KI', 'NDG', 'AP NE', 'Nur Email', 'Info per Email', 'Closing Termin']
const STATUS_LABELS: Record<string, string> = {
  'KI': 'Kein Interesse', 'NDG': 'Nicht Durchgekommen', 'AP NE': 'AP Nicht Erreicht',
  'Nur Email': 'Nur E-Mail', 'Info per Email': 'Info per E-Mail', 'Closing Termin': 'Closing Termin'
}

export default function AdminPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [users, setUsers] = useState<User[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [lists, setLists] = useState<CrmList[]>([])
  const [activity, setActivity] = useState<ActivityLog[]>([])
  const [todayStats, setTodayStats] = useState<{ username: string; call_count: number }[]>([])
  const [performance, setPerformance] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<{ userId: string; username: string; role: string } | null>(null)

  // User form
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('setter')
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  // Lead management
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set())
  const [assignTo, setAssignTo] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterList, setFilterList] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [importListName, setImportListName] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const fetchAll = useCallback(async () => {
    const [usersRes, leadsRes, actRes, statsRes, listsRes] = await Promise.all([
      fetch('/api/users'),
      fetch('/api/leads'),
      fetch('/api/activity'),
      fetch('/api/activity?stats=1'),
      fetch('/api/lists'),
    ])
    if (usersRes.ok) setUsers(await usersRes.json())
    if (leadsRes.ok) setLeads(await leadsRes.json())
    if (actRes.ok) setActivity(await actRes.json())
    if (statsRes.ok) setTodayStats(await statsRes.json())
    if (listsRes.ok) setLists(await listsRes.json())
    setLoading(false)
  }, [])

  const fetchPerformance = useCallback(async () => {
    const res = await fetch('/api/activity?performance=1')
    if (res.ok) setPerformance(await res.json())
  }, [])

  useEffect(() => {
    const s = sessionStorage.getItem('meizo_session')
    if (!s) { router.replace('/'); return }
    const parsed = JSON.parse(s)
    if (parsed.role !== 'admin') { router.replace('/dashboard'); return }
    setSession(parsed)
    fetchAll()
    fetchPerformance()
    const iv = setInterval(fetchAll, 10000)
    const perfIv = setInterval(fetchPerformance, 30000)
    return () => { clearInterval(iv); clearInterval(perfIv) }
  }, [router, fetchAll, fetchPerformance])

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    setFormError(''); setFormSuccess('')
    if (!newUsername || !newPassword) { setFormError('Alle Felder ausfüllen'); return }
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
    })
    const data = await res.json()
    if (!res.ok) { setFormError(data.error); return }
    setFormSuccess(`✓ ${newUsername} erstellt`)
    setNewUsername(''); setNewPassword('')
    fetchAll()
  }

  async function deleteUser(id: string, username: string) {
    if (!confirm(`${username} wirklich löschen?`)) return
    await fetch('/api/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    fetchAll()
  }

  async function assignLeads() {
    if (!assignTo || selectedLeads.size === 0) return
    for (const leadId of Array.from(selectedLeads)) {
      await fetch(`/api/leads/${leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo: assignTo }),
      })
    }
    setSelectedLeads(new Set())
    fetchAll()
  }

  async function deleteListHandler(id: string, name: string) {
    if (!confirm(`Liste "${name}" und alle zugehörigen Leads löschen?`)) return
    await fetch('/api/lists', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    fetchAll()
  }

  function exportLeadsCSV() {
    const headers = ['Name', 'Telefon', 'Website', 'Inhaber', 'Status', 'Angerufen am', 'Calls', 'Setter', 'Liste']
    const rows = filteredLeads.map(l => {
      const setter = users.find(u => u.id === l.assignedTo)?.username || ''
      const liste = lists.find(li => li.id === l.listId)?.name || ''
      return [l.name, l.phone || '', l.website || '', l.owner || '', l.status, l.calledAt ? new Date(l.calledAt).toLocaleDateString('de-DE') : '', String(l.callCount || 0), setter, liste]
        .map(v => `"${(v ?? '').replace(/"/g, '""')}"`)
        .join(',')
    })
    const blob = new Blob(['\uFEFF' + [headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `meizo-leads-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  async function handleImportCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const text = await file.text()
    const lines = text.replace(/^\uFEFF/, '').trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) { setImportStatus('CSV leer oder ungültig'); return }
    const sep = lines[0].includes(';') ? ';' : ','
    const header = lines[0].split(sep).map(h => h.replace(/["']/g, '').toLowerCase().trim())
    const col = (keys: string[]) => header.findIndex(h => keys.some(k => h.includes(k)))
    const iName = col(['name', 'firma', 'company']); const iPhone = col(['tel', 'phone', 'nummer', 'mobil'])
    const iWeb = col(['web', 'site', 'url']); const iOwner = col(['inhaber', 'owner', 'ansprechpartner'])
    const now = new Date().toISOString().slice(0, 10)
    const newLeads = lines.slice(1).map((line) => {
      const cols = line.split(sep).map(c => c.replace(/^["']/, '').replace(/["'\r]$/, '').trim())
      return { name: iName >= 0 ? cols[iName] : cols[0] || '', phone: iPhone >= 0 ? cols[iPhone] : '', website: iWeb >= 0 ? cols[iWeb] : '', owner: iOwner >= 0 ? cols[iOwner] : '', status: '', callNote: '', wiedervorlage: '', calledAt: '', createdAt: now, assignedTo: '', extra: {} }
    }).filter(l => l.name.trim())

    const listName = importListName.trim() || file.name.replace('.csv', '') || `Import ${now}`
    setImportStatus('Importiere…')

    try {
      const res = await fetch(`/api/leads?listName=${encodeURIComponent(listName)}&importedBy=${session?.username || ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLeads)
      })
      const data = await res.json()
      setImportStatus(`✓ ${data.inserted} Leads importiert, ${data.skipped} Duplikate übersprungen`)
      setImportListName('')
      fetchAll()
      setTimeout(() => setImportStatus(''), 6000)
    } catch { setImportStatus('Fehler beim Import') }
    e.target.value = ''
  }

  const today = dateKey()
  const totalCallsToday = todayStats.reduce((s, r) => s + Number(r.call_count), 0)
  const closingCount = leads.filter(l => l.status === 'Closing Termin').length
  const unassigned = leads.filter(l => !l.assignedTo).length

  const filteredLeads = leads.filter(l => {
    if (filterUser === '__unassigned__' && l.assignedTo) return false
    if (filterUser && filterUser !== '__unassigned__' && l.assignedTo !== filterUser) return false
    if (filterStatus && l.status !== filterStatus) return false
    if (filterList && l.listId !== filterList) return false
    return true
  })

  // Status-Verteilung
  const statusCounts = leads.reduce<Record<string, number>>((acc, l) => {
    const s = l.status || 'Offen'
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})

  function logout() { sessionStorage.removeItem('meizo_session'); document.cookie = 'meizo_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'; router.replace('/') }

  // Performance helpers
  const perfCallsPerUser: any[] = performance?.callsPerUser || []
  const perfCallsPerHour: any[] = performance?.callsPerHour || []
  const perfConversion: any[] = performance?.conversionPerUser || []
  const perfPause: any[] = performance?.pauseStats || []

  // Heute stats per user
  const todayPerUser = perfCallsPerUser.filter(r => r.call_date?.slice(0, 10) === today)

  // Durchschnittliche Pause pro User heute
  const pauseByUser: Record<string, number[]> = {}
  perfPause.forEach((r: any) => {
    if (!r.prev_call_at) return
    const diff = (new Date(r.called_at).getTime() - new Date(r.prev_call_at).getTime()) / 1000 / 60
    if (diff > 0 && diff < 120) {
      if (!pauseByUser[r.username]) pauseByUser[r.username] = []
      pauseByUser[r.username].push(diff)
    }
  })

  // Heatmap: Stunden 7–20 pro User
  const heatmapUsers = Array.from(new Set(perfCallsPerHour.map((r: any) => r.username as string)))
  const heatmapHours = Array.from({ length: 14 }, (_, i) => i + 7)

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>Laden…</div>

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Sidebar */}
      <div style={{
        width: sidebarOpen ? 220 : 56, flexShrink: 0, background: 'var(--surface)',
        borderRight: '1px solid var(--border)', transition: 'width .2s',
        display: 'flex', flexDirection: 'column', overflow: 'hidden'
      }}>
        <div style={{ padding: '16px 12px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => setSidebarOpen(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0, padding: 4, display: 'flex', alignItems: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          {sidebarOpen && <span style={{ fontWeight: 700, fontSize: 15, color: '#16a34a', whiteSpace: 'nowrap' }}>Meizo Admin</span>}
        </div>

        {([
          { id: 'overview', label: 'Übersicht', svg: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> },
          { id: 'performance', label: 'Performance', svg: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
          { id: 'leads', label: 'Leads', svg: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
          { id: 'lists', label: 'Listen', svg: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
          { id: 'users', label: 'Benutzer', svg: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
          { id: 'activity', label: 'Aktivität', svg: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> },
        ] as { id: Tab; label: string; svg: React.ReactNode }[]).map(item => (
          <button key={item.id} onClick={() => setTab(item.id)} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
            background: tab === item.id ? 'rgba(22,163,74,0.08)' : 'none',
            border: 'none', borderLeft: tab === item.id ? '3px solid #16a34a' : '3px solid transparent',
            color: tab === item.id ? '#16a34a' : 'var(--text-secondary)',
            fontSize: 14, fontWeight: tab === item.id ? 600 : 400,
            cursor: 'pointer', textAlign: 'left', width: '100%', whiteSpace: 'nowrap'
          }}>
            <span style={{ flexShrink: 0, display: 'flex' }}>{item.svg}</span>
            {sidebarOpen && item.label}
          </button>
        ))}

        <div style={{ marginTop: 'auto', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          {sidebarOpen && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{session?.username}</div>}
          <button onClick={logout} style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', width: sidebarOpen ? '100%' : 'auto' }}>
            {sidebarOpen ? 'Logout' : '↩'}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div>
            <h2 style={h2Style}>Übersicht</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
              {[
                { label: 'Calls heute gesamt', value: totalCallsToday, color: '#16a34a' },
                { label: 'Closing Termine', value: closingCount, color: '#d97706' },
                { label: 'Aktive Setter', value: users.filter(u => u.role !== 'admin').length, color: '#378ADD' },
                { label: 'Unzugewiesene Leads', value: unassigned, color: unassigned > 0 ? '#dc2626' : 'var(--text)' },
              ].map(s => (
                <div key={s.label} style={card}>
                  <div style={lblStyle}>{s.label}</div>
                  <div style={{ fontSize: 36, fontWeight: 500, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Status-Verteilung */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div style={card}>
                <div style={{ ...lblStyle, marginBottom: 16 }}>Status-Verteilung</div>
                {Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                  <div key={status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 13 }}>{STATUS_LABELS[status] || status || 'Offen'}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 80, height: 6, background: 'var(--bg)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: '#16a34a', borderRadius: 99, width: `${(count / leads.length) * 100}%` }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 28, textAlign: 'right' }}>{count}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div style={card}>
                <div style={{ ...lblStyle, marginBottom: 16 }}>🏆 Leaderboard — Heute</div>
                {todayStats.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Noch keine Calls heute.</div>
                ) : todayStats.map((s, i) => (
                  <div key={s.username} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: i === 0 ? '#fbbf24' : i === 1 ? '#9ca3af' : '#cd7c2f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{s.username}</div>
                      <div style={{ background: 'var(--bg)', borderRadius: 99, height: 6, marginTop: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: '#16a34a', borderRadius: 99, width: `${Math.min((Number(s.call_count) / Math.max(...todayStats.map(x => Number(x.call_count)))) * 100, 100)}%` }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>{s.call_count}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── PERFORMANCE ── */}
        {tab === 'performance' && (
          <div>
            <h2 style={h2Style}>Performance</h2>

            {/* Heute pro Setter */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 24 }}>
              {users.filter(u => u.role !== 'admin').map(u => {
                const uToday = todayPerUser.find(r => r.user_id === u.id)
                const pauses = pauseByUser[u.username] || []
                const avgPause = pauses.length ? Math.round(pauses.reduce((a, b) => a + b, 0) / pauses.length) : null
                const uConv = perfConversion.filter((r: any) => r.user_id === u.id)
                const totalCalls = uConv.reduce((s: number, r: any) => s + Number(r.count), 0)
                const closings = uConv.find((r: any) => r.status === 'Closing Termin')?.count || 0

                return (
                  <div key={u.id} style={card}>
                    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{u.username} <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>({u.role})</span></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                      <div style={miniStat}>
                        <div style={lblStyle}>Heute</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: '#16a34a' }}>{uToday?.call_count || 0}</div>
                      </div>
                      <div style={miniStat}>
                        <div style={lblStyle}>Ø Pause</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: avgPause && avgPause > 10 ? '#dc2626' : '#16a34a' }}>
                          {avgPause ? `${avgPause}m` : '—'}
                        </div>
                      </div>
                      <div style={miniStat}>
                        <div style={lblStyle}>Erster Call</div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                          {uToday?.first_call ? new Date(uToday.first_call).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </div>
                      </div>
                      <div style={miniStat}>
                        <div style={lblStyle}>Letzter Call</div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                          {uToday?.last_call ? new Date(uToday.last_call).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)', paddingTop: 10 }}>
                      Gesamt: {totalCalls} Calls · {closings} Closings · {totalCalls > 0 ? ((closings / totalCalls) * 100).toFixed(1) : 0}% CR
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Heatmap */}
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ ...lblStyle, marginBottom: 16 }}>📊 Calls pro Stunde (letzte 30 Tage)</div>
              {heatmapUsers.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Noch keine Daten.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
                    <thead>
                      <tr>
                        <th style={{ ...th, width: 80 }}>Setter</th>
                        {heatmapHours.map(h => <th key={h} style={{ ...th, textAlign: 'center', width: 40 }}>{h}h</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {heatmapUsers.map(username => {
                        const maxCalls = Math.max(...heatmapHours.map(h => {
                          const row = perfCallsPerHour.find((r: any) => r.username === username && Number(r.hour) === h)
                          return Number(row?.call_count || 0)
                        }), 1)
                        return (
                          <tr key={username as string}>
                            <td style={{ ...td, fontWeight: 600 }}>{username as string}</td>
                            {heatmapHours.map(h => {
                              const row = perfCallsPerHour.find((r: any) => r.username === username && Number(r.hour) === h)
                              const count = Number(row?.call_count || 0)
                              const intensity = count / maxCalls
                              return (
                                <td key={h} style={{ ...td, textAlign: 'center', padding: '6px 4px' }}>
                                  <div style={{
                                    width: 32, height: 32, borderRadius: 6, margin: '0 auto',
                                    background: count > 0 ? `rgba(22,163,74,${0.15 + intensity * 0.85})` : 'var(--bg)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 11, fontWeight: count > 0 ? 700 : 400,
                                    color: intensity > 0.5 ? '#fff' : count > 0 ? '#16a34a' : 'var(--text-faint)'
                                  }}>
                                    {count > 0 ? count : ''}
                                  </div>
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Conversion pro Status pro Setter */}
            <div style={card}>
              <div style={{ ...lblStyle, marginBottom: 16 }}>Conversion nach Status (letzte 30 Tage)</div>
              {users.filter(u => u.role !== 'admin').map(u => {
                const uConv = perfConversion.filter((r: any) => r.user_id === u.id)
                const total = uConv.reduce((s: number, r: any) => s + Number(r.count), 0)
                if (total === 0) return null
                return (
                  <div key={u.id} style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{u.username}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {uConv.sort((a: any, b: any) => b.count - a.count).map((r: any) => (
                        <div key={r.status} style={{ padding: '4px 10px', borderRadius: 99, background: 'var(--bg)', border: '1px solid var(--border)', fontSize: 12 }}>
                          {STATUS_LABELS[r.status] || r.status}: <strong>{r.count}</strong>
                          <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>({((r.count / total) * 100).toFixed(0)}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── LEADS ── */}
        {tab === 'leads' && (
          <div>
            <h2 style={h2Style}>Leads ({leads.length})</h2>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={filterUser} onChange={e => { setFilterUser(e.target.value); setSelectedLeads(new Set()) }} style={selectStyle}>
                <option value="">Alle Setter</option>
                <option value="__unassigned__">Unzugewiesen</option>
                {users.filter(u => u.role !== 'admin').map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selectStyle}>
                <option value="">Alle Status</option>
                <option value="">Offen (kein Status)</option>
                {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
              <select value={filterList} onChange={e => setFilterList(e.target.value)} style={selectStyle}>
                <option value="">Alle Listen</option>
                {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>{filteredLeads.length} Leads</span>
              <button onClick={exportLeadsCSV} style={{ padding: '7px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                ⬇ CSV Export
              </button>
            </div>

            {selectedLeads.size > 0 && (
              <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 10, padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>{selectedLeads.size} Lead(s) ausgewählt</span>
                <select value={assignTo} onChange={e => setAssignTo(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #93c5fd', background: '#fff', fontSize: 13, flex: 1, maxWidth: 200 }}>
                  <option value="">Setter wählen…</option>
                  {users.filter(u => u.role !== 'admin').map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                </select>
                <button onClick={assignLeads} disabled={!assignTo} style={{ padding: '7px 18px', background: assignTo ? '#16a34a' : 'var(--border)', color: assignTo ? '#fff' : 'var(--text-muted)', borderRadius: 7, fontSize: 13, fontWeight: 600, border: 'none', cursor: assignTo ? 'pointer' : 'default' }}>Zuweisen →</button>
                <button onClick={() => setSelectedLeads(new Set())} style={{ padding: '7px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)' }}>Abbrechen</button>
              </div>
            )}

            {importStatus && (
              <div style={{ padding: '10px 16px', marginBottom: 12, borderRadius: 8, background: importStatus.startsWith('✓') ? '#d1fae5' : importStatus === 'Importiere…' ? '#eff6ff' : '#fee2e2', color: importStatus.startsWith('✓') ? '#065f46' : importStatus === 'Importiere…' ? '#1e40af' : '#991b1b', fontSize: 13, fontWeight: 500 }}>
                {importStatus}
              </div>
            )}

            <div style={card}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th style={th}><input type="checkbox" onChange={e => setSelectedLeads(e.target.checked ? new Set(filteredLeads.map(l => l.id)) : new Set())} checked={selectedLeads.size > 0 && selectedLeads.size === filteredLeads.length} /></th>
                    <th style={th}>Name</th>
                    <th style={th}>Status</th>
                    <th style={th}>Calls</th>
                    <th style={th}>Letzter Kontakt</th>
                    <th style={th}>Setter</th>
                    <th style={th}>Liste</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.map(l => {
                    const assignedUser = users.find(u => u.id === l.assignedTo)
                    const leadList = lists.find(li => li.id === l.listId)
                    return (
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--border-light)', background: selectedLeads.has(l.id) ? 'rgba(22,163,74,0.05)' : 'transparent' }}>
                        <td style={td}><input type="checkbox" checked={selectedLeads.has(l.id)} onChange={e => { const s = new Set(selectedLeads); e.target.checked ? s.add(l.id) : s.delete(l.id); setSelectedLeads(s) }} /></td>
                        <td style={{ ...td, fontWeight: 500 }}>{l.name}</td>
                        <td style={td}>{l.status ? <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 99, background: 'var(--bg)', border: '1px solid var(--border)' }}>{STATUS_LABELS[l.status] || l.status}</span> : <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Offen</span>}</td>
                        <td style={{ ...td, fontWeight: l.callCount > 0 ? 700 : 400, color: l.callCount > 3 ? '#d97706' : 'var(--text)' }}>{l.callCount || 0}</td>
                        <td style={td}>{l.calledAt ? new Date(l.calledAt + 'T12:00:00').toLocaleDateString('de-DE') : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
                        <td style={{ ...td, color: assignedUser ? 'var(--text)' : '#dc2626' }}>{assignedUser ? assignedUser.username : 'Unzugewiesen'}</td>
                        <td style={{ ...td, fontSize: 11, color: 'var(--text-muted)' }}>{leadList?.name || '—'}</td>
                      </tr>
                    )
                  })}
                  {filteredLeads.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>Keine Leads gefunden</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── LISTEN ── */}
        {tab === 'lists' && (
          <div>
            <h2 style={h2Style}>Listen & Import</h2>
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ ...lblStyle, marginBottom: 12 }}>Neue Liste importieren</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  value={importListName}
                  onChange={e => setImportListName(e.target.value)}
                  placeholder="Listen-Name (z.B. München Juni 2026)"
                  style={{ ...inputStyle, flex: 1, minWidth: 200 }}
                />
                <label style={{ padding: '9px 16px', background: '#16a34a', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  📂 CSV importieren
                  <input type="file" accept=".csv" onChange={handleImportCSV} style={{ display: 'none' }} />
                </label>
              </div>
              {importStatus && (
                <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: importStatus.startsWith('✓') ? '#d1fae5' : '#eff6ff', color: importStatus.startsWith('✓') ? '#065f46' : '#1e40af', fontSize: 13, fontWeight: 500 }}>
                  {importStatus}
                </div>
              )}
            </div>

            <div style={card}>
              <div style={{ ...lblStyle, marginBottom: 16 }}>Alle Listen ({lists.length})</div>
              {lists.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Noch keine Listen importiert.</div>
              ) : lists.map(l => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--border-light)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{l.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      Importiert am {new Date(l.created_at).toLocaleDateString('de-DE')} von {l.imported_by || 'Admin'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>{l.total_leads}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Leads</div>
                  </div>
                  {l.duplicates_skipped > 0 && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#d97706' }}>{l.duplicates_skipped}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Duplikate</div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setFilterList(l.id); setTab('leads') }} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer' }}>Leads →</button>
                    <button onClick={() => deleteListHandler(l.id, l.name)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid #fca5a5', color: '#dc2626', background: 'none', cursor: 'pointer' }}>Löschen</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── USERS ── */}
        {tab === 'users' && (
          <div>
            <h2 style={h2Style}>Benutzer</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div style={card}>
                <div style={{ ...lblStyle, marginBottom: 16 }}>Neuen Benutzer erstellen</div>
                <form onSubmit={createUser}>
                  <div style={{ marginBottom: 12 }}>
                    <label style={lblStyle}>Benutzername</label>
                    <input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="z.B. giorgi" style={inputStyle} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={lblStyle}>Passwort</label>
                    <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" style={inputStyle} />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={lblStyle}>Rolle</label>
                    <select value={newRole} onChange={e => setNewRole(e.target.value)} style={inputStyle}>
                      <option value="setter">Setter</option>
                      <option value="setter-closer">Setter-Closer</option>
                    </select>
                  </div>
                  {formError && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{formError}</div>}
                  {formSuccess && <div style={{ fontSize: 12, color: '#16a34a', marginBottom: 10 }}>{formSuccess}</div>}
                  <button type="submit" style={{ width: '100%', padding: '10px', background: '#16a34a', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}>Benutzer erstellen</button>
                </form>
              </div>
              <div style={card}>
                <div style={{ ...lblStyle, marginBottom: 16 }}>Aktive Benutzer ({users.length})</div>
                {users.map(u => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-light)' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{u.username}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{u.role} · seit {new Date(u.created_at).toLocaleDateString('de-DE')}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: u.role === 'setter-closer' ? '#d1fae5' : '#ede9fe', color: u.role === 'setter-closer' ? '#065f46' : '#5b21b6' }}>{u.role}</span>
                      <button onClick={() => deleteUser(u.id, u.username)} style={{ fontSize: 11, color: '#dc2626', background: 'none', border: '1px solid #fca5a5', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>Löschen</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── ACTIVITY ── */}
        {tab === 'activity' && (
          <div>
            <h2 style={h2Style}>Aktivitätslog</h2>
            <div style={card}>
              <div style={{ maxHeight: 700, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg)' }}>
                      <th style={th}>Zeit</th>
                      <th style={th}>Benutzer</th>
                      <th style={th}>Aktion</th>
                      <th style={th}>Lead</th>
                      <th style={th}>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map(a => (
                      <tr key={a.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td style={{ ...td, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(a.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                          <span style={{ fontSize: 10, display: 'block' }}>{new Date(a.created_at).toLocaleDateString('de-DE')}</span>
                        </td>
                        <td style={{ ...td, fontWeight: 600 }}>{a.username}</td>
                        <td style={td}>
                          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 99, background: a.action === 'login' ? '#dbeafe' : a.action === 'call' ? '#d1fae5' : 'var(--bg)', color: a.action === 'login' ? '#1e40af' : a.action === 'call' ? '#065f46' : 'var(--text-muted)', border: '1px solid var(--border)' }}>
                            {a.action}
                          </span>
                        </td>
                        <td style={td}>{a.lead_name || '—'}</td>
                        <td style={{ ...td, color: 'var(--text-muted)' }}>{a.detail || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }
const miniStat: React.CSSProperties = { background: 'var(--bg)', borderRadius: 10, padding: '10px 12px' }
const lblStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', fontSize: 13, marginTop: 4, boxSizing: 'border-box' as const }
const selectStyle: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }
const h2Style: React.CSSProperties = { fontSize: 20, fontWeight: 700, marginBottom: 20, marginTop: 0 }
const th: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }
const td: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontSize: 13 }
