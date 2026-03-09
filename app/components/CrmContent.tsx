'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'

const STAGES = ['Qualificato', 'Appuntamento fissato', 'Ingresso', 'Preventivo', 'Vendita', 'Non convertito']
const ENVIRONMENTS = ['Cucina', 'Soggiorno', 'Camera da letto', 'Cameretta', 'Tavoli e sedie', 'Altro']
const PROB_OPTIONS = [0, 25, 50, 75, 90, 100]
const PROB_COLORS: Record<number, string> = { 0: 'bg-gray-100 text-gray-500', 25: 'bg-red-100 text-red-700', 50: 'bg-orange-100 text-orange-700', 75: 'bg-yellow-100 text-yellow-700', 90: 'bg-blue-100 text-blue-700', 100: 'bg-green-100 text-green-700' }

interface Deal {
  id: string; title: string; contact_name: string; phone: string; email: string
  origin: string; environment: string; entry_date: string; appointment_date: string
  estimate: number; project_timeline: string; stage: string; created_at: string
  probability: number | null; is_lead: boolean; lead_stage: string
}

const emptyDeal = { title: '', contact_name: '', phone: '', email: '', origin: '', environment: '', entry_date: '', appointment_date: '', estimate: 0, project_timeline: '', stage: 'Qualificato', probability: null as number | null }
type View = 'kanban' | 'list' | 'dashboard' | 'leads'
type QuickRange = 'today' | 'week' | 'month' | 'lastmonth' | 'alltime' | 'custom'

function formatDate(dateStr: string) {
  if (!dateStr) return '-'
  const parts = dateStr.split('-')
  if (parts.length === 3) return `${parseInt(parts[2])}/${parseInt(parts[1])}/${parts[0]}`
  return '-'
}
function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function getLast30Days() {
  const to = new Date(); const from = new Date(); from.setDate(from.getDate()-29)
  return { from: toYMD(from), to: toYMD(to) }
}
function getRangeForQuick(type: QuickRange) {
  const now = new Date(); const y = now.getFullYear(); const mo = now.getMonth()
  if (type==='today') { const s=toYMD(now); return {from:s,to:s} }
  if (type==='week') { const day=now.getDay()===0?7:now.getDay(); const mon=new Date(now); mon.setDate(now.getDate()-day+1); const sun=new Date(mon); sun.setDate(mon.getDate()+6); return {from:toYMD(mon),to:toYMD(sun)} }
  if (type==='month') return {from:toYMD(new Date(y,mo,1)),to:toYMD(new Date(y,mo+1,0))}
  if (type==='lastmonth') return {from:toYMD(new Date(y,mo-1,1)),to:toYMD(new Date(y,mo,0))}
  return {from:'',to:''}
}
function getCurrentMonthRange() { return getRangeForQuick('month') }
function getDefaultProb(stage: string): number | null {
  if (stage === 'Vendita') return 100
  if (stage === 'Preventivo') return 50
  if (stage === 'Non convertito') return 0
  return null
}

