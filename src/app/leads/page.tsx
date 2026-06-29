'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSession,
  CustomColumn, CustomStatus, Lead, LeadStatus, STATUS_COLORS,
  dateKey, exportCSV, formatDate, getStatusOptions,
  parseCSV,
  loadSettingFromDB, saveSettingToDB,
} from '@/lib/crm'
import { StatusBadge } from '@/components/StatusBadge'

const SIP_DOMAIN = process.env.NEXT_PUBLIC_SIP_DOMAIN || 'pbx.easybell.de'
function sipLink(p: string) { return `sip:${p.replace(/\s/g,'')}@${SIP_DOMAIN}` }
function isValidWebsite(w: string) {
  const v = w.trim(); if (!v || /\s/.test(v)) return false
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+\.[a-z]{2,}$/i.test(v.replace(/^https?:\/\//i,'').split('/')[0])
}
function websiteHref(w: string) { return w.startsWith('http') ? w : `https://${w}` }

type SortKey = 'wiedervorlage' | 'calledAt' | 'name' | 'createdAt'
type SortDir = 'asc' | 'desc'
type QuickFilter = 'all' | 'today' | 'never' | LeadStatus

function getWvRelative(wv: string) {
  if (!wv) return ''
  const today = dateKey()
  if (wv === today) return 'Heute'
  if (wv < today) {
    const d = Math.round((new Date(today).getTime()-new Date(wv).getTime())/86400000)
    return `vor ${d} Tag${d===1?'':'en'}`
  }
  const d = Math.round((new Date(wv).getTime()-new Date(today).getTime())/86400000)
  if (d===1) return 'Morgen'
  return new Date(wv).toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit'})
}
function wvUrgency(wv: string): 'overdue'|'today'|'future'|'none' {
  if (!wv) return 'none'
  const t = dateKey()
  if (wv < t) return 'overdue'
  if (wv === t) return 'today'
  return 'future'
}
function emptyLead(): Lead {
  return {id:`lead_${Date.now()}`,name:'',phone:'',website:'',owner:'',status:'',callNote:'',wiedervorlage:'',calledAt:'',calledAtFull:'',createdAt:dateKey(),assignedTo:'',listId:'',callCount:0,extra:{}}
}

export default function LeadsPage() {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [customStatuses, setCustomStatuses] = useState<CustomStatus[]>([])
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([])
  const [loading, setLoading] = useState(true)
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('wiedervorlage')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<Lead>>({})
  const [showNewLead, setShowNewLead] = useState(false)
  const [newLead, setNewLead] = useState<Lead>(() => emptyLead())
  const [showStatusManager, setShowStatusManager] = useState(false)
  const [showColumnManager, setShowColumnManager] = useState(false)
  const [newStatusName, setNewStatusName] = useState('')
  const [newStatusColor, setNewStatusColor] = useState(0)
  const [newColLabel, setNewColLabel] = useState('')
  const [newColType, setNewColType] = useState<CustomColumn['type']>('text')
  const [toast, setToast] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const statusOptions = useMemo(() => getStatusOptions(customStatuses), [customStatuses])
  const today = dateKey()

  const fetchLeads = useCallback(async () => {
    try {
      const s = getSession(); const assignedTo = s && s.role !== 'admin' ? '?assignedTo=' + s.userId : ''; const res = await fetch('/api/leads' + assignedTo)
      if (res.ok) setLeads(await res.json())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    const _navSess = getSession(); if (!_navSess) { router.replace('/'); return }
    // Statuses + Columns aus DB laden (cross-browser synchron)
    loadSettingFromDB('custom_statuses').then(s => { if (s.length) setCustomStatuses(s) })
    loadSettingFromDB('custom_columns').then((c: any[]) => { if (c.length) setCustomColumns(c) })
    fetchLeads()
    const iv = setInterval(fetchLeads, 5000)
    // Settings alle 10s neu laden (damit Giorgi sieht was Ben anlegt)
    const sv = setInterval(() => {
      loadSettingFromDB('custom_statuses').then(s => { if (s.length) setCustomStatuses(s) })
      loadSettingFromDB('custom_columns').then((c: any[]) => { if (c.length) setCustomColumns(c) })
    }, 10000)
    return () => { clearInterval(iv); clearInterval(sv) }
  }, [router, fetchLeads])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 2500) }
  function persistStatuses(next: CustomStatus[]) {
    setCustomStatuses(next)
    saveSettingToDB('custom_statuses', next)
  }
  function persistColumns(next: CustomColumn[]) {
    setCustomColumns(next)
    saveSettingToDB('custom_columns', next)
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d==='asc'?'desc':'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  function sortArrow(key: SortKey) {
    if (sortKey !== key) return <span style={{color:'var(--text-faint)',marginLeft:3}}>↕</span>
    return <span style={{marginLeft:3}}>{sortDir==='asc'?'↑':'↓'}</span>
  }

  const processedLeads = useMemo(() => {
    let f = leads.filter(l => {
      if (quickFilter==='today') return l.wiedervorlage && l.wiedervorlage <= today
      if (quickFilter==='never') return !l.calledAt && !l.status
      if (quickFilter!=='all') return l.status === quickFilter
      return true
    })
    const q = search.toLowerCase()
    if (q) f = f.filter(l =>
      l.name.toLowerCase().includes(q) || l.phone.toLowerCase().includes(q) ||
      l.website.toLowerCase().includes(q) || l.owner.toLowerCase().includes(q) ||
      l.callNote.toLowerCase().includes(q) ||
      Object.values(l.extra ?? {}).some(v => v.toLowerCase().includes(q))
    )
    return f.sort((a, b) => {
      let av = (a as any)[sortKey] || '', bv = (b as any)[sortKey] || ''
      if (sortKey==='wiedervorlage') { if (!av&&!bv) return 0; if (!av) return 1; if (!bv) return -1 }
      if (av<bv) return sortDir==='asc'?-1:1
      if (av>bv) return sortDir==='asc'?1:-1
      return 0
    })
  }, [leads, quickFilter, search, sortKey, sortDir, today])

  const useSections = sortKey==='wiedervorlage' && sortDir==='asc' && quickFilter==='all' && !search
  const sections = useMemo(() => {
    if (!useSections) return null
    return {
      overdue: processedLeads.filter(l => l.wiedervorlage && l.wiedervorlage < today),
      todayL:  processedLeads.filter(l => l.wiedervorlage === today),
      open:    processedLeads.filter(l => !l.wiedervorlage && !l.status),
      worked:  processedLeads.filter(l => !l.wiedervorlage && l.status),
      future:  processedLeads.filter(l => l.wiedervorlage && l.wiedervorlage > today),
    }
  }, [useSections, processedLeads, today])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = async ev => {
      const parsed = parseCSV(ev.target?.result as string)
      if (!parsed.length) { showToast('Keine Daten'); return }
      if (leads.length>0 && !confirm(`${leads.length} Einträge ersetzen?`)) return
      const session = getSession()
      const listName = file.name.replace(/\.csv$/i, '') || 'Import'
      const res = await fetch(`/api/leads?listName=${encodeURIComponent(listName)}&importedBy=${encodeURIComponent(session?.username || '')}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(parsed)})
      if (res.ok) {
        const data = await res.json()
        await fetchLeads()
        showToast(`${data.inserted || parsed.length} Leads importiert${data.skipped ? `, ${data.skipped} Duplikate übersprungen` : ''}`)
      }
    }
    reader.readAsText(file,'UTF-8'); e.target.value=''
  }

  function startEdit(lead: Lead) {
    setEditingId(lead.id)
    setEditData({...lead, extra: {...(lead.extra??{})} })
    setShowNewLead(false)
  }

  async function saveEdit() {
    if (!editingId) return
    const orig = leads.find(l => l.id===editingId)
    await fetch(`/api/leads/${editingId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(editData)})
    // call history is logged server-side via /api/activity
    setEditingId(null); setEditData({}); await fetchLeads(); showToast('Gespeichert')
  }

  async function createLead() {
    if (!newLead.name.trim()) { showToast('Name fehlt'); return }
    const payload = {...newLead, id:`lead_${Date.now()}`, name:newLead.name.trim(), createdAt:dateKey()}
    const res = await fetch('/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
    if (res.ok) { setNewLead(emptyLead()); setShowNewLead(false); await fetchLeads(); showToast('Lead hinzugefügt') }
    else showToast('Fehler')
  }

  function addCustomStatus() {
    const label = newStatusName.trim(); if (!label) return
    if (statusOptions.some(s => s.value.toLowerCase()===label.toLowerCase())) { showToast('Existiert bereits'); return }
    const sw = STATUS_COLORS[newStatusColor % STATUS_COLORS.length]
    persistStatuses([...customStatuses, {value:label,label,color:sw.color,bg:sw.bg,autoAdvance:false}])
    setNewStatusName(''); showToast('Status hinzugefügt')
  }
  function deleteCustomStatus(value: string) {
    if (!confirm(`Status "${value}" entfernen?`)) return
    persistStatuses(customStatuses.filter(s => s.value!==value))
    if (quickFilter===value) setQuickFilter('all')
  }

  function addCustomColumn() {
    const label = newColLabel.trim(); if (!label) return
    const key = label.toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_')
    if (customColumns.some(c => c.key===key)) { showToast('Spalte existiert bereits'); return }
    persistColumns([...customColumns, {key, label, type: newColType}])
    setNewColLabel(''); showToast(`Spalte "${label}" hinzugefügt`)
  }
  function deleteCustomColumn(key: string) {
    if (!confirm('Spalte löschen? Daten bleiben erhalten.')) return
    persistColumns(customColumns.filter(c => c.key!==key))
  }

  async function deleteLeadFn(id: string) {
    if (!confirm('Löschen?')) return
    await fetch(`/api/leads/${id}`,{method:'DELETE'})
    await fetchLeads()
  }

  const todayDueCount = leads.filter(l => l.wiedervorlage && l.wiedervorlage<=today).length
  const neverCount = leads.filter(l => !l.calledAt && !l.status).length
  const openCount = leads.filter(l => !l.status).length
  const countByStatus = (s: LeadStatus) => leads.filter(l => l.status===s).length

  if (loading) return <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)'}}>Laden...</div>

  // ── Row renderer ──────────────────────────────────────────────────────────
  const renderRow = (lead: Lead) => {
    const isE = editingId===lead.id
    const urgency = wvUrgency(lead.wiedervorlage)
    const rowBg = !isE && (urgency==='overdue'||urgency==='today') ? 'rgba(251,191,36,0.06)' : undefined
    return (
      <tr key={lead.id} style={{background: isE ? '#f8fafc' : rowBg || 'var(--surface)'}}
        onMouseOver={e => { if (!isE && !rowBg) e.currentTarget.style.background='var(--surface-hover)' }}
        onMouseOut={e => { if (!isE && !rowBg) e.currentTarget.style.background='var(--surface)' }}>

        {/* Firma */}
        <td style={{...st.td, minWidth:200}}>
          {isE ? (
            <div style={{display:'grid',gap:6}}>
              <input value={editData.name??''} onChange={e=>setEditData(d=>({...d,name:e.target.value}))} placeholder="Name" style={st.ci}/>
              <input value={editData.website??''} onChange={e=>setEditData(d=>({...d,website:e.target.value}))} placeholder="Website" style={st.ci}/>
            </div>
          ) : isValidWebsite(lead.website) ? (
            <a href={websiteHref(lead.website)} target="_blank" rel="noopener noreferrer" style={{display:'block',textDecoration:'none'}}>
              <span style={{fontWeight:600,color:'var(--text)'}}>{lead.name}</span>
              <span style={{display:'block',fontSize:11,color:'var(--text-faint)',marginTop:1,textDecoration:'underline'}}>
                {lead.website.replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,'')}
              </span>
            </a>
          ) : (
            <><span style={{fontWeight:600}}>{lead.name}</span>
            {lead.website && <span style={{display:'block',fontSize:11,color:'var(--text-faint)',marginTop:1}}>{lead.website}</span>}</>
          )}
        </td>

        {/* Telefon */}
        <td style={st.td}>
          {isE ? <input value={editData.phone??''} onChange={e=>setEditData(d=>({...d,phone:e.target.value}))} style={st.ci}/>
            : lead.phone ? <a href={sipLink(lead.phone)} style={{color:'var(--text)',fontWeight:500,fontSize:13}}>{lead.phone}</a>
            : <span style={{color:'var(--text-faint)'}}>—</span>}
        </td>

        {/* Inhaber */}
        <td style={st.td}>
          {isE ? <input value={editData.owner??''} onChange={e=>setEditData(d=>({...d,owner:e.target.value}))} style={st.ci}/>
            : <span style={{color:'var(--text-secondary)',fontSize:13}}>{lead.owner||'—'}</span>}
        </td>

        {/* Status */}
        <td style={st.td}>
          {isE ? (
            <select value={editData.status??''} onChange={e=>setEditData(d=>({...d,status:e.target.value as LeadStatus}))} style={{...st.ci,cursor:'pointer'}}>
              <option value="">Offen</option>
              {statusOptions.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          ) : <StatusBadge status={lead.status} customStatuses={customStatuses}/>}
        </td>

        {/* Custom Columns */}
        {customColumns.map(col => (
          <td key={col.key} style={{...st.td, minWidth:130}}>
            {isE ? (
              <input
                type={col.type==='email'?'email':col.type==='url'?'url':col.type==='number'?'number':'text'}
                value={editData.extra?.[col.key]??''}
                onChange={e=>setEditData(d=>({...d,extra:{...(d.extra??{}), [col.key]:e.target.value}}))}
                placeholder={col.label}
                style={st.ci}
              />
            ) : col.type==='email' && lead.extra?.[col.key] ? (
              <a href={`mailto:${lead.extra[col.key]}`} style={{fontSize:13,color:'var(--text-secondary)'}}>{lead.extra[col.key]}</a>
            ) : col.type==='url' && lead.extra?.[col.key] ? (
              <a href={websiteHref(lead.extra[col.key])} target="_blank" rel="noopener noreferrer" style={{fontSize:13,color:'#378ADD',textDecoration:'underline'}}>{lead.extra[col.key]}</a>
            ) : (
              <span style={{fontSize:13,color:'var(--text-secondary)'}}>{lead.extra?.[col.key]||'—'}</span>
            )}
          </td>
        ))}

        {/* Wdv */}
        <td style={{...st.td,whiteSpace:'nowrap'}}>
          {isE ? <input type="date" value={editData.wiedervorlage??''} onChange={e=>setEditData(d=>({...d,wiedervorlage:e.target.value}))} style={{...st.ci,width:130}}/>
            : lead.wiedervorlage ? (
              <span style={{fontSize:12,fontWeight:urgency!=='future'?600:400,color:urgency==='overdue'?'#dc2626':urgency==='today'?'#d97706':'var(--text-secondary)'}}>
                {urgency==='overdue'&&'⚠ '}{getWvRelative(lead.wiedervorlage)}
              </span>
            ) : <span style={{color:'var(--text-faint)',fontSize:13}}>—</span>}
        </td>

        {/* Notiz */}
        <td style={{...st.td,minWidth:200}}>
          {isE ? <textarea value={editData.callNote??''} onChange={e=>setEditData(d=>({...d,callNote:e.target.value}))} rows={2} style={{...st.ci,resize:'vertical'}}/>
            : <span
                style={{fontSize:12,color:'var(--text-secondary)',display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:240,cursor:lead.callNote?'pointer':'default',position:'relative'}}
                title={lead.callNote || ''}
                onClick={e=>{
                  if(!lead.callNote) return
                  const existing = document.getElementById('note-popup')
                  if(existing) { existing.remove(); return }
                  const popup = document.createElement('div')
                  popup.id = 'note-popup'
                  popup.style.cssText = 'position:fixed;z-index:9999;background:#111110;border-radius:14px;padding:14px 18px;max-width:360px;font-size:13px;line-height:1.6;color:#f5f5f5;box-shadow:0 8px 32px rgba(0,0,0,0.22),0 2px 8px rgba(0,0,0,0.12);white-space:pre-wrap;word-break:break-word;pointer-events:auto'
                  popup.textContent = lead.callNote
                  const rect = (e.target as HTMLElement).getBoundingClientRect()
                  popup.style.top = (rect.bottom + 8) + 'px'
                  popup.style.left = Math.min(rect.left, window.innerWidth - 380) + 'px'
                  document.body.appendChild(popup)
                  const close = (ev:MouseEvent)=>{ if(!popup.contains(ev.target as Node)){popup.remove();document.removeEventListener('click',close)} }
                  setTimeout(()=>document.addEventListener('click',close),0)
                }}
              >
                {lead.callNote||<span style={{color:'var(--text-faint)'}}>—</span>}
              </span>}
        </td>

        {/* Angerufen */}
        <td style={{...st.td,whiteSpace:'nowrap'}}>
          {isE ? <input type="date" value={editData.calledAt??''} onChange={e=>setEditData(d=>({...d,calledAt:e.target.value}))} style={{...st.ci,width:130}}/>
            : <span style={{fontSize:12,color:'var(--text-muted)'}}>{lead.calledAt ? formatDate(lead.calledAt) : '—'}</span>}
        </td>

        {/* Aktionen */}
        <td style={{...st.td,whiteSpace:'nowrap'}}>
          {isE ? (
            <div style={{display:'flex',gap:6}}>
              <button onClick={saveEdit} style={st.btnSave}>Speichern</button>
              <button onClick={()=>{setEditingId(null);setEditData({})}} style={st.btnCancel}>×</button>
            </div>
          ) : (
            <div style={{display:'flex',gap:4,opacity:.6}} onMouseOver={e=>e.currentTarget.style.opacity='1'} onMouseOut={e=>e.currentTarget.style.opacity='.6'}>
              <button onClick={()=>startEdit(lead)} style={st.btnIcon} title="Bearbeiten">✎</button>
              <button onClick={()=>deleteLeadFn(lead.id)} style={{...st.btnIcon,color:'#ef4444'}} title="Löschen">×</button>
            </div>
          )}
        </td>
      </tr>
    )
  }

  const SectionHeader = ({label,count,icon}:{label:string;count:number;icon?:string}) => (
    <tr>
      <td colSpan={8+customColumns.length} style={{padding:'6px 14px',fontSize:11,fontWeight:600,color:'var(--text-muted)',background:'var(--bg)',borderBottom:'1px solid var(--border-light)',textTransform:'uppercase',letterSpacing:'0.04em'}}>
        {icon&&<span style={{marginRight:5}}>{icon}</span>}{label} <span style={{fontWeight:400,opacity:.7}}>({count})</span>
      </td>
    </tr>
  )

  return (
    <div>
      <div style={st.container}>

        {/* Top Bar */}
        <div style={st.topbar}>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button onClick={()=>{setShowNewLead(v=>!v);setEditingId(null)}} style={st.btnPrimary}>+ Lead hinzufügen</button>
            <button onClick={()=>{setShowStatusManager(v=>!v);setShowColumnManager(false)}} style={st.btnSecondary}>Status verwalten</button>
            <button onClick={()=>{setShowColumnManager(v=>!v);setShowStatusManager(false)}} style={st.btnSecondary}>+ Spalten</button>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'flex-end'}}>
            {leads.length>0 && <button onClick={()=>exportCSV(leads)} style={st.btnGhost}>Export CSV</button>}
            <button onClick={()=>fileRef.current?.click()} style={st.btnPrimary}>CSV importieren</button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.txt" onChange={onFile} hidden/>

        {/* New Lead Form */}
        {showNewLead && (
          <div style={st.panel} className="fade-in">
            <LeadFields data={newLead} onChange={p=>setNewLead(d=>({...d,...p}))} statusOptions={statusOptions} customColumns={customColumns}/>
            <div style={st.formActions}>
              <button onClick={()=>{setShowNewLead(false);setNewLead(emptyLead())}} style={st.btnSecondary}>Abbrechen</button>
              <button onClick={createLead} style={st.btnPrimary}>Lead speichern</button>
            </div>
          </div>
        )}

        {/* Status Manager */}
        {showStatusManager && (
          <div style={st.panel} className="fade-in">
            <div style={{display:'grid',gridTemplateColumns:'minmax(180px,1fr) auto auto',gap:10,alignItems:'end'}}>
              <div>
                <label style={st.label}>Neuer Status</label>
                <input value={newStatusName} onChange={e=>setNewStatusName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addCustomStatus()} placeholder="z.B. Demo vereinbart" style={st.input}/>
              </div>
              <div>
                <label style={st.label}>Farbe</label>
                <div style={{display:'flex',gap:6,alignItems:'center',minHeight:36}}>
                  {STATUS_COLORS.map((sw,i)=>(
                    <button key={sw.color} onClick={()=>setNewStatusColor(i)} style={{width:28,height:28,borderRadius:99,background:sw.bg,border:newStatusColor===i?`2px solid ${sw.color}`:'1px solid var(--border)'}}>
                      <span style={{display:'block',width:12,height:12,borderRadius:99,margin:'0 auto',background:sw.color}}/>
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={addCustomStatus} style={{...st.btnPrimary,height:36}}>Erstellen</button>
            </div>
            <div style={st.chipList}>
              {customStatuses.length===0 ? <span style={{fontSize:13,color:'var(--text-muted)'}}>Noch keine eigenen Status.</span>
                : customStatuses.map(s=>(
                  <div key={s.value} style={st.chipItem}>
                    <StatusBadge status={s.value} customStatuses={customStatuses}/>
                    <button onClick={()=>deleteCustomStatus(s.value)} style={{...st.btnIcon,color:'#ef4444'}}>×</button>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Column Manager */}
        {showColumnManager && (
          <div style={st.panel} className="fade-in">
            <div style={{marginBottom:16}}>
              <div style={{...st.label,marginBottom:10}}>Aktuelle Spalten</div>
              {customColumns.length===0
                ? <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>Noch keine eigenen Spalten.</div>
                : (
                  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
                    {customColumns.map(col=>(
                      <div key={col.key} style={{display:'flex',alignItems:'center',gap:6,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:'6px 10px'}}>
                        <span style={{fontSize:13,fontWeight:500}}>{col.label}</span>
                        <span style={{fontSize:11,color:'var(--text-faint)',background:'var(--border)',borderRadius:4,padding:'1px 6px'}}>{col.type}</span>
                        <button onClick={()=>deleteCustomColumn(col.key)} style={{...st.btnIcon,color:'#ef4444',width:18,height:18,fontSize:12}}>×</button>
                      </div>
                    ))}
                  </div>
                )
              }
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:10,alignItems:'end'}}>
              <div>
                <label style={st.label}>Spaltenname</label>
                <input value={newColLabel} onChange={e=>setNewColLabel(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addCustomColumn()} placeholder="z.B. E-Mail, Stadt, Mitarbeiter..." style={st.input}/>
              </div>
              <div>
                <label style={st.label}>Typ</label>
                <select value={newColType} onChange={e=>setNewColType(e.target.value as CustomColumn['type'])} style={{...st.input,width:'auto'}}>
                  <option value="text">Text</option>
                  <option value="email">E-Mail</option>
                  <option value="url">URL</option>
                  <option value="number">Zahl</option>
                </select>
              </div>
              <button onClick={addCustomColumn} style={{...st.btnPrimary,height:36}}>Spalte hinzufügen</button>
            </div>
          </div>
        )}

        {/* Filter + Search + Sort */}
        {leads.length>0 && (
          <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:16,flexWrap:'wrap'}}>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',flex:1}}>
              <FilterChip label="Alle" count={leads.length} active={quickFilter==='all'} onClick={()=>setQuickFilter('all')}/>
              {todayDueCount>0 && <FilterChip label="Heute fällig" count={todayDueCount} active={quickFilter==='today'} onClick={()=>setQuickFilter(p=>p==='today'?'all':'today')} urgent/>}
              <FilterChip label="Offen" count={openCount} active={quickFilter===''} onClick={()=>setQuickFilter(p=>p===''?'all':'')}/>
              {statusOptions.map(s=>(
                <FilterChip key={s.value} label={s.label} count={countByStatus(s.value)} active={quickFilter===s.value}
                  onClick={()=>setQuickFilter(p=>p===s.value?'all':s.value as QuickFilter)} color={s.color}/>
              ))}
              {neverCount>0 && <FilterChip label="Nie angerufen" count={neverCount} active={quickFilter==='never'} onClick={()=>setQuickFilter(p=>p==='never'?'all':'never')}/>}
            </div>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Suchen..." style={{...st.input,width:180,marginBottom:0}}/>
            <select value={`${sortKey}_${sortDir}`} onChange={e=>{const[k,d]=e.target.value.split('_');setSortKey(k as SortKey);setSortDir(d as SortDir)}} style={{...st.input,width:'auto',marginBottom:0,cursor:'pointer'}}>
              <option value="wiedervorlage_asc">Wiedervorlage zuerst</option>
              <option value="calledAt_desc">Zuletzt angerufen</option>
              <option value="calledAt_asc">Älteste zuerst</option>
              <option value="name_asc">Name A→Z</option>
              <option value="createdAt_asc">Importreihenfolge</option>
            </select>
            {openCount>0 && (
              <button onClick={()=>router.push('/dialer')} style={{...st.btnPrimary,background:'#16a34a',padding:'9px 20px',whiteSpace:'nowrap'}}>
                Anrufen starten ({openCount})
              </button>
            )}
          </div>
        )}

        {/* Table */}
        {leads.length===0 ? (
          <div style={st.empty} className="fade-in">
            <div style={{fontSize:17,fontWeight:600,marginBottom:6}}>Noch keine Leads</div>
            <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:24}}>CSV importieren oder Lead manuell anlegen.</div>
            <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
              <button onClick={()=>setShowNewLead(true)} style={st.btnSecondary}>+ Lead hinzufügen</button>
              <button onClick={()=>fileRef.current?.click()} style={st.btnPrimary}>CSV importieren</button>
            </div>
          </div>
        ) : (
          <div style={st.tableWrap} className="fade-in">
            <table style={st.table}>
              <thead>
                <tr>
                  {[
                    {key:'name',label:'Firma & Website'},
                    {key:null,label:'Telefon'},
                    {key:null,label:'Inhaber'},
                    {key:null,label:'Status'},
                    ...customColumns.map(c=>({key:null,label:c.label})),
                    {key:'wiedervorlage',label:'Wdv.'},
                    {key:null,label:'Notiz'},
                    {key:'calledAt',label:'Angerufen an'},
                    {key:null,label:''},
                  ].map(({key,label},i)=>(
                    <th key={i} style={{...st.th,cursor:key?'pointer':'default'}} onClick={()=>key&&handleSort(key as SortKey)}>
                      {label}{key&&sortArrow(key as SortKey)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {useSections && sections ? (
                  <>
                    {(sections.overdue.length>0||sections.todayL.length>0)&&(
                      <><SectionHeader label="Wiedervorlage fällig" count={sections.overdue.length+sections.todayL.length} icon="⚠"/>
                      {sections.overdue.map(renderRow)}{sections.todayL.map(renderRow)}</>
                    )}
                    {sections.open.length>0&&(<><SectionHeader label="Offen — noch nie angerufen" count={sections.open.length}/>{sections.open.map(renderRow)}</>)}
                    {sections.worked.length>0&&(<><SectionHeader label="Bearbeitet" count={sections.worked.length}/>{sections.worked.map(renderRow)}</>)}
                    {sections.future.length>0&&(<><SectionHeader label="Zukünftige Wiedervorlagen" count={sections.future.length}/>{sections.future.map(renderRow)}</>)}
                  </>
                ) : processedLeads.map(renderRow)}
              </tbody>
            </table>
            {processedLeads.length===0 && <div style={{textAlign:'center',padding:'2.5rem',color:'var(--text-muted)',fontSize:13}}>Keine Ergebnisse</div>}
          </div>
        )}
      </div>
      {toast && <Toast msg={toast}/>}
    </div>
  )
}

function FilterChip({label,count,active,onClick,urgent,color}:{label:string;count:number;active:boolean;onClick:()=>void;urgent?:boolean;color?:string}) {
  return (
    <button onClick={onClick} style={{padding:'5px 12px',borderRadius:99,fontSize:12,fontWeight:500,background:active?(urgent?'#dc2626':color||'var(--accent)'):'var(--surface)',color:active?'#fff':'var(--text-secondary)',border:`1px solid ${active?'transparent':'var(--border)'}`,cursor:'pointer',transition:'all 150ms',whiteSpace:'nowrap'}}>
      {label} <span style={{opacity:.75}}>{count}</span>
    </button>
  )
}

function LeadFields({data,onChange,statusOptions,customColumns}:{data:Lead;onChange:(p:Partial<Lead>)=>void;statusOptions:CustomStatus[];customColumns:CustomColumn[]}) {
  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
      {([['name','Name'],['phone','Telefon'],['website','Website'],['owner','Inhaber']] as [keyof Lead,string][]).map(([f,l])=>(
        <label key={f as string}>
          <span style={st.label}>{l}</span>
          <input value={(data[f] as string)??''} onChange={e=>onChange({[f]:e.target.value})} style={st.input}/>
        </label>
      ))}
      <label>
        <span style={st.label}>Status</span>
        <select value={data.status} onChange={e=>onChange({status:e.target.value})} style={st.input}>
          <option value="">Offen</option>
          {statusOptions.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      <label>
        <span style={st.label}>Wiedervorlage</span>
        <input type="date" value={data.wiedervorlage} onChange={e=>onChange({wiedervorlage:e.target.value})} style={st.input}/>
      </label>
      {customColumns.map(col=>(
        <label key={col.key}>
          <span style={st.label}>{col.label}</span>
          <input
            type={col.type==='email'?'email':col.type==='url'?'url':col.type==='number'?'number':'text'}
            value={data.extra?.[col.key]??''}
            onChange={e=>onChange({extra:{...(data.extra??{}),[col.key]:e.target.value}})}
            style={st.input}
          />
        </label>
      ))}
      <div style={{gridColumn:'1 / -1'}}>
        <label>
          <span style={st.label}>Notiz</span>
          <textarea value={data.callNote} onChange={e=>onChange({callNote:e.target.value})} rows={3} style={{...st.input,resize:'vertical'}}/>
        </label>
      </div>
    </div>
  )
}

function Toast({msg}:{msg:string}) {
  return <div className="fade-in" style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',background:'var(--accent)',color:'#fff',padding:'8px 20px',borderRadius:100,fontSize:13,boxShadow:'var(--shadow-md)',whiteSpace:'nowrap',zIndex:100}}>{msg}</div>
}

const st: Record<string,React.CSSProperties> = {
  container: {maxWidth:1320,margin:'0 auto',padding:'20px 24px'},
  topbar: {display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:16,flexWrap:'wrap'},
  panel: {background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:18,marginBottom:18,boxShadow:'var(--shadow-sm)'},
  chipList: {display:'flex',gap:8,flexWrap:'wrap',borderTop:'1px solid var(--border-light)',marginTop:16,paddingTop:16},
  chipItem: {display:'flex',alignItems:'center',gap:4,border:'1px solid var(--border)',borderRadius:999,padding:'3px 5px 3px 3px'},
  formActions: {display:'flex',justifyContent:'flex-end',gap:8,marginTop:14},
  tableWrap: {background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',boxShadow:'var(--shadow-sm)',overflow:'auto'},
  table: {width:'100%',borderCollapse:'collapse'},
  th: {padding:'9px 14px',textAlign:'left',fontSize:11,fontWeight:600,color:'var(--text-muted)',background:'var(--bg)',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:0,userSelect:'none'},
  td: {padding:'10px 14px',borderBottom:'1px solid var(--border-light)',fontSize:14,verticalAlign:'middle'},
  ci: {width:'100%',padding:'5px 8px',border:'1px solid var(--accent)',borderRadius:6,background:'var(--surface)',fontSize:13,color:'var(--text)'},
  input: {padding:'9px 12px',border:'1px solid var(--border)',borderRadius:'var(--radius)',background:'var(--surface)',color:'var(--text)',width:'100%',marginBottom:0,fontSize:13},
  label: {display:'block',fontSize:11,fontWeight:700,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:0},
  btnPrimary: {padding:'8px 16px',background:'var(--accent)',color:'#fff',borderRadius:'var(--radius)',fontSize:13,fontWeight:700,border:'none',cursor:'pointer'},
  btnSecondary: {padding:'8px 16px',background:'var(--surface)',color:'var(--text)',borderRadius:'var(--radius)',fontSize:13,fontWeight:600,border:'1px solid var(--border)',cursor:'pointer'},
  btnGhost: {padding:'6px 14px',borderRadius:'var(--radius)',fontSize:13,fontWeight:600,color:'var(--text-secondary)',cursor:'pointer',border:'none',background:'none'},
  btnIcon: {width:28,height:28,display:'inline-flex',alignItems:'center',justifyContent:'center',borderRadius:6,fontSize:14,color:'var(--text-secondary)',border:'none',background:'none',cursor:'pointer'},
  btnSave: {padding:'4px 12px',fontSize:12,borderRadius:6,background:'var(--accent)',color:'#fff',fontWeight:600,border:'none',cursor:'pointer'},
  btnCancel: {padding:'4px 10px',fontSize:14,borderRadius:6,border:'1px solid var(--border)',color:'var(--text-muted)',background:'none',cursor:'pointer'},
  empty: {textAlign:'center',padding:'5rem 2rem',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',boxShadow:'var(--shadow-sm)'},
}