function EnvSelect({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  const selected = value ? value.split(',').map(s=>s.trim()).filter(Boolean) : []
  function toggle(env: string) { const next=selected.includes(env)?selected.filter(e=>e!==env):[...selected,env]; onChange(next.join(', ')) }
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {ENVIRONMENTS.map(env => (
        <button key={env} type="button" onClick={()=>toggle(env)}
          className={`px-3 py-1 rounded-full text-xs border transition-colors ${selected.includes(env)?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
          {env}
        </button>
      ))}
    </div>
  )
}

// Simple SVG Pie Chart
function PieChart({ data, size=160 }: { data: {label:string, value:number, color:string}[], size?: number }) {
  const total = data.reduce((s,d)=>s+d.value,0)
  if (total === 0) return <div className="flex items-center justify-center text-gray-400 text-sm" style={{width:size,height:size}}>Nessun dato</div>
  let cumAngle = -Math.PI/2
  const cx = size/2, cy = size/2, r = size/2 - 4
  const slices = data.filter(d=>d.value>0).map(d => {
    const angle = (d.value/total) * 2 * Math.PI
    const x1 = cx + r * Math.cos(cumAngle), y1 = cy + r * Math.sin(cumAngle)
    cumAngle += angle
    const x2 = cx + r * Math.cos(cumAngle), y2 = cy + r * Math.sin(cumAngle)
    const large = angle > Math.PI ? 1 : 0
    return { ...d, path: `M${cx},${cy} L${x1},${y1} A${r},${r},0,${large},1,${x2},${y2} Z` }
  })
  return (
    <svg width={size} height={size}>
      {slices.map((s,i) => <path key={i} d={s.path} fill={s.color} stroke="white" strokeWidth={1.5}/>)}
    </svg>
  )
}

const PIE_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316']

export default function CrmContent() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [checked, setChecked] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showIngressoForm, setShowIngressoForm] = useState(false)
  const [selectedDeal, setSelectedDeal] = useState<Deal|null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editDeal, setEditDeal] = useState<Deal|null>(null)
  const [form, setForm] = useState(emptyDeal)
  const [quickAddStage, setQuickAddStage] = useState<string|null>(null)
  const [quickForm, setQuickForm] = useState(emptyDeal)
  const [ingressoForm, setIngressoForm] = useState({...emptyDeal, stage:'Ingresso', entry_date:toYMD(new Date())})
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Deal[]>([])
  const [isNewContact, setIsNewContact] = useState(false)
  const [view, setView] = useState<View>('kanban')
  const [groupBy, setGroupBy] = useState('none')
  const [activeQuick, setActiveQuick] = useState<QuickRange>('month')
  const [saveError, setSaveError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string|null>(null)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkStage, setBulkStage] = useState('')
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkEnv, setBulkEnv] = useState<string[]>([])
  const [listEnvFilter, setListEnvFilter] = useState<string[]>([])
  const [bulkEntryDate, setBulkEntryDate] = useState('')
  const [showBulkEnvPicker, setShowBulkEnvPicker] = useState(false)
  const [filterAggiudicati, setFilterAggiudicati] = useState(false)
  const [saleDatePopup, setSaleDatePopup] = useState<{id:string, stage:string, prob:number|null}|null>(null)
  const [saleDateValue, setSaleDateValue] = useState(toYMD(new Date()))
  const last30 = getLast30Days()
  const [listDateFrom, setListDateFrom] = useState(last30.from)
  const [listDateTo, setListDateTo] = useState(last30.to)
  const [listDateActive, setListDateActive] = useState(true)
  const [listSortCol, setListSortCol] = useState<string>('entry_date')
  const [listSortDir, setListSortDir] = useState<'asc'|'desc'>('desc')
  const DEFAULT_COLS = [
    {label:'Data ingresso', col:'entry_date'},
    {label:'Data inserimento', col:'created_at'},
    {label:'Ambiente', col:'environment'},
    {label:'Fase', col:'stage'},
    {label:'Preventivo', col:'estimate'},
    {label:'Probabilità', col:'probability'},
    {label:'Valore ponderato', col:'weighted'},
    {label:'Appuntamento', col:'appointment_date'},
  ]
  const [listCols, setListColsRaw] = useState(() => {
    try {
      const saved = localStorage.getItem('crm_list_cols')
      if (saved) {
        const savedCols: {label:string,col:string}[] = JSON.parse(saved)
        // merge: keep saved order but add any new cols missing
        const allCols = DEFAULT_COLS
        const savedKeys = savedCols.map(c=>c.col)
        const missing = allCols.filter(c=>!savedKeys.includes(c.col))
        return [...savedCols, ...missing]
      }
    } catch {}
    return DEFAULT_COLS
  })
  function setListCols(cols: {label:string,col:string}[]) {
    setListColsRaw(cols)
    try { localStorage.setItem('crm_list_cols', JSON.stringify(cols)) } catch {}
  }
  const [dragColIdx, setDragColIdx] = useState<number|null>(null)
  const [inlineEdit, setInlineEdit] = useState<{id:string,col:string,val:string}|null>(null)
  // Kanban filter
  const monthRange = getCurrentMonthRange()
  const [kanbanVenditaFrom, setKanbanVenditaFrom] = useState(monthRange.from)
  const [kanbanVenditaTo, setKanbanVenditaTo] = useState(monthRange.to)
  // Leads
  const [leads, setLeads] = useState<Deal[]>([])
  const [showLeadForm, setShowLeadForm] = useState(false)
  const [leadForm, setLeadForm] = useState({contact_name:'', phone:'', email:'', origin:''})
  const [convertingLead, setConvertingLead] = useState<Deal|null>(null)
  // Dashboard
  const dashWeek = getRangeForQuick('week')
  const [dateFrom, setDateFrom] = useState(dashWeek.from)
  const [dateTo, setDateTo] = useState(dashWeek.to)

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { window.location.replace('/login'); return }
      setChecked(true); fetchDeals()
    }
    init()
  }, [])

  async function fetchDeals() {
    const { data } = await supabase.from('deals').select('*').eq('is_lead', false).order('created_at', { ascending: false })
    setDeals(data || [])
    const { data: ldata } = await supabase.from('deals').select('*').eq('is_lead', true).order('created_at', { ascending: false })
    setLeads(ldata || [])
  }

  function buildRpcParams(f: typeof emptyDeal, stage?: string) {
    const s = stage || f.stage
    const prob = f.probability ?? getDefaultProb(s)
    return {
      p_title: f.contact_name, p_contact_name: f.contact_name, p_stage: s,
      p_phone: f.phone||null, p_email: f.email||null, p_origin: f.origin||null,
      p_environment: f.environment||null, p_entry_date: f.entry_date||null,
      p_appointment_date: f.appointment_date||null, p_estimate: f.estimate||null,
      p_project_timeline: f.project_timeline||null,
    }
  }

  async function addDeal() {
    if (!form.contact_name) return
    const prob = form.probability ?? getDefaultProb(form.stage)
    const { error } = await supabase.rpc('insert_deal', buildRpcParams(form))
    if (!error) {
      // update probability after insert if needed
      if (prob !== null) {
        const { data } = await supabase.from('deals').select('id').eq('contact_name', form.contact_name).order('created_at', {ascending:false}).limit(1)
        if (data?.[0]) await supabase.from('deals').update({probability: prob}).eq('id', data[0].id)
      }
      setForm(emptyDeal); setShowForm(false); fetchDeals()
    }
  }

  async function addQuickDeal() {
    if (!quickForm.contact_name || !quickAddStage) return
    const prob = getDefaultProb(quickAddStage)
    const { error } = await supabase.rpc('insert_deal', buildRpcParams(quickForm, quickAddStage))
    if (!error) {
      if (prob !== null) {
        const { data } = await supabase.from('deals').select('id').eq('contact_name', quickForm.contact_name).order('created_at', {ascending:false}).limit(1)
        if (data?.[0]) await supabase.from('deals').update({probability: prob}).eq('id', data[0].id)
      }
      setQuickForm(emptyDeal); setQuickAddStage(null); fetchDeals()
    }
  }

  async function addIngresso() {
    if (!ingressoForm.contact_name) return
    const { error } = await supabase.rpc('insert_deal', buildRpcParams(ingressoForm, 'Ingresso'))
    if (!error) {
      setIngressoForm({...emptyDeal, stage:'Ingresso', entry_date:toYMD(new Date())})
      setShowIngressoForm(false); setIsNewContact(false); setSearchQuery(''); setSearchResults([]); fetchDeals()
    }
  }

  async function saveDeal(deal: Deal) {
    setSaveError('')
    if (deal.stage === 'Vendita' && selectedDeal?.stage !== 'Vendita') {
      setSaleDateValue(toYMD(new Date()))
      setSaleDatePopup({id: deal.id, stage: deal.stage, prob: deal.probability ?? 100})
      return
    }
    const prob = deal.probability ?? getDefaultProb(deal.stage)
    const { error } = await supabase.from('deals').update({
      title: deal.contact_name, contact_name: deal.contact_name, phone: deal.phone, email: deal.email,
      origin: deal.origin, environment: deal.environment, entry_date: deal.entry_date||null,
      appointment_date: deal.appointment_date||null, estimate: deal.estimate||0,
      project_timeline: deal.project_timeline, stage: deal.stage, probability: prob,
    }).eq('id', deal.id)
    if (error) { setSaveError('Errore: '+error.message); return }
    setSelectedDeal(null); setEditMode(false); setEditDeal(null); fetchDeals()
  }

  async function searchContacts(q: string) {
    setSearchQuery(q)
    if (q.length < 2) { setSearchResults([]); return }
    const { data } = await supabase.from('deals').select('*').or(`contact_name.ilike.%${q}%,phone.ilike.%${q}%`)
    const unique = data ? data.filter((d,i,arr) => arr.findIndex(x=>x.contact_name===d.contact_name&&x.phone===d.phone)===i) : []
    setSearchResults(unique)
  }

  function selectExistingContact(deal: Deal) {
    setIngressoForm({...emptyDeal, stage:'Ingresso', entry_date:toYMD(new Date()), contact_name:deal.contact_name||'', phone:deal.phone||'', email:deal.email||'', origin:deal.origin||''})
    setSearchQuery(deal.contact_name); setSearchResults([]); setIsNewContact(false)
  }

  async function updateStage(id: string, stage: string, currentProb: number|null) {
    const newProb = (stage === 'Vendita' && currentProb === null) ? 100 : (stage === 'Preventivo' && currentProb === null ? 50 : stage === 'Non convertito' && currentProb === null ? 0 : currentProb)
    await supabase.from('deals').update({stage, probability: newProb}).eq('id', id)
  }

  async function deleteDeal(id: string) {
    await supabase.from('deals').delete().eq('id',id)
    setConfirmDelete(null); setSelectedDeal(null); setEditMode(false); fetchDeals()
  }

  async function onDragEnd(result: DropResult) {
    if (!result.destination) return
    const dealId = result.draggableId; const newStage = result.destination.droppableId
    const deal = deals.find(d=>d.id===dealId)
    const currentP = deal?.probability ?? null
    const newProb = newStage === 'Vendita' && currentP === null ? 100 : newStage === 'Preventivo' && currentP === null ? 50 : newStage === 'Non convertito' && currentP === null ? 0 : currentP
    setDeals(prev => prev.map(d => d.id===dealId ? {...d, stage:newStage, probability:newProb} : d))
    if (newStage === 'Vendita') {
      setSaleDateValue(toYMD(new Date()))
      setSaleDatePopup({id: dealId, stage: newStage, prob: newProb})
    } else {
      await updateStage(dealId, newStage, deal?.probability ?? null)
    }
  }

  function applyQuick(type: QuickRange) {
    setActiveQuick(type)
    if (type!=='alltime') { const range=getRangeForQuick(type); setDateFrom(range.from); setDateTo(range.to) }
  }

  function getFilteredDeals() {
    if (activeQuick==='alltime') return deals.filter(d => !!d.entry_date)
    return deals.filter(d => d.entry_date && d.entry_date>=dateFrom && d.entry_date<=dateTo)
  }

  function getListDeals() {
    let filtered = deals
    if (listDateActive && listDateFrom && listDateTo)
      filtered = filtered.filter(d => { const ds = d.entry_date || d.created_at.split('T')[0]; return ds>=listDateFrom && ds<=listDateTo })
    if (listEnvFilter.length > 0)
      filtered = filtered.filter(d => {
        if (!d.environment) return false
        const envs = d.environment.split(',').map((e:string)=>e.trim())
        return listEnvFilter.some(f => envs.includes(f))
      })
    if (filterAggiudicati) filtered = filtered.filter(d => d.stage === 'Vendita')
    return filtered
  }

  function getGroupedDeals(dealsToGroup: Deal[]) {
    if (groupBy==='none') return {'Tutti': dealsToGroup}
    const grouped: {[key:string]:Deal[]} = {}
    dealsToGroup.forEach(deal => { const key=(deal as any)[groupBy]||'Non specificato'; if(!grouped[key]) grouped[key]=[]; grouped[key].push(deal) })
    return grouped
  }

  function btnClass(type: QuickRange) {
    return `px-3 py-1 rounded-lg text-sm font-medium transition-colors ${activeQuick===type?'bg-blue-600 text-white':'bg-gray-100 hover:bg-gray-200 text-gray-700'}`
  }

  function openDeal(deal: Deal) { setSelectedDeal(deal); setEditDeal({...deal}); setEditMode(false); setSaveError('') }
  function goToDeal(deal: Deal) { window.location.href = `/deal/${deal.id}` }

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const next=new Set(prev); next.has(id)?next.delete(id):next.add(id); return next })
  }
  function toggleSelectAll(dealsToSelect: Deal[]) {
    if (dealsToSelect.every(d=>selectedIds.has(d.id))) setSelectedIds(new Set())
    else setSelectedIds(new Set(dealsToSelect.map(d=>d.id)))
  }

  async function bulkDelete() {
    await supabase.from('deals').delete().in('id', Array.from(selectedIds))
    setSelectedIds(new Set()); setConfirmBulkDelete(false); fetchDeals()
  }
  async function bulkChangeStage() {
    if (!bulkStage) return
    await supabase.from('deals').update({stage:bulkStage}).in('id', Array.from(selectedIds))
    setSelectedIds(new Set()); setBulkStage(''); fetchDeals()
  }
  async function bulkChangeEnv() {
    if (!bulkEnv.length) return
    await supabase.from('deals').update({environment: bulkEnv.join(', ')}).in('id', Array.from(selectedIds))
    setSelectedIds(new Set()); setBulkEnv([]); setShowBulkEnvPicker(false); fetchDeals()
  }
  async function bulkChangeEntryDate() {
    if (!bulkEntryDate) return
    await supabase.from('deals').update({entry_date: bulkEntryDate}).in('id', Array.from(selectedIds))
    setSelectedIds(new Set()); setBulkEntryDate(''); fetchDeals()
  }

  function toggleListSort(col: string) {
    if (listSortCol === col) setListSortDir(d => d==="asc"?"desc":"asc")
    else { setListSortCol(col); setListSortDir("asc") }
  }
  function sortDeals(arr: Deal[]) {
    return [...arr].sort((a, b) => {
      let va: any = (a as any)[listSortCol] ?? ""
      let vb: any = (b as any)[listSortCol] ?? ""
      if (listSortCol === "estimate" || listSortCol === "probability") { va = Number(va)||0; vb = Number(vb)||0 }
      if (va < vb) return listSortDir==="asc" ? -1 : 1
      if (va > vb) return listSortDir==="asc" ? 1 : -1
      return 0
    })
  }

  async function saveInlineEdit() {
    if (!inlineEdit) return
    const {id, col, val} = inlineEdit
    let updateVal: any = val
    if (col==='estimate' || col==='probability') updateVal = Number(val)||null
    if ((col==='entry_date'||col==='appointment_date') && val==='') updateVal = null
    await supabase.from('deals').update({[col]: updateVal, ...(col==='contact_name'?{title:val}:{})}).eq('id', id)
    setInlineEdit(null); fetchDeals()
  }

  if (!checked) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">Verifica accesso...</p></div>

  const filteredDeals = getFilteredDeals()
  const listDeals = sortDeals(getListDeals())

  // Kanban: Vendita filtered by date, others all
  const kanbanDeals = (stage: string) => {
    if (stage === 'Vendita') {
      return deals.filter(d => {
        if (d.stage !== 'Vendita') return false
        const ds = d.entry_date || d.created_at.split('T')[0]
        return ds >= kanbanVenditaFrom && ds <= kanbanVenditaTo
      })
    }
    return deals.filter(d => d.stage === stage)
  }

  async function confirmSaleDate() {
    if (!saleDatePopup) return
    const {id, stage, prob} = saleDatePopup
    await supabase.from('deals').update({stage, probability: prob ?? 100, entry_date: saleDateValue}).eq('id', id)
    setSaleDatePopup(null); fetchDeals()
    setSelectedDeal(null); setEditMode(false); setEditDeal(null)
  }

  function downloadCSV() {
    const headers = ['Contatto', ...listCols.map(c => c.label)]
    const rows = listDeals.map(deal => {
      const base = [deal.contact_name || '']
      const cols = listCols.map(({col}) => {
        const rawVal: any = (deal as any)[col]
        if (col === 'entry_date' || col === 'appointment_date') return rawVal ? formatDate(rawVal) : ''
        if (col === 'created_at') return rawVal ? formatDate(rawVal.split('T')[0]) : ''
        if (col === 'estimate') return rawVal > 0 ? rawVal : ''
        if (col === 'probability') return rawVal != null ? `${rawVal}%` : ''
        if (col === 'weighted') {
          const w = deal.estimate && deal.probability != null ? Math.round(deal.estimate * deal.probability / 100) : null
          return w != null && w > 0 ? w : ''
        }
        return rawVal || ''
      })
      return [...base, ...cols]
    })
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const bom = '\uFEFF'
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `contatti_${toYMD(new Date())}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const BulkActionBar = ({ dealsInView }: { dealsInView: Deal[] }) => (
    selectedIds.size > 0 ? (
      <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-blue-700 font-semibold">{selectedIds.size} selezionati</span>
          <select className="border rounded-lg p-2 text-sm ml-2" value={bulkStage} onChange={e=>setBulkStage(e.target.value)}>
            <option value="">Cambia fase...</option>
            {STAGES.map(s=><option key={s}>{s}</option>)}
          </select>
          {bulkStage && <button onClick={bulkChangeStage} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700">Applica fase</button>}
          <div className="w-px h-6 bg-blue-200 mx-1" />
          <div className="relative">
            <button onClick={()=>setShowBulkEnvPicker(p=>!p)} className="border rounded-lg px-3 py-2 text-sm bg-white hover:bg-gray-50 flex items-center gap-1">
              {bulkEnv.length>0 ? <span className="text-blue-700 font-medium">{bulkEnv.join(', ')}</span> : <span className="text-gray-500">Cambia ambiente...</span>}
              <span className="text-gray-400 text-xs ml-1">▾</span>
            </button>
            {showBulkEnvPicker && (
              <div className="absolute top-full left-0 mt-1 bg-white border rounded-xl shadow-lg p-3 z-20" style={{minWidth:'240px'}}>
                <p className="text-xs text-gray-500 mb-2 font-semibold">Seleziona ambienti:</p>
                <div className="flex flex-wrap gap-1 mb-3">
                  {ENVIRONMENTS.map(env=>{
                    const active = bulkEnv.includes(env)
                    return <button key={env} type="button" onClick={()=>setBulkEnv(prev=>active?prev.filter(e=>e!==env):[...prev,env])}
                      className={`px-2 py-1 rounded-full text-xs border transition-colors ${active?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>{env}</button>
                  })}
                </div>
                <div className="flex gap-1 justify-end border-t pt-2">
                  <button onClick={()=>{setShowBulkEnvPicker(false);setBulkEnv([])}} className="text-xs text-gray-500 px-2 py-1 hover:text-gray-700">Annulla</button>
                  {bulkEnv.length>0 && <button onClick={bulkChangeEnv} className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">Applica</button>}
                </div>
              </div>
            )}
          </div>
          <div className="w-px h-6 bg-blue-200 mx-1" />
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-600">Data ingresso:</span>
            <input type="date" className="border rounded-lg p-2 text-sm bg-white" value={bulkEntryDate} onChange={e=>setBulkEntryDate(e.target.value)} />
            {bulkEntryDate && <button onClick={bulkChangeEntryDate} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700">Applica</button>}
          </div>
          <div className="w-px h-6 bg-blue-200 mx-1" />
          <button onClick={()=>setConfirmBulkDelete(true)} className="bg-red-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-red-600">Elimina</button>
          <button onClick={()=>{setSelectedIds(new Set());setBulkStage('');setBulkEnv([]);setBulkEntryDate('');setShowBulkEnvPicker(false)}} className="bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-300 ml-auto">Deseleziona tutto</button>
        </div>
      </div>
    ) : null
  )

  // ---- DASHBOARD CALCS ----
  const ingressiPeriod = filteredDeals.filter(d => ['Ingresso','Preventivo','Vendita'].includes(d.stage))
  const vendite = deals.filter(d => d.stage === 'Vendita')
  const preventivi = deals.filter(d => d.stage === 'Preventivo')
  const prevConValore = deals.filter(d => d.estimate > 0)
  const venditeCerte = vendite.reduce((s,d)=>s+(d.estimate||0),0)
  const pipelineWeighted = deals
    .filter(d=>d.probability!=null && d.probability>0)
    .reduce((s,d)=>s+(d.estimate||0)*(d.probability||0)/100, 0)
  const pipelineTotal = deals.filter(d=>d.probability!=null && d.probability>0).reduce((s,d)=>s+(d.estimate||0)*(d.probability||0)/100,0)
  const ingressiCount = filteredDeals.length
  const ingressiStage = deals.filter(d => d.stage === 'Ingresso')
  const tuttiIngressi = deals.filter(d => !!d.entry_date)
  const totaleVenduto = vendite.reduce((s,d)=>s+(d.estimate||0),0)
  const avgIngresso = tuttiIngressi.length > 0 ? Math.round(totaleVenduto/tuttiIngressi.length) : 0
  const avgVendita = vendite.length > 0 ? Math.round(vendite.reduce((s,d)=>s+(d.estimate||0),0)/vendite.length) : 0
  const avgPreventivo = prevConValore.length > 0 ? Math.round(prevConValore.reduce((s,d)=>s+(d.estimate||0),0)/prevConValore.length) : 0
  const tuttiConPreventivo = deals.filter(d => d.stage === 'Preventivo' || d.stage === 'Vendita')
  const tassoConvIngresso = tuttiIngressi.length > 0 ? Math.round((vendite.length/tuttiIngressi.length)*100) : 0
  const tassoConvPreventivo = tuttiConPreventivo.length > 0 ? Math.round((vendite.length/tuttiConPreventivo.length)*100) : 0

  // Daily chart data
  const dayMap: Record<string,number> = {}
  filteredDeals.forEach(d => {
    const day = d.entry_date || d.created_at.split('T')[0]
    dayMap[day] = (dayMap[day]||0) + 1
  })
  const days = Object.keys(dayMap).sort()
  const maxDay = Math.max(...days.map(d => dayMap[d]), 1)

  // Pie: ambienti per valore venduto
  const envSoldMap: Record<string,number> = {}
  const envPipeMap: Record<string,number> = {}
  const envCountMap: Record<string,number> = {}
  deals.forEach(d => {
    const envs = d.environment ? d.environment.split(',').map((e:string)=>e.trim()).filter(Boolean) : ['Non specificato']
    envs.forEach(env => {
      if (d.stage==='Vendita') envSoldMap[env] = (envSoldMap[env]||0) + (d.estimate||0)
      if (d.probability != null) envPipeMap[env] = (envPipeMap[env]||0) + (d.estimate||0)*(d.probability||0)/100
      envCountMap[env] = (envCountMap[env]||0) + 1
    })
  })
  const envKeys = [...new Set([...Object.keys(envSoldMap),...Object.keys(envPipeMap),...Object.keys(envCountMap)])]
  const envSoldData = envKeys.map((k,i)=>({label:k,value:envSoldMap[k]||0,color:PIE_COLORS[i%PIE_COLORS.length]}))
  const envPipeData = envKeys.map((k,i)=>({label:k,value:envPipeMap[k]||0,color:PIE_COLORS[i%PIE_COLORS.length]}))
  const envCountData = envKeys.map((k,i)=>({label:k,value:envCountMap[k]||0,color:PIE_COLORS[i%PIE_COLORS.length]}))

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-gray-800">PENSARE CASA C.so Regina</h1>
        <div className="flex gap-2 items-center">
          <button onClick={()=>setView('leads')} className={`px-3 py-2 text-sm rounded-lg border mr-3 ${view==='leads'?'bg-purple-600 text-white border-purple-600':'bg-white text-purple-600 border-purple-300 hover:bg-purple-50'}`}>Lead</button>
          <div className="flex border rounded-lg overflow-hidden mr-2">
            <button onClick={()=>setView('kanban')} className={`px-3 py-2 text-sm ${view==='kanban'?'bg-blue-600 text-white':'bg-white text-gray-600'}`}>Kanban</button>
            <button onClick={()=>setView('list')} className={`px-3 py-2 text-sm ${view==='list'?'bg-blue-600 text-white':'bg-white text-gray-600'}`}>Lista</button>
            <button onClick={()=>setView('dashboard')} className={`px-3 py-2 text-sm ${view==='dashboard'?'bg-blue-600 text-white':'bg-white text-gray-600'}`}>Dashboard</button>
          </div>
          {view==='leads' && <button onClick={()=>setShowLeadForm(true)} className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">+ Nuovo Lead</button>}
          {view!=='leads' && <button onClick={()=>setShowIngressoForm(true)} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">+ Nuovo Ingresso</button>}
          {view!=='leads' && <button onClick={()=>setShowForm(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">+ Nuovo Affare</button>}
          <button onClick={()=>setConfirmLogout(true)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Esci</button>
        </div>
      </div>

      {/* KANBAN */}
      {view==='kanban' && (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="p-4 pb-0">
            <div className="bg-white rounded-xl shadow px-4 py-3 flex items-center gap-3 text-sm flex-wrap">
              <span className="font-semibold text-gray-600">Colonna Vendita — periodo:</span>
              <input type="date" className="border rounded-lg p-1.5 text-sm" value={kanbanVenditaFrom} onChange={e=>setKanbanVenditaFrom(e.target.value)} />
              <span className="text-gray-400">→</span>
              <input type="date" className="border rounded-lg p-1.5 text-sm" value={kanbanVenditaTo} onChange={e=>setKanbanVenditaTo(e.target.value)} />
              <button onClick={()=>{const r=getCurrentMonthRange();setKanbanVenditaFrom(r.from);setKanbanVenditaTo(r.to)}} className="text-xs text-blue-600 underline">Mese corrente</button>
            </div>
          </div>
          <div className="overflow-x-auto p-4">
            <div className="flex gap-4" style={{minWidth:'max-content'}}>
              {STAGES.map(stage => {
                const stageDeals = kanbanDeals(stage)
                const total = stageDeals.reduce((sum,d)=>sum+(d.estimate||0),0)
                const weighted = stageDeals.reduce((sum,d)=>sum+(d.estimate||0)*(d.probability||0)/100,0)
                return (
                  <Droppable droppableId={stage} key={stage}>
                    {(provided,snapshot) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className={`rounded-xl p-3 w-64 flex flex-col ${snapshot.isDraggingOver?'bg-blue-100':'bg-gray-200'}`}>
                        <h2 className="font-semibold text-gray-700 text-sm">{stage}</h2>
                        <p className="text-xs text-gray-500">{stageDeals.length} affari</p>
                        {total>0 && <p className="text-xs text-green-700 font-semibold">€ {total.toLocaleString()}</p>}
                        {weighted>0 && weighted!==total && <p className="text-xs text-blue-600">pond. € {Math.round(weighted).toLocaleString()}</p>}
                        <div className="flex flex-col gap-2 mt-2 flex-1">
                          {stageDeals.map((deal,index) => (
                            <Draggable key={deal.id} draggableId={deal.id} index={index}>
                              {(provided,snapshot) => (
                                <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}
                                  onClick={()=>goToDeal(deal)}
                                  className={`bg-white rounded-lg p-3 cursor-pointer ${snapshot.isDragging?'shadow-xl rotate-1':'shadow hover:shadow-md'}`}>
                                  <p className="font-semibold text-sm text-gray-800">{deal.contact_name||deal.title}</p>
                                  {deal.estimate>0 && <p className="text-xs text-green-600 mt-0.5">€ {deal.estimate.toLocaleString()}</p>}
                                  {deal.appointment_date && <p className="text-xs text-orange-500">📅 {formatDate(deal.appointment_date)}</p>}
                                  {deal.environment && <p className="text-xs text-blue-500">{deal.environment}</p>}
                                  {deal.probability !== null && deal.probability !== undefined && (
                                    <span className={`inline-block mt-1 text-xs px-1.5 py-0.5 rounded-full font-medium ${PROB_COLORS[deal.probability]||'bg-gray-100 text-gray-600'}`}>{deal.probability}%</span>
                                  )}
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                        <button onClick={()=>{setQuickAddStage(stage);setQuickForm({...emptyDeal,stage})}}
                          className="mt-3 w-full flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-white rounded-lg py-1 text-sm transition-colors">
                          <span className="text-lg leading-none">+</span>
                        </button>
                      </div>
                    )}
                  </Droppable>
                )
              })}
            </div>
          </div>
        </DragDropContext>
      )}

      {/* LIST */}
      {view==='list' && (
        <div className="p-6">
          <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-semibold text-gray-700">Raggruppa per:</label>
              <select className="border rounded-lg p-2 text-sm" value={groupBy} onChange={e=>setGroupBy(e.target.value)}>
                <option value="none">Nessuno</option>
                <option value="stage">Fase</option>
                <option value="origin">Origine</option>
                <option value="environment">Ambiente</option>
                <option value="project_timeline">Tempi progettuali</option>
              </select>
            </div>
            <div className="w-px h-6 bg-gray-200 mx-1" />
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-sm font-semibold text-gray-700">Periodo:</label>
              <input type="date" className="border rounded-lg p-2 text-sm" value={listDateFrom} onChange={e=>{setListDateFrom(e.target.value);setListDateActive(true)}} />
              <span className="text-gray-400">→</span>
              <input type="date" className="border rounded-lg p-2 text-sm" value={listDateTo} onChange={e=>{setListDateTo(e.target.value);setListDateActive(true)}} />
              {listDateActive && <button onClick={()=>setListDateActive(false)} className="text-xs text-gray-500 underline hover:text-gray-700">Mostra tutti</button>}
              {!listDateActive && <button onClick={()=>{const r=getLast30Days();setListDateFrom(r.from);setListDateTo(r.to);setListDateActive(true)}} className="text-xs text-blue-600 underline hover:text-blue-800">Ultimi 30 giorni</button>}
            </div>
            <div className="w-px h-6 bg-gray-200 mx-1" />
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-sm font-semibold text-gray-700">Ambiente:</label>
              {ENVIRONMENTS.map(env=>{
                const active = listEnvFilter.includes(env)
                return <button key={env} type="button" onClick={()=>setListEnvFilter(prev=>active?prev.filter(e=>e!==env):[...prev,env])}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${active?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>{env}</button>
              })}
              {listEnvFilter.length>0 && <button onClick={()=>setListEnvFilter([])} className="text-xs text-gray-400 underline hover:text-gray-600">Rimuovi filtro</button>}
            </div>
            <div className="w-px h-6 bg-gray-200 mx-1" />
            <button onClick={()=>setFilterAggiudicati(p=>!p)}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${filterAggiudicati?'bg-green-600 text-white border-green-600':'bg-white text-gray-600 border-gray-300 hover:border-green-400'}`}>
              🏆 Aggiudicati
            </button>
            <div className="flex items-center gap-3 ml-auto">
              <span className="text-xs text-gray-400">{listDeals.length} contatti</span>
              <button onClick={downloadCSV} className="flex items-center gap-1.5 bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-900 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download CSV
              </button>
            </div>
          </div>
          <BulkActionBar dealsInView={listDeals} />
          {Object.entries(getGroupedDeals(listDeals)).map(([group,groupDeals]) => (
            <div key={group} className="mb-6">
              {groupBy!=='none' && <h2 className="font-bold text-gray-700 mb-2">{group} <span className="text-gray-400 font-normal text-sm">({groupDeals.length})</span></h2>}
              <div className="bg-white rounded-xl shadow overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="p-3 w-8"><input type="checkbox" onChange={()=>toggleSelectAll(groupDeals)} checked={groupDeals.length>0&&groupDeals.every(d=>selectedIds.has(d.id))} /></th>
                      <th className="text-left p-3 font-semibold cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap" onClick={()=>toggleListSort('contact_name')}>
                        Contatto {listSortCol==='contact_name'?(listSortDir==='asc'?'↑':'↓'):<span className="text-gray-300">↕</span>}
                      </th>
                      {listCols.map(({label,col},idx)=>(
                        <th key={col} draggable onDragStart={()=>setDragColIdx(idx)} onDragOver={e=>e.preventDefault()}
                          onDrop={()=>{if(dragColIdx===null||dragColIdx===idx)return;const next=[...listCols];const [moved]=next.splice(dragColIdx,1);next.splice(idx,0,moved);setListCols(next);setDragColIdx(null)}}
                          onDragEnd={()=>setDragColIdx(null)}
                          className={`text-left p-3 cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap ${dragColIdx===idx?'opacity-40':''}`}
                          onClick={()=>toggleListSort(col)}>
                          <span className="inline-flex items-center gap-1">
                            <span className="text-gray-300 cursor-grab text-xs mr-1">⠿</span>
                            {label} {listSortCol===col?(listSortDir==='asc'?'↑':'↓'):<span className="text-gray-300">↕</span>}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupDeals.map(deal => (
                      <tr key={deal.id} className={`border-t hover:bg-gray-50 ${selectedIds.has(deal.id)?'bg-blue-50':''}`}>
                        <td className="p-3" onClick={e=>{e.stopPropagation();toggleSelect(deal.id)}}><input type="checkbox" checked={selectedIds.has(deal.id)} onChange={()=>toggleSelect(deal.id)} /></td>
                        <td className="p-3 font-medium whitespace-nowrap">
                          {inlineEdit?.id===deal.id&&inlineEdit.col==='contact_name'?(
                            <input autoFocus className="border rounded px-2 py-1 text-sm w-36 font-medium" value={inlineEdit.val}
                              onChange={e=>setInlineEdit({...inlineEdit,val:e.target.value})} onBlur={saveInlineEdit}
                              onKeyDown={e=>{if(e.key==='Enter')saveInlineEdit();if(e.key==='Escape')setInlineEdit(null)}} onClick={e=>e.stopPropagation()} />
                          ):(
                            <span className="cursor-pointer hover:text-blue-600 hover:underline rounded px-1 py-0.5" onClick={()=>goToDeal(deal)}>{deal.contact_name||<span className="text-gray-300 italic">—</span>}</span>
                          )}
                        </td>
                        {listCols.map(({col})=>{
                          const readonly = col==='created_at' || col==='weighted'
                          const rawVal: any = (deal as any)[col]
                          let display: any = rawVal
                          if(col==='entry_date'||col==='appointment_date') display=formatDate(rawVal||'')
                          else if(col==='created_at') display=formatDate((rawVal||'').split('T')[0])
                          else if(col==='estimate') display=Number(rawVal)>0?`€ ${Number(rawVal).toLocaleString()}`:'-'
                          else if(col==='probability') display=rawVal!=null?`${rawVal}%`:'-'
                          else if(col==='weighted') { const w=deal.estimate&&deal.probability!=null?Math.round(deal.estimate*deal.probability/100):null; display=w!=null&&w>0?`€ ${w.toLocaleString()}`:'-' }
                          else display=rawVal||'-'
                          const isEditing = inlineEdit?.id===deal.id&&inlineEdit.col===col
                          const editVal = inlineEdit?.val??''
                          const isVendita = deal.stage==='Vendita'
                          const probReadonly = false
                          return (
                            <td key={col} className={`p-3 whitespace-nowrap relative ${readonly?'text-gray-400':col==='estimate'||col==='weighted'?'text-green-600':col==='stage'?'':col==='probability'?'':col==='created_at'||col==='entry_date'||col==='appointment_date'?'text-gray-500':'text-gray-600'} ${readonly?'cursor-default':'cursor-text'}`}
                              onClick={e=>{
                                e.stopPropagation()
                                if(readonly||probReadonly) return
                                const current = col==='entry_date'||col==='appointment_date'?rawVal||'':col==='estimate'||col==='probability'?String(rawVal||''):rawVal||''
                                setInlineEdit({id:deal.id,col,val:current})
                              }}>
                              {isEditing?(
                                col==='stage'?(
                                  <select autoFocus className="border rounded px-2 py-1 text-xs" value={editVal}
                                    onChange={e=>setInlineEdit({...inlineEdit!,val:e.target.value})} onBlur={saveInlineEdit}
                                    onKeyDown={e=>{if(e.key==='Escape')setInlineEdit(null)}} onClick={e=>e.stopPropagation()}>
                                    {STAGES.map(s=><option key={s}>{s}</option>)}
                                  </select>
                                ):col==='probability'?(
                                  <select autoFocus className="border rounded px-2 py-1 text-xs" value={editVal}
                                    onChange={e=>setInlineEdit({...inlineEdit!,val:e.target.value})} onBlur={saveInlineEdit}
                                    onKeyDown={e=>{if(e.key==='Escape')setInlineEdit(null)}} onClick={e=>e.stopPropagation()}>
                                    <option value="">—</option>
                                    {PROB_OPTIONS.map(p=><option key={p} value={p}>{p}%</option>)}
                                  </select>
                                ):col==='entry_date'||col==='appointment_date'?(
                                  <input autoFocus type="date" className="border rounded px-2 py-1 text-sm" value={editVal}
                                    onChange={e=>setInlineEdit({...inlineEdit!,val:e.target.value})} onBlur={saveInlineEdit}
                                    onKeyDown={e=>{if(e.key==='Enter')saveInlineEdit();if(e.key==='Escape')setInlineEdit(null)}} onClick={e=>e.stopPropagation()} />
                                ):col==='estimate'?(
                                  <input autoFocus type="number" className="border rounded px-2 py-1 text-sm w-28" value={editVal}
                                    onChange={e=>setInlineEdit({...inlineEdit!,val:e.target.value})} onBlur={saveInlineEdit}
                                    onKeyDown={e=>{if(e.key==='Enter')saveInlineEdit();if(e.key==='Escape')setInlineEdit(null)}} onClick={e=>e.stopPropagation()} />
                                ):col==='environment'?(
                                  <div className="flex flex-wrap gap-1 bg-white border rounded-lg p-2 shadow-lg z-10 absolute" onClick={e=>e.stopPropagation()} style={{minWidth:'220px'}}>
                                    {ENVIRONMENTS.map(env=>{
                                      const sel=editVal.split(',').map((s:string)=>s.trim()).filter(Boolean)
                                      const active=sel.includes(env)
                                      return <button key={env} type="button" className={`px-2 py-1 rounded-full text-xs border transition-colors ${active?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}
                                        onClick={e=>{e.stopPropagation();const next=active?sel.filter((x:string)=>x!==env):[...sel,env];setInlineEdit({...inlineEdit!,val:next.join(', ')})}}>{env}</button>
                                    })}
                                    <div className="w-full flex justify-end gap-1 mt-1 pt-1 border-t">
                                      <button className="text-xs text-gray-500 px-2 py-1 hover:text-gray-700" onClick={e=>{e.stopPropagation();setInlineEdit(null)}}>Annulla</button>
                                      <button className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700" onClick={e=>{e.stopPropagation();saveInlineEdit()}}>OK</button>
                                    </div>
                                  </div>
                                ):(
                                  <input autoFocus className="border rounded px-2 py-1 text-sm w-32" value={editVal}
                                    onChange={e=>setInlineEdit({...inlineEdit!,val:e.target.value})} onBlur={saveInlineEdit}
                                    onKeyDown={e=>{if(e.key==='Enter')saveInlineEdit();if(e.key==='Escape')setInlineEdit(null)}} onClick={e=>e.stopPropagation()} />
                                )
                              ):(
                                col==='stage'?<span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs hover:bg-blue-200">{display}</span>
                                :col==='probability'&&rawVal!=null?<span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PROB_COLORS[rawVal]||'bg-gray-100 text-gray-600'}`}>{display}</span>
                                :<span className={`rounded px-1 py-0.5 ${readonly||probReadonly?'':'hover:bg-blue-50'}`}>{display}</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {groupDeals.length===0 && <p className="text-center text-gray-400 py-8">Nessun contatto nel periodo selezionato</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DASHBOARD */}
      {view==='dashboard' && (
        <div className="p-6">
          {/* Filtro periodo */}
          <div className="bg-white rounded-xl shadow p-4 mb-6">
            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={()=>applyQuick('today')} className={btnClass('today')}>Oggi</button>
              <button onClick={()=>applyQuick('week')} className={btnClass('week')}>Questa settimana</button>
              <button onClick={()=>applyQuick('month')} className={btnClass('month')}>Questo mese</button>
              <button onClick={()=>applyQuick('lastmonth')} className={btnClass('lastmonth')}>Scorso mese</button>
              <button onClick={()=>applyQuick('alltime')} className={btnClass('alltime')}>Dall'inizio</button>
              {activeQuick!=='alltime' && (
                <div className="flex items-center gap-2 ml-2">
                  <input type="date" className="border rounded-lg p-2 text-sm" value={dateFrom} onChange={e=>{setActiveQuick('custom');setDateFrom(e.target.value)}} />
                  <span className="text-gray-500">→</span>
                  <input type="date" className="border rounded-lg p-2 text-sm" value={dateTo} onChange={e=>{setActiveQuick('custom');setDateTo(e.target.value)}} />
                </div>
              )}
            </div>
          </div>

          {/* KPI principali */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow p-5 border-l-4 border-green-500">
              <p className="text-gray-500 text-sm font-medium">Vendite certe (100%)</p>
              <p className="text-3xl font-bold text-green-600 mt-1">€ {venditeCerte.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">{vendite.length} vendite</p>
            </div>
            <div className="bg-white rounded-xl shadow p-5 border-l-4 border-blue-500">
              <p className="text-gray-500 text-sm font-medium">Pipeline ponderata</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">€ {Math.round(pipelineTotal).toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">vendite + preventivi × probabilità</p>
            </div>
          </div>

          {/* Grafico ingressi per giorno + KPI secondari */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {/* Grafico */}
            <div className="col-span-2 bg-white rounded-xl shadow p-5">
              <p className="font-semibold text-gray-700 mb-4">Ingressi per giorno</p>
              {days.length === 0 ? <p className="text-gray-400 text-sm">Nessun dato nel periodo</p> : (
                <div className="flex items-end gap-1" style={{height:'120px'}}>
                  {days.map(day => {
                    const count = dayMap[day]
                    const parts = day.split('-')
                    const label = `${parts[2]}/${parts[1]}`
                    return (
                      <div key={day} className="flex flex-col items-center flex-1 min-w-0" title={`${formatDate(day)}: ${count} ingressi`}>
                        <div className="w-full flex flex-col justify-end" style={{height:'100px'}}>
                          <div style={{height:`${Math.round((count/maxDay)*100)}px`}} className="bg-blue-400 w-full rounded-t-sm"/>
                        </div>
                        <span className="text-gray-400 mt-1 truncate w-full text-center" style={{fontSize:'9px'}}>{label}</span>
                      </div>
                    )
                  })}
                </div>
              )}

            </div>
            {/* KPI secondari */}
            <div className="flex flex-col gap-3">
              <div className="bg-white rounded-xl shadow p-4">
                <p className="text-xs text-gray-500">N° ingressi periodo</p>
                <p className="text-2xl font-bold text-gray-800">{ingressiCount}</p>
              </div>
              <div className="bg-white rounded-xl shadow p-4">
                <p className="text-xs text-gray-500">Valore medio ingresso</p>
                <p className="text-2xl font-bold text-gray-800">€ {avgIngresso.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-xl shadow p-4">
                <p className="text-xs text-gray-500">Valore medio vendita</p>
                <p className="text-2xl font-bold text-green-600">€ {avgVendita.toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* KPI conversione */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow p-4">
              <p className="text-xs text-gray-500">Valore medio preventivo</p>
              <p className="text-2xl font-bold text-blue-600">€ {avgPreventivo.toLocaleString()}</p>
              <p className="text-xs text-gray-400">{preventivi.length} preventivi</p>
            </div>
            <div className="bg-white rounded-xl shadow p-4">
              <p className="text-xs text-gray-500">Tasso conv. all'ingresso</p>
              <p className="text-2xl font-bold text-purple-600">{tassoConvIngresso}%</p>
              <p className="text-xs text-gray-400">vendite / contatti con data ingresso</p>
            </div>
            <div className="bg-white rounded-xl shadow p-4">
              <p className="text-xs text-gray-500">Tasso conv. al preventivo</p>
              <p className="text-2xl font-bold text-orange-500">{tassoConvPreventivo}%</p>
              <p className="text-xs text-gray-400">vendite / (preventivi + vendite)</p>
            </div>
          </div>

          {/* Torte ambienti */}
          <div className="grid grid-cols-2 gap-4">
            {[
              {title:'Valore venduto per ambiente', data:envSoldData, fmt:(v:number)=>`€ ${v.toLocaleString()}`},
              {title:'Ingressi per ambiente', data:envCountData, fmt:(v:number)=>`${v}`},
            ].map(({title,data,fmt})=>(
              <div key={title} className="bg-white rounded-xl shadow p-5">
                <p className="font-semibold text-gray-700 text-sm mb-4">{title}</p>
                <div className="flex items-center gap-4">
                  <PieChart data={data} size={140}/>
                  <div className="flex flex-col gap-1.5 text-xs flex-1 min-w-0">
                    {data.filter(d=>d.value>0).map(d=>(
                      <div key={d.label} className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:d.color}}/>
                        <span className="text-gray-600 truncate">{d.label}</span>
                        <span className="text-gray-400 ml-auto flex-shrink-0">{fmt(d.value)}</span>
                      </div>
                    ))}
                    {data.every(d=>d.value===0) && <p className="text-gray-400">Nessun dato</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LEADS */}
      {view==='leads' && (
        <div className="p-6">
          <div className="flex gap-4 overflow-x-auto pb-4">
            {(['Nuovo','Contattato','Qualificato','Non Qualificato'] as const).map(stage => {
              const stageLeads = leads.filter(l => (l.lead_stage || 'Nuovo') === stage)
              const isQualificato = stage === 'Qualificato'
              return (
                <div key={stage} className="flex-shrink-0 w-72">
                  <div className={`rounded-t-xl px-4 py-3 flex items-center justify-between ${
                    stage==='Nuovo' ? 'bg-gray-700' :
                    stage==='Contattato' ? 'bg-blue-600' :
                    stage==='Qualificato' ? 'bg-green-600' :
                    'bg-red-500'
                  }`}>
                    <span className="text-white font-semibold text-sm">{stage}</span>
                    <span className="bg-white bg-opacity-20 text-white text-xs px-2 py-0.5 rounded-full">{stageLeads.length}</span>
                  </div>
                  <div className="bg-gray-100 rounded-b-xl p-2 flex flex-col gap-2 min-h-32"
                    onDragOver={e=>e.preventDefault()}
                    onDrop={async e=>{e.preventDefault(); const id=e.dataTransfer.getData('leadId'); if(id){ await supabase.from('deals').update({lead_stage:stage}).eq('id',id); fetchDeals()}}}>
                    {stageLeads.map(lead => (
                      <div key={lead.id}
                        draggable
                        onDragStart={e=>{e.dataTransfer.setData('leadId',lead.id)}}
                        className="bg-white rounded-lg p-3 shadow hover:shadow-md cursor-grab active:cursor-grabbing group relative"
                        onClick={() => goToDeal(lead)}>
                        <p className="font-semibold text-sm text-gray-800">{lead.contact_name}</p>
                        {lead.phone && <p className="text-xs text-gray-500 mt-0.5">{lead.phone}</p>}
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                          {lead.origin && <p className="text-xs text-blue-400">{lead.origin}</p>}
                          {lead.environment && <p className="text-xs text-green-600">{lead.environment}</p>}
                        </div>
                        <p className="text-xs text-gray-400 mt-1">{formatDate(lead.created_at.split('T')[0])}</p>
                        {isQualificato && (
                          <button onClick={e=>{e.stopPropagation(); setConvertingLead(lead)}}
                            className="mt-2 w-full text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white">⇒ Converti in Pipeline</button>
                        )}
                      </div>
                    ))}
                    <button onClick={()=>setShowLeadForm(true)}
                      className="text-xs text-gray-400 hover:text-gray-600 py-2 text-center border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 transition-colors">
                      + Aggiungi lead
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modal Nuovo Affare */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-screen overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Nuovo Affare</h2>
            <div className="flex flex-col gap-3">
              <input className="border rounded-lg p-2" placeholder="Nome contatto *" value={form.contact_name} onChange={e=>setForm({...form,contact_name:e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Telefono" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Origine (es. Meta Ads)" value={form.origin} onChange={e=>setForm({...form,origin:e.target.value})} />
              <label className="text-xs text-gray-500">Ambiente</label>
              <EnvSelect value={form.environment} onChange={v=>setForm({...form,environment:v})} />
              <label className="text-xs text-gray-500">Data ingresso</label>
              <input className="border rounded-lg p-2" type="date" value={form.entry_date} onChange={e=>setForm({...form,entry_date:e.target.value})} />
              <label className="text-xs text-gray-500">Data appuntamento</label>
              <input className="border rounded-lg p-2" type="date" value={form.appointment_date} onChange={e=>setForm({...form,appointment_date:e.target.value})} />
              <input className="border rounded-lg p-2" type="number" placeholder="Preventivo (€)" value={form.estimate||''} onChange={e=>setForm({...form,estimate:Number(e.target.value)})} />
              <input className="border rounded-lg p-2" placeholder="Tempi progettuali" value={form.project_timeline} onChange={e=>setForm({...form,project_timeline:e.target.value})} />
              <select className="border rounded-lg p-2" value={form.stage} onChange={e=>setForm({...form,stage:e.target.value})}>
                {STAGES.map(s=><option key={s}>{s}</option>)}
              </select>
              {(form.stage==='Preventivo'||form.stage==='Vendita') && (
                <div>
                  <label className="text-xs text-gray-500">Probabilità</label>
                  <select className="border rounded-lg p-2 w-full mt-1" value={form.probability??''} onChange={e=>setForm({...form,probability:e.target.value?Number(e.target.value):null})} disabled={form.stage==='Vendita'}>
                    {form.stage==='Vendita' ? <option value={100}>100%</option> : PROB_OPTIONS.map(p=><option key={p} value={p}>{p}%</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={addDeal} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Salva</button>
              <button onClick={()=>setShowForm(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Quick Add */}
      {quickAddStage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-screen overflow-y-auto">
            <h2 className="text-xl font-bold mb-1">Nuovo contatto</h2>
            <p className="text-sm text-blue-600 mb-4 font-medium">Fase: {quickAddStage}</p>
            <div className="flex flex-col gap-3">
              <input className="border rounded-lg p-2" placeholder="Nome contatto *" value={quickForm.contact_name} onChange={e=>setQuickForm({...quickForm,contact_name:e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Telefono" value={quickForm.phone} onChange={e=>setQuickForm({...quickForm,phone:e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Email" value={quickForm.email} onChange={e=>setQuickForm({...quickForm,email:e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Origine" value={quickForm.origin} onChange={e=>setQuickForm({...quickForm,origin:e.target.value})} />
              <label className="text-xs text-gray-500">Ambiente</label>
              <EnvSelect value={quickForm.environment} onChange={v=>setQuickForm({...quickForm,environment:v})} />
              <label className="text-xs text-gray-500">Data ingresso</label>
              <input className="border rounded-lg p-2" type="date" value={quickForm.entry_date} onChange={e=>setQuickForm({...quickForm,entry_date:e.target.value})} />
              <label className="text-xs text-gray-500">Data appuntamento</label>
              <input className="border rounded-lg p-2" type="date" value={quickForm.appointment_date} onChange={e=>setQuickForm({...quickForm,appointment_date:e.target.value})} />
              <input className="border rounded-lg p-2" type="number" placeholder="Preventivo (€)" value={quickForm.estimate||''} onChange={e=>setQuickForm({...quickForm,estimate:Number(e.target.value)})} />
              <input className="border rounded-lg p-2" placeholder="Tempi progettuali" value={quickForm.project_timeline} onChange={e=>setQuickForm({...quickForm,project_timeline:e.target.value})} />
              {(quickAddStage==='Preventivo'||quickAddStage==='Vendita') && (
                <div>
                  <label className="text-xs text-gray-500">Probabilità</label>
                  <select className="border rounded-lg p-2 w-full mt-1" value={quickForm.probability??''} onChange={e=>setQuickForm({...quickForm,probability:e.target.value?Number(e.target.value):null})} disabled={quickAddStage==='Vendita'}>
                    {quickAddStage==='Vendita'?<option value={100}>100%</option>:PROB_OPTIONS.map(p=><option key={p} value={p}>{p}%</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={addQuickDeal} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Salva</button>
              <button onClick={()=>setQuickAddStage(null)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nuovo Ingresso */}
      {showIngressoForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-screen overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Nuovo Ingresso</h2>
            <div className="flex gap-2 mb-4">
              <button onClick={()=>setIsNewContact(false)} className={`px-4 py-2 rounded-lg text-sm ${!isNewContact?'bg-blue-600 text-white':'bg-gray-200 text-gray-700'}`}>Contatto esistente</button>
              <button onClick={()=>setIsNewContact(true)} className={`px-4 py-2 rounded-lg text-sm ${isNewContact?'bg-blue-600 text-white':'bg-gray-200 text-gray-700'}`}>Nuovo contatto</button>
            </div>
            {!isNewContact && (
              <div className="relative mb-4">
                <input className="border rounded-lg p-2 w-full" placeholder="Cerca per nome o telefono..." value={searchQuery} onChange={e=>searchContacts(e.target.value)} />
                {searchResults.length>0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {searchResults.map(d=>(
                      <div key={d.id} onClick={()=>selectExistingContact(d)} className="p-3 hover:bg-gray-50 cursor-pointer border-b">
                        <p className="font-semibold text-sm">{d.contact_name}</p>
                        <p className="text-xs text-gray-500">{d.phone} · {d.email}</p>
                      </div>
                    ))}
                  </div>
                )}
                {searchQuery.length>=2&&searchResults.length===0 && <p className="text-sm text-gray-500 mt-2">Nessun contatto trovato. <button onClick={()=>setIsNewContact(true)} className="text-blue-600 underline">Crea nuovo</button></p>}
              </div>
            )}
            <div className="flex flex-col gap-3">
              <input className="border rounded-lg p-2" placeholder="Nome contatto *" value={ingressoForm.contact_name} onChange={e=>setIngressoForm({...ingressoForm,contact_name:e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Telefono" value={ingressoForm.phone||''} onChange={e=>setIngressoForm({...ingressoForm,phone:e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Email" value={ingressoForm.email||''} onChange={e=>setIngressoForm({...ingressoForm,email:e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Origine (es. Meta Ads)" value={ingressoForm.origin||''} onChange={e=>setIngressoForm({...ingressoForm,origin:e.target.value})} />
              <label className="text-xs text-gray-500">Ambiente</label>
              <EnvSelect value={ingressoForm.environment} onChange={v=>setIngressoForm({...ingressoForm,environment:v})} />
              <label className="text-xs text-gray-500">Data ingresso</label>
              <input className="border rounded-lg p-2" type="date" value={ingressoForm.entry_date} onChange={e=>setIngressoForm({...ingressoForm,entry_date:e.target.value})} />
              <label className="text-xs text-gray-500">Data appuntamento</label>
              <input className="border rounded-lg p-2" type="date" value={ingressoForm.appointment_date} onChange={e=>setIngressoForm({...ingressoForm,appointment_date:e.target.value})} />
              <input className="border rounded-lg p-2" type="number" placeholder="Preventivo (€)" value={ingressoForm.estimate||''} onChange={e=>setIngressoForm({...ingressoForm,estimate:Number(e.target.value)})} />
              <input className="border rounded-lg p-2" placeholder="Tempi progettuali" value={ingressoForm.project_timeline||''} onChange={e=>setIngressoForm({...ingressoForm,project_timeline:e.target.value})} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={addIngresso} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">Salva Ingresso</button>
              <button onClick={()=>{setShowIngressoForm(false);setSearchQuery('');setSearchResults([]);setIsNewContact(false)}} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Dettaglio */}
      {selectedDeal&&editDeal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-screen overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold">{selectedDeal.contact_name||selectedDeal.title}</h2>
              <div className="flex items-center gap-2">
                {selectedDeal.probability!=null && <span className={`text-xs px-2 py-1 rounded-full font-medium ${PROB_COLORS[selectedDeal.probability]||'bg-gray-100 text-gray-600'}`}>{selectedDeal.probability}%</span>}
                <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs">{selectedDeal.stage}</span>
              </div>
            </div>
            {!editMode ? (
              <div className="flex flex-col gap-2 text-sm">
                {selectedDeal.phone && <p><span className="font-semibold text-gray-500">Telefono:</span> {selectedDeal.phone}</p>}
                {selectedDeal.email && <p><span className="font-semibold text-gray-500">Email:</span> {selectedDeal.email}</p>}
                {selectedDeal.origin && <p><span className="font-semibold text-gray-500">Origine:</span> {selectedDeal.origin}</p>}
                {selectedDeal.environment && <p><span className="font-semibold text-gray-500">Ambiente:</span> {selectedDeal.environment}</p>}
                {selectedDeal.entry_date && <p><span className="font-semibold text-gray-500">Data ingresso:</span> {formatDate(selectedDeal.entry_date)}</p>}
                {selectedDeal.appointment_date && <p><span className="font-semibold text-gray-500">Appuntamento:</span> {formatDate(selectedDeal.appointment_date)}</p>}
                {selectedDeal.estimate>0 && <p><span className="font-semibold text-gray-500">Preventivo:</span> € {selectedDeal.estimate.toLocaleString()}</p>}
                {selectedDeal.probability!=null && selectedDeal.estimate>0 && (
                  <p><span className="font-semibold text-gray-500">Valore ponderato:</span> € {Math.round(selectedDeal.estimate*(selectedDeal.probability/100)).toLocaleString()} ({selectedDeal.probability}%)</p>
                )}
                {selectedDeal.project_timeline && <p><span className="font-semibold text-gray-500">Tempi progettuali:</span> {selectedDeal.project_timeline}</p>}
              </div>
            ) : (
              <div className="flex flex-col gap-3 text-sm">
                <div><label className="text-xs text-gray-500">Contatto</label><input className="border rounded-lg p-2 w-full mt-1" value={editDeal.contact_name||''} onChange={e=>setEditDeal({...editDeal,contact_name:e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Telefono</label><input className="border rounded-lg p-2 w-full mt-1" value={editDeal.phone||''} onChange={e=>setEditDeal({...editDeal,phone:e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Email</label><input className="border rounded-lg p-2 w-full mt-1" value={editDeal.email||''} onChange={e=>setEditDeal({...editDeal,email:e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Origine</label><input className="border rounded-lg p-2 w-full mt-1" value={editDeal.origin||''} onChange={e=>setEditDeal({...editDeal,origin:e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Ambiente</label><EnvSelect value={editDeal.environment||''} onChange={v=>setEditDeal({...editDeal,environment:v})} /></div>
                <div><label className="text-xs text-gray-500">Data ingresso</label><input type="date" className="border rounded-lg p-2 w-full mt-1" value={editDeal.entry_date||''} onChange={e=>setEditDeal({...editDeal,entry_date:e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Data appuntamento</label><input type="date" className="border rounded-lg p-2 w-full mt-1" value={editDeal.appointment_date||''} onChange={e=>setEditDeal({...editDeal,appointment_date:e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Preventivo (€)</label><input type="number" className="border rounded-lg p-2 w-full mt-1" value={editDeal.estimate||''} onChange={e=>setEditDeal({...editDeal,estimate:Number(e.target.value)})} /></div>
                <div><label className="text-xs text-gray-500">Tempi progettuali</label><input className="border rounded-lg p-2 w-full mt-1" value={editDeal.project_timeline||''} onChange={e=>setEditDeal({...editDeal,project_timeline:e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Fase</label><select className="border rounded-lg p-2 w-full mt-1" value={editDeal.stage} onChange={e=>setEditDeal({...editDeal,stage:e.target.value})}>{STAGES.map(s=><option key={s}>{s}</option>)}</select></div>
                <div>
                  <label className="text-xs text-gray-500">Probabilità</label>
                  <select className="border rounded-lg p-2 w-full mt-1" value={editDeal.probability??''} onChange={e=>setEditDeal({...editDeal,probability:e.target.value?Number(e.target.value):null})}>
                    <option value="">—</option>
                    {PROB_OPTIONS.map(p=><option key={p} value={p}>{p}%</option>)}
                  </select>
                </div>
                {saveError && <p className="text-red-500 text-sm">{saveError}</p>}
              </div>
            )}
            <div className="flex gap-2 mt-5">
              {!editMode ? (
                <>
                  <button onClick={()=>setEditMode(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Modifica</button>
                  <button onClick={()=>{setSelectedDeal(null);setEditDeal(null)}} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Chiudi</button>
                  <button onClick={()=>setConfirmDelete(selectedDeal.id)} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 ml-auto">Elimina</button>
                </>
              ) : (
                <>
                  <button onClick={()=>saveDeal(editDeal)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Salva modifiche</button>
                  <button onClick={()=>setEditMode(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
                  <button onClick={()=>setConfirmDelete(selectedDeal.id)} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 ml-auto">Elimina</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {saleDatePopup && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[70]">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-1">Contatto aggiudicato! 🏆</h3>
            <p className="text-gray-600 text-sm mb-4">Inserisci la data di vendita:</p>
            <input type="date" className="border rounded-lg p-2 w-full mb-4" value={saleDateValue} onChange={e=>setSaleDateValue(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={confirmSaleDate} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-medium">Conferma</button>
              <button onClick={()=>{setSaleDatePopup(null); fetchDeals()}} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {confirmBulkDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-2">Conferma eliminazione</h3>
            <p className="text-gray-600 text-sm mb-5">Sei sicuro di voler eliminare <strong>{selectedIds.size} contatti</strong>? L'operazione è irreversibile.</p>
            <div className="flex gap-2">
              <button onClick={bulkDelete} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600">Sì, elimina</button>
              <button onClick={()=>setConfirmBulkDelete(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-2">Conferma eliminazione</h3>
            <p className="text-gray-600 text-sm mb-5">Sei sicuro di voler eliminare questo contatto? L'operazione è irreversibile.</p>
            <div className="flex gap-2">
              <button onClick={()=>deleteDeal(confirmDelete)} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600">Sì, elimina</button>
              <button onClick={()=>setConfirmDelete(null)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        </div>
      )}
      {confirmLogout && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-2">Conferma uscita</h3>
            <p className="text-gray-600 text-sm mb-5">Sei sicuro di voler uscire?</p>
            <div className="flex gap-2">
              <button onClick={()=>{supabase.auth.signOut();window.location.replace('/login')}} className="bg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gray-900">Sì, esci</button>
              <button onClick={()=>setConfirmLogout(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {/* LEAD FORM */}
      {showLeadForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-bold mb-4">Nuovo Lead</h2>
            <div className="flex flex-col gap-3">
              <div><label className="text-xs text-gray-500">Nome *</label><input className="border rounded-lg p-2 w-full mt-1 text-sm" value={leadForm.contact_name} onChange={e=>setLeadForm({...leadForm, contact_name:e.target.value})} /></div>
              <div><label className="text-xs text-gray-500">Telefono</label><input className="border rounded-lg p-2 w-full mt-1 text-sm" value={leadForm.phone} onChange={e=>setLeadForm({...leadForm, phone:e.target.value})} /></div>
              <div><label className="text-xs text-gray-500">Email</label><input className="border rounded-lg p-2 w-full mt-1 text-sm" value={leadForm.email} onChange={e=>setLeadForm({...leadForm, email:e.target.value})} /></div>
              <div><label className="text-xs text-gray-500">Origine</label><input className="border rounded-lg p-2 w-full mt-1 text-sm" value={leadForm.origin} onChange={e=>setLeadForm({...leadForm, origin:e.target.value})} /></div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={async()=>{
                if(!leadForm.contact_name.trim()) return
                await supabase.from('deals').insert({
                  title: leadForm.contact_name, contact_name: leadForm.contact_name,
                  phone: leadForm.phone||null, email: leadForm.email||null, origin: leadForm.origin||null,
                  stage: 'Qualificato', is_lead: true, lead_stage: 'Nuovo', probability: null,
                })
                setLeadForm({contact_name:'',phone:'',email:'',origin:''}); setShowLeadForm(false); fetchDeals()
              }} className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">Salva</button>
              <button onClick={()=>{setShowLeadForm(false);setLeadForm({contact_name:'',phone:'',email:'',origin:''})}} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {/* CONVERTI LEAD */}
      {convertingLead && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-bold mb-2">Converti in Contatto</h2>
            <p className="text-gray-600 text-sm mb-4"><strong>{convertingLead.contact_name}</strong> verrà aggiunto alla pipeline principale come <span className="text-blue-600 font-medium">Qualificato</span>.</p>
            <div className="flex gap-2">
              <button onClick={async()=>{
                await supabase.from('deals').update({ is_lead: false, lead_stage: null, stage: 'Qualificato', probability: 25 }).eq('id', convertingLead.id)
                setConvertingLead(null); fetchDeals()
              }} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Converti</button>
              <button onClick={()=>setConvertingLead(null)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
