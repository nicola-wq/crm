'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
  probability: number | null; is_lead: boolean; lead_stage: string; lead_stage_updated_at?: string; sale_date?: string; lead_viewed_at?: string
}

const emptyDeal = { title: '', contact_name: '', phone: '', email: '', origin: '', environment: '', entry_date: '', appointment_date: '', estimate: 0, project_timeline: '', stage: 'Qualificato', probability: null as number | null }
type View = 'home' | 'kanban' | 'list' | 'dashboard' | 'leads' | 'tasks' | 'contacts'
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


interface Contact {
  id: string; name: string; phone: string; email: string; origin: string; company?: string; notes?: string; created_at: string
}

function ContactsView({ router }: { router: any }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({name:'', phone:'', email:'', origin:''})
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchContacts() }, [])

  async function fetchContacts() {
    setLoading(true)
    const { data } = await supabase.from('contacts').select('*').order('name', { ascending: true })
    setContacts(data || [])
    setLoading(false)
  }

  async function addContact() {
    if (!form.name.trim()) return
    setSaving(true)
    await supabase.from('contacts').insert({ name: form.name.trim(), phone: form.phone||null, email: form.email||null, origin: form.origin||null })
    setForm({name:'', phone:'', email:'', origin:''})
    setShowForm(false)
    setSaving(false)
    fetchContacts()
  }

  const filtered = contacts.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) || c.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4 gap-3">
        <input
          className="border rounded-xl px-4 py-2.5 text-sm flex-1 bg-white shadow-sm"
          placeholder="Cerca per nome, telefono, email..."
          value={search} onChange={e => setSearch(e.target.value)}
        />
        <button onClick={() => setShowForm(true)} className="bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 whitespace-nowrap">
          + Nuovo
        </button>
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-12">Caricamento...</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-gray-400 py-12">Nessun contatto trovato</p>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          {filtered.map((c, i) => (
            <div key={c.id}
              onClick={() => router.push(`/contact/${c.id}`)}
              className={`flex items-center gap-4 px-4 py-3.5 cursor-pointer hover:bg-blue-50 transition-colors ${i > 0 ? 'border-t' : ''}`}>
              <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                {c.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-gray-800">{c.name}</p>
                <div className="flex gap-3 mt-0.5">
                  {c.phone && <span className="text-xs text-gray-400">{c.phone}</span>}
                  {c.email && <span className="text-xs text-gray-400 truncate">{c.email}</span>}
                  {c.origin && <span className="text-xs text-blue-400">{c.origin}</span>}
                </div>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-5 w-full sm:max-w-md shadow-xl">
            <h2 className="text-lg font-bold mb-4">Nuovo Contatto</h2>
            <div className="flex flex-col gap-3">
              <input className="border rounded-lg p-3 text-sm" placeholder="Nome *" value={form.name} onChange={e => setForm({...form, name: e.target.value})} autoFocus />
              <input className="border rounded-lg p-3 text-sm" placeholder="Telefono" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
              <input className="border rounded-lg p-3 text-sm" placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
              <input className="border rounded-lg p-3 text-sm" placeholder="Origine" value={form.origin} onChange={e => setForm({...form, origin: e.target.value})} />
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={addContact} disabled={saving || !form.name.trim()} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium disabled:opacity-40">Salva</button>
              <button onClick={() => { setShowForm(false); setForm({name:'', phone:'', email:'', origin:''}) }} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CrmContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as View | null
  const [view, setView] = useState<View>(tabParam || 'home')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const t = searchParams.get('tab') as View | null
    setView(t || 'home')
  }, [searchParams])

  function navigateTo(v: View) {
    setMobileMenuOpen(false)
    if (v === 'home') { router.push('/'); return }
    router.push(`/?tab=${v}`)
  }

  const [deals, setDeals] = useState<Deal[]>([])
  const [checked, setChecked] = useState(false)
  const [userEmail, setUserEmail] = useState('')
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
  const [existingDealId, setExistingDealId] = useState<string|null>(null)
  const [existingContactId, setExistingContactId] = useState<string|null>(null)
  const [formContactSearch, setFormContactSearch] = useState('')
  const [formContactResults, setFormContactResults] = useState<any[]>([])
  const [formContactId, setFormContactId] = useState<string|null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formEnvError, setFormEnvError] = useState(false)
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
  const [saleDatePopup, setSaleDatePopup] = useState<{id:string, stage:string, prob:number|null, fromStage?:string}|null>(null)
  const [nonConvPopup, setNonConvPopup] = useState<{id:string, fromStage:string, prob:number|null}|null>(null)
  const [nonConvMotivo, setNonConvMotivo] = useState('')
  const [nonConvAltro, setNonConvAltro] = useState('')
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
        const savedKeys = savedCols.map(c=>c.col)
        const missing = DEFAULT_COLS.filter(c=>!savedKeys.includes(c.col))
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
  const monthRange = getCurrentMonthRange()
  const [kanbanVenditaFrom, setKanbanVenditaFrom] = useState(monthRange.from)
  const [kanbanVenditaTo, setKanbanVenditaTo] = useState(monthRange.to)
  const [leads, setLeads] = useState<Deal[]>([])
  const leadDefault30 = () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate()-30); return {from: toYMD(from), to: toYMD(to)} }
  const [leadFrom, setLeadFrom] = useState(() => leadDefault30().from)
  const [leadTo, setLeadTo] = useState(() => leadDefault30().to)
  const [allTasks, setAllTasks] = useState<any[]>([])
  const [taskFilter, setTaskFilter] = useState<'all'|'todo'|'done'>('todo')
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskForm, setNewTaskForm] = useState({title:'', due_date:'', deal_id:'', search:''})
  const [newTaskSearch, setNewTaskSearch] = useState('')
  const [newTaskSearchResults, setNewTaskSearchResults] = useState<Deal[]>([])
  const [editingTask, setEditingTask] = useState<{id:string,title:string,due_date:string,deal_id:string,deal_name:string}|null>(null)
  const [editTaskSearch, setEditTaskSearch] = useState('')
  const [editTaskSearchResults, setEditTaskSearchResults] = useState<Deal[]>([])
  const [showLeadForm, setShowLeadForm] = useState(false)
  const [leadForm, setLeadForm] = useState({contact_name:'', phone:'', email:'', origin:''})
  const [convertingLead, setConvertingLead] = useState<Deal|null>(null)
  const [dateFrom, setDateFrom] = useState(monthRange.from)
  const [dateTo, setDateTo] = useState(monthRange.to)

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { window.location.replace('/login'); return }
      setUserEmail(session.user.email || '')
      setChecked(true); fetchDeals()
    }
    init()
  }, [])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (saleDatePopup) { setSaleDatePopup(null); fetchDeals(); return }
      if (nonConvPopup) { setNonConvPopup(null); setNonConvMotivo(''); setNonConvAltro(''); fetchDeals(); return }
      if (confirmDelete) { setConfirmDelete(null); return }
      if (showNewTask) { setShowNewTask(false); setNewTaskForm({title:'',due_date:'',deal_id:'',search:''}); setNewTaskSearch(''); setNewTaskSearchResults([]); return }
      if (showForm) { setShowForm(false); setFormContactSearch(''); setFormContactResults([]); setFormContactId(null); return }
      if (showLeadForm) { setShowLeadForm(false); return }
      if (showIngressoForm) { setShowIngressoForm(false); setSearchQuery(''); setSearchResults([]); setIsNewContact(false); setExistingDealId(null); setExistingContactId(null); return }
      if (selectedDeal) { setSelectedDeal(null); setEditMode(false); setEditDeal(null); return }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [saleDatePopup, nonConvPopup, confirmDelete, showNewTask, showForm, showLeadForm, showIngressoForm, selectedDeal])

  async function fetchDeals() {
    const { data } = await supabase.from('deals').select('*').eq('is_lead', false).order('created_at', { ascending: false })
    setDeals(data || [])
    const { data: ldata } = await supabase.from('deals').select('*').eq('is_lead', true).order('created_at', { ascending: false })
    setLeads(ldata || [])
    const { data: tdata } = await supabase.from('tasks').select('*, deals(contact_name, stage)').order('created_at', { ascending: false })
    setAllTasks(tdata || [])
  }

  async function logStageChange(dealId: string, fromStage: string, toStage: string) {
    if (fromStage === toStage) return
    await supabase.from('activity_log').insert({
      deal_id: dealId, type: 'stage_change',
      from_value: fromStage, to_value: toStage, created_by: userEmail,
    })
  }

  function buildRpcParams(f: typeof emptyDeal, stage?: string) {
    const s = stage || f.stage
    return {
      p_title: f.contact_name, p_contact_name: f.contact_name, p_stage: s,
      p_phone: f.phone||null, p_email: f.email||null, p_origin: f.origin||null,
      p_environment: f.environment||null, p_entry_date: f.entry_date||null,
      p_appointment_date: f.appointment_date||null, p_estimate: f.estimate||null,
      p_project_timeline: f.project_timeline||null,
    }
  }


  function buildDealTitle(name: string, env: string) {
    if (!name) return ''
    if (!env) return name
    return `${name} | ${env}`
  }
  async function addDeal() {
    if (!form.contact_name) return
    if (!form.environment) { setFormEnvError(true); return }
    setFormEnvError(false)
    const prob = form.probability ?? getDefaultProb(form.stage)
    let contactId: string | null = formContactId
    if (!contactId) {
      const { data: newContact } = await supabase.from('contacts').insert({
        name: form.contact_name, phone: form.phone||null,
        email: form.email||null, origin: form.origin||null,
      }).select().single()
      if (newContact) contactId = newContact.id
    }
    const dealTitle = formTitle || buildDealTitle(form.contact_name, form.environment)
    const { error } = await supabase.from('deals').insert({
      title: dealTitle, contact_name: form.contact_name,
      phone: form.phone||null, email: form.email||null, origin: form.origin||null,
      environment: form.environment||null, entry_date: form.entry_date||null,
      appointment_date: form.appointment_date||null, estimate: form.estimate||0,
      project_timeline: form.project_timeline||null, stage: form.stage,
      probability: prob, is_lead: false, contact_id: contactId,
    })
    if (!error) { setForm(emptyDeal); setFormContactSearch(''); setFormContactResults([]); setFormContactId(null); setFormTitle(''); setFormEnvError(false); setShowForm(false); fetchDeals() }
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
    let contactId = existingContactId
    if (!contactId) {
      const { data: newContact } = await supabase.from('contacts').insert({
        name: ingressoForm.contact_name, phone: ingressoForm.phone||null,
        email: ingressoForm.email||null, origin: ingressoForm.origin||null,
      }).select().single()
      if (newContact) contactId = newContact.id
    }
    const { error } = await supabase.from('deals').insert({
      title: ingressoForm.contact_name, contact_name: ingressoForm.contact_name,
      phone: ingressoForm.phone||null, email: ingressoForm.email||null,
      origin: ingressoForm.origin||null, environment: ingressoForm.environment||null,
      entry_date: ingressoForm.entry_date||null, stage: 'Ingresso',
      is_lead: false, probability: null, contact_id: contactId,
    })
    if (!error) {
      setIngressoForm({...emptyDeal, stage:'Ingresso', entry_date:toYMD(new Date())})
      setExistingContactId(null); setExistingDealId(null)
      setShowIngressoForm(false); setIsNewContact(false); setSearchQuery(''); setSearchResults([]); fetchDeals()
    }
  }

  async function saveDeal(deal: Deal) {
    setSaveError('')
    const oldDeal = deals.find(d => d.id === deal.id)
    if (deal.stage === 'Vendita' && selectedDeal?.stage !== 'Vendita') {
      setSaleDateValue(toYMD(new Date()))
      setSaleDatePopup({id: deal.id, stage: deal.stage, prob: deal.probability ?? 100, fromStage: selectedDeal?.stage})
      return
    }
    if (deal.stage === 'Non convertito' && oldDeal?.stage !== 'Non convertito') {
      setNonConvMotivo(''); setNonConvAltro('')
      setNonConvPopup({id: deal.id, fromStage: oldDeal?.stage||'', prob: 0})
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
    if (oldDeal && oldDeal.stage !== deal.stage) await logStageChange(deal.id, oldDeal.stage, deal.stage)
    setSelectedDeal(null); setEditMode(false); setEditDeal(null); fetchDeals()
  }

  async function searchContacts(q: string) {
    setSearchQuery(q)
    if (q.length < 2) { setSearchResults([]); return }
    const { data } = await supabase.from('contacts').select('*').or(`name.ilike.%${q}%,phone.ilike.%${q}%`).limit(8)
    const adapted = (data || []).map((c: any) => ({
      id: c.id, contact_name: c.name, phone: c.phone, email: c.email,
      origin: c.origin, title: c.name, environment: '', entry_date: '', stage: '',
      estimate: 0, created_at: c.created_at, probability: null, is_lead: false,
      lead_stage: '', appointment_date: '', project_timeline: '', _contactId: c.id
    }))
    setSearchResults(adapted)
  }

  function selectExistingContact(deal: any) {
    setExistingContactId(deal._contactId || null)
    setExistingDealId(null)
    setIngressoForm({...emptyDeal, stage:'Ingresso', entry_date:toYMD(new Date()), contact_name:deal.contact_name||'', phone:deal.phone||'', email:deal.email||'', origin:deal.origin||''})
    setSearchQuery(deal.contact_name); setSearchResults([]); setIsNewContact(false)
  }

  async function updateStage(id: string, stage: string, currentProb: number|null, fromStage: string) {
    const newProb = stage === 'Vendita' ? 100 : stage === 'Non convertito' ? 0 : stage === 'Preventivo' ? (currentProb === 100 || currentProb === 0 ? 50 : (currentProb ?? 50)) : (currentProb === 100 || currentProb === 0 ? null : currentProb)
    await supabase.from('deals').update({stage, probability: newProb}).eq('id', id)
    await logStageChange(id, fromStage, stage)
    if (stage === 'Appuntamento fissato') {
      const deal = deals.find(d => d.id === id)
      if (deal?.origin?.toLowerCase().includes('chat ai')) await createAutoTaskIfNeeded(id, 'Confermare appuntamento')
    }
  }

  async function confirmNonConv() {
    if (!nonConvPopup) return
    const motivo = nonConvMotivo === 'Altro' ? `Altro: ${nonConvAltro}` : nonConvMotivo
    if (!motivo.trim()) return
    const {id, fromStage, prob} = nonConvPopup
    await supabase.from('deals').update({stage:'Non convertito', probability:0, project_timeline: motivo}).eq('id', id)
    await logStageChange(id, fromStage, 'Non convertito')
    setNonConvPopup(null); setNonConvMotivo(''); setNonConvAltro(''); fetchDeals()
  }

  async function createAutoTaskIfNeeded(dealId: string, title: string) {
    const { data } = await supabase.from('tasks').select('id').eq('deal_id', dealId).eq('title', title).eq('auto', true)
    if (data && data.length > 0) return
    await supabase.from('tasks').insert({ deal_id: dealId, title, auto: true, done: false })
  }

  async function deleteDeal(id: string) {
    await supabase.from('deals').delete().eq('id',id)
    setConfirmDelete(null); setSelectedDeal(null); setEditMode(false); fetchDeals()
  }

  async function onDragEnd(result: DropResult) {
    if (!result.destination) return
    const dealId = result.draggableId; const newStage = result.destination.droppableId
    const deal = deals.find(d=>d.id===dealId)
    const fromStage = deal?.stage || ''
    if (fromStage === newStage) return
    const currentP = deal?.probability ?? null
    const newProb = newStage === 'Vendita' ? 100 : newStage === 'Non convertito' ? 0 : newStage === 'Preventivo' ? (currentP === 100 || currentP === 0 ? 50 : (currentP ?? 50)) : (currentP === 100 || currentP === 0 ? null : currentP)
    setDeals(prev => prev.map(d => d.id===dealId ? {...d, stage:newStage, probability:newProb} : d))
    if (newStage === 'Vendita') {
      setSaleDateValue(toYMD(new Date()))
      setSaleDatePopup({id: dealId, stage: newStage, prob: newProb, fromStage})
    } else if (newStage === 'Non convertito') {
      setNonConvMotivo(''); setNonConvAltro('')
      setNonConvPopup({id: dealId, fromStage, prob: newProb})
    } else {
      await updateStage(dealId, newStage, deal?.probability ?? null, fromStage)
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
    return `px-2 py-1 rounded-lg text-xs sm:text-sm font-medium transition-colors ${activeQuick===type?'bg-blue-600 text-white':'bg-gray-100 hover:bg-gray-200 text-gray-700'}`
  }

  function goToDeal(deal: Deal) { router.push(`/deal/${deal.id}`) }

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
    for (const id of Array.from(selectedIds)) {
      const deal = deals.find(d => d.id === id)
      if (deal && deal.stage !== bulkStage) await logStageChange(id, deal.stage, bulkStage)
    }
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
    if (col === 'stage') {
      const deal = deals.find(d => d.id === id)
      if (deal && deal.stage !== val) await logStageChange(id, deal.stage, val)
    }
    await supabase.from('deals').update({[col]: updateVal, ...(col==='contact_name'?{title:val}:{})}).eq('id', id)
    setInlineEdit(null); fetchDeals()
  }

  if (!checked) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">Verifica accesso...</p></div>

  const filteredDeals = getFilteredDeals()

  const todayBadge = toYMD(new Date())
  const taskScadute = allTasks.filter(t => !t.done && t.due_date && t.due_date < todayBadge).length
  const leadNonViste = leads.filter(l => !l.lead_viewed_at).length
  const listDeals = sortDeals(getListDeals())

  const kanbanDeals = (stage: string) => {
    if (stage === 'Vendita') {
      return deals.filter(d => {
        if (d.stage !== 'Vendita') return false
        const ds = d.sale_date || d.created_at.split('T')[0]
        return ds >= kanbanVenditaFrom && ds <= kanbanVenditaTo
      })
    }
    if (stage === 'Non convertito') {
      return deals.filter(d => {
        if (d.stage !== 'Non convertito') return false
        const ds = d.created_at.split('T')[0]
        return ds >= kanbanVenditaFrom && ds <= kanbanVenditaTo
      })
    }
    return deals.filter(d => d.stage === stage)
  }

  async function confirmSaleDate() {
    if (!saleDatePopup) return
    const {id, stage, prob, fromStage} = saleDatePopup
    await supabase.from('deals').update({stage, probability: 100, sale_date: saleDateValue}).eq('id', id)
    if (fromStage && fromStage !== stage) await logStageChange(id, fromStage, stage)
    // Invia notifica email
    const deal = deals.find(d => d.id === id)
    if (deal) {
      fetch('/api/notify-sale', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          contact_name: deal.contact_name || deal.title,
          estimate: deal.estimate,
          environment: deal.environment,
          sale_date: saleDateValue,
          user_email: userEmail,
        })
      }).catch(() => {}) // silenzioso, non blocca l'UI
    }
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
    const csvContent = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `contatti_${toYMD(new Date())}.csv`; a.click(); URL.revokeObjectURL(url)
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
              {bulkEnv.length>0 ? <span className="text-blue-700 font-medium">{bulkEnv.join(', ')}</span> : <span className="text-gray-500">Ambiente...</span>}
              <span className="text-gray-400 text-xs ml-1">▾</span>
            </button>
            {showBulkEnvPicker && (
              <div className="absolute top-full left-0 mt-1 bg-white border rounded-xl shadow-lg p-3 z-20" style={{minWidth:'240px'}}>
                <div className="flex flex-wrap gap-1 mb-3">
                  {ENVIRONMENTS.map(env=>{const active=bulkEnv.includes(env);return <button key={env} type="button" onClick={()=>setBulkEnv(prev=>active?prev.filter(e=>e!==env):[...prev,env])} className={`px-2 py-1 rounded-full text-xs border transition-colors ${active?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>{env}</button>})}
                </div>
                <div className="flex gap-1 justify-end border-t pt-2">
                  <button onClick={()=>{setShowBulkEnvPicker(false);setBulkEnv([])}} className="text-xs text-gray-500 px-2 py-1 hover:text-gray-700">Annulla</button>
                  {bulkEnv.length>0 && <button onClick={bulkChangeEnv} className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">Applica</button>}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <input type="date" className="border rounded-lg p-2 text-sm bg-white" value={bulkEntryDate} onChange={e=>setBulkEntryDate(e.target.value)} />
            {bulkEntryDate && <button onClick={bulkChangeEntryDate} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700">Applica</button>}
          </div>
          <button onClick={()=>setConfirmBulkDelete(true)} className="bg-red-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-red-600">Elimina</button>
          <button onClick={()=>{setSelectedIds(new Set());setBulkStage('');setBulkEnv([]);setBulkEntryDate('');setShowBulkEnvPicker(false)}} className="bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-300 ml-auto">✕</button>
        </div>
      </div>
    ) : null
  )

  // DASHBOARD CALCS
  const vendite = filteredDeals.filter(d => d.stage === 'Vendita')
  const preventivi = filteredDeals.filter(d => d.stage === 'Preventivo')
  const prevConValore = filteredDeals.filter(d => d.estimate > 0)
  const venditeCerte = vendite.reduce((s,d)=>s+(d.estimate||0),0)
  const pipelineTotal = filteredDeals.filter(d=>d.probability!=null&&d.probability>0).reduce((s,d)=>s+(d.estimate||0)*(d.probability||0)/100,0)
  const ingressiCount = filteredDeals.length
  const tuttiIngressi = filteredDeals.filter(d => !!d.entry_date)
  const totaleVenduto = vendite.reduce((s,d)=>s+(d.estimate||0),0)
  const avgIngresso = tuttiIngressi.length > 0 ? Math.round(totaleVenduto/tuttiIngressi.length) : 0
  const avgVendita = vendite.length > 0 ? Math.round(vendite.reduce((s,d)=>s+(d.estimate||0),0)/vendite.length) : 0
  const avgPreventivo = prevConValore.length > 0 ? Math.round(prevConValore.reduce((s,d)=>s+(d.estimate||0),0)/prevConValore.length) : 0
  const tuttiConPreventivo = filteredDeals.filter(d => d.stage==='Preventivo'||d.stage==='Vendita')
  const tassoConvIngresso = tuttiIngressi.length > 0 ? Math.round((vendite.length/tuttiIngressi.length)*100) : 0
  const tassoConvPreventivo = tuttiConPreventivo.length > 0 ? Math.round((vendite.length/tuttiConPreventivo.length)*100) : 0
  const dayMap: Record<string,number> = {}
  filteredDeals.forEach(d => { const day=d.entry_date||d.created_at.split('T')[0]; dayMap[day]=(dayMap[day]||0)+1 })
  const days = Object.keys(dayMap).sort()
  const maxDay = Math.max(...days.map(d => dayMap[d]), 1)
  const envSoldMap: Record<string,number> = {}; const envCountMap: Record<string,number> = {}
  filteredDeals.forEach(d => {
    const envs = d.environment ? d.environment.split(',').map((e:string)=>e.trim()).filter(Boolean) : ['Non specificato']
    envs.forEach(env => { if(d.stage==='Vendita') envSoldMap[env]=(envSoldMap[env]||0)+(d.estimate||0); envCountMap[env]=(envCountMap[env]||0)+1 })
  })
  const envKeys = [...new Set([...Object.keys(envSoldMap),...Object.keys(envCountMap)])]
  const envSoldData = envKeys.map((k,i)=>({label:k,value:envSoldMap[k]||0,color:PIE_COLORS[i%PIE_COLORS.length]}))
  const envCountData = envKeys.map((k,i)=>({label:k,value:envCountMap[k]||0,color:PIE_COLORS[i%PIE_COLORS.length]}))

  return (
    <div className="min-h-screen bg-gray-100">

      {/* ── HEADER ── */}
      <div className="bg-white shadow px-3 sm:px-6 py-3 flex justify-between items-center sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <button onClick={()=>navigateTo('home')} className={`transition-colors ${view==='home'?'text-blue-600':'text-gray-400 hover:text-blue-600'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
          </button>
          <button onClick={()=>navigateTo('contacts')} title="Contatti" className={`transition-colors ${view==='contacts'?'text-blue-600':'text-gray-400 hover:text-blue-600'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          </button>
          <img src="/logo.png" alt="Pensare Casa" className="h-5 object-contain" />
          <span className="text-sm font-semibold text-gray-700">C.so Regina</span>
        </div>

        {/* Desktop nav */}
        <div className="hidden md:flex gap-2 items-center">
          <button onClick={()=>navigateTo('tasks')} className={`relative px-3 py-2 text-sm rounded-lg border mr-1 ${view==='tasks'?'bg-orange-500 text-white border-orange-500':'bg-white text-orange-500 border-orange-300 hover:bg-orange-50'}`}>
            Task
            {taskScadute>0 && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{taskScadute}</span>}
          </button>
          <button onClick={()=>navigateTo('leads')} className={`relative px-3 py-2 text-sm rounded-lg border mr-3 ${view==='leads'?'bg-purple-600 text-white border-purple-600':'bg-white text-purple-600 border-purple-300 hover:bg-purple-50'}`}>
            Lead
            {leadNonViste>0 && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{leadNonViste}</span>}
          </button>
          <div className="flex border rounded-lg overflow-hidden mr-2">
            <button onClick={()=>navigateTo('kanban')} className={`px-3 py-2 text-sm ${view==='kanban'?'bg-blue-600 text-white':'bg-white text-gray-600'}`}>Pipeline</button>
            <button onClick={()=>navigateTo('list')} className={`px-3 py-2 text-sm ${view==='list'?'bg-blue-600 text-white':'bg-white text-gray-600'}`}>Lista</button>
            <button onClick={()=>navigateTo('dashboard')} className={`px-3 py-2 text-sm ${view==='dashboard'?'bg-blue-600 text-white':'bg-white text-gray-600'}`}>Dashboard</button>
          </div>
          {view==='leads' && <button onClick={()=>setShowLeadForm(true)} className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">+ Nuovo Lead</button>}
          {view!=='leads' && <button onClick={()=>setShowIngressoForm(true)} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">+ Nuovo Ingresso</button>}
          {view!=='leads' && <button onClick={()=>setShowForm(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">+ Nuovo Affare</button>}
          <button onClick={()=>setConfirmLogout(true)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Esci</button>
        </div>

        {/* Mobile: azione rapida + hamburger */}
        <div className="flex md:hidden items-center gap-2">
          {view==='leads'
            ? <button onClick={()=>setShowLeadForm(true)} className="bg-purple-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium">+ Lead</button>
            : <button onClick={()=>setShowIngressoForm(true)} className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium">+ Ingresso</button>
          }
          <button onClick={()=>setMobileMenuOpen(p=>!p)} className="p-2 rounded-lg bg-gray-100 text-gray-600">
            {mobileMenuOpen
              ? <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              : <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/></svg>
            }
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-white border-b shadow-lg z-30 px-4 py-3 flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-1 mb-1">
            <button onClick={()=>navigateTo('kanban')} className={`py-2.5 rounded-lg text-sm font-medium ${view==='kanban'?'bg-blue-600 text-white':'bg-gray-100 text-gray-700'}`}>Pipeline</button>
            <button onClick={()=>navigateTo('list')} className={`py-2.5 rounded-lg text-sm font-medium ${view==='list'?'bg-blue-600 text-white':'bg-gray-100 text-gray-700'}`}>Lista</button>
            <button onClick={()=>navigateTo('dashboard')} className={`py-2.5 rounded-lg text-sm font-medium ${view==='dashboard'?'bg-blue-600 text-white':'bg-gray-100 text-gray-700'}`}>Dashboard</button>
          </div>
          <div className="grid grid-cols-2 gap-1 mb-1">
            <button onClick={()=>navigateTo('tasks')} className={`relative py-2.5 rounded-lg text-sm font-medium border ${view==='tasks'?'bg-orange-500 text-white border-orange-500':'bg-white text-orange-500 border-orange-300'}`}>
              Task
              {taskScadute>0 && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{taskScadute}</span>}
            </button>
            <button onClick={()=>navigateTo('leads')} className={`relative py-2.5 rounded-lg text-sm font-medium border ${view==='leads'?'bg-purple-600 text-white border-purple-600':'bg-white text-purple-600 border-purple-300'}`}>
              Lead
              {leadNonViste>0 && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{leadNonViste}</span>}
            </button>
          </div>
          <div className="border-t pt-2 flex flex-col gap-1">
            {view!=='leads' && <button onClick={()=>{setShowForm(true);setMobileMenuOpen(false)}} className="bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium">+ Nuovo Affare</button>}
            <button onClick={()=>{setConfirmLogout(true);setMobileMenuOpen(false)}} className="bg-gray-200 text-gray-700 py-2.5 rounded-lg text-sm">Esci</button>
          </div>
        </div>
      )}

      {/* ── BOTTOM NAV (mobile only) ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t z-40 flex safe-bottom">
        {[
          {v:'home' as View, label:'Home', icon:<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>, color:'text-blue-600', badge:0},
          {v:'contacts' as View, label:'Contatti', icon:<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>, color:'text-blue-600', badge:0},
          {v:'kanban' as View, label:'Pipeline', icon:<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/></svg>, color:'text-blue-600', badge:0},
          {v:'tasks' as View, label:'Task', icon:<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>, color:'text-orange-500', badge:taskScadute},
          {v:'leads' as View, label:'Lead', icon:<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>, color:'text-purple-600', badge:leadNonViste},
          {v:'dashboard' as View, label:'Stats', icon:<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>, color:'text-blue-600', badge:0},
        ].map(({v,label,icon,color,badge})=>(
          <button key={v} onClick={()=>navigateTo(v)} className={`relative flex-1 py-2 flex flex-col items-center gap-0.5 text-xs ${view===v?color:'text-gray-400'}`}>
            {icon}{label}
            {badge>0 && <span className="absolute top-1 right-3 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1">{badge}</span>}
          </button>
        ))}
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className="pb-20 md:pb-0">

      {/* ── KANBAN ── */}
      {/* ── HOME ── */}
      {view==='home' && (() => {
        const today = toYMD(new Date())
        const monthRange = getCurrentMonthRange()
        const venditeM = deals.filter(d => d.stage==='Vendita' && d.entry_date && d.entry_date >= monthRange.from && d.entry_date <= monthRange.to)
        const valoreVendite = venditeM.reduce((s,d)=>s+(d.estimate||0),0)
        const valorePonderato = deals.filter(d=>d.probability!=null&&d.probability>0).reduce((s,d)=>s+(d.estimate||0)*(d.probability||0)/100,0)
        const leadNonVisteLista = leads.filter(l=>!l.lead_viewed_at)
        const taskScaduteList = allTasks.filter(t=>!t.done&&t.due_date&&t.due_date<today)
        const taskOggiList = allTasks.filter(t=>!t.done&&t.due_date&&t.due_date===today)
        const taskFuture = allTasks.filter(t=>!t.done&&(!t.due_date||(t.due_date>today)))
        return (
          <div className="p-4 sm:p-6 max-w-5xl mx-auto">
            {/* Saluto */}
            <h1 className="text-xl font-bold text-gray-800 mb-1">Buongiorno 👋</h1>
            <p className="text-sm text-gray-400 mb-5">{new Date().toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})}</p>

            {/* KPI */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div onClick={()=>navigateTo('leads')} className="bg-white rounded-xl shadow p-4 cursor-pointer hover:shadow-md transition-shadow">
                <p className="text-xs text-gray-400 mb-1">Lead non viste</p>
                <p className={`text-2xl font-bold ${leadNonVisteLista.length>0?'text-red-500':'text-gray-300'}`}>{leadNonVisteLista.length}</p>
              </div>
              <div onClick={()=>navigateTo('tasks')} className="bg-white rounded-xl shadow p-4 cursor-pointer hover:shadow-md transition-shadow">
                <p className="text-xs text-gray-400 mb-1">Task scadute</p>
                <p className={`text-2xl font-bold ${taskScaduteList.length>0?'text-red-500':'text-gray-300'}`}>{taskScaduteList.length}</p>
              </div>
              <div className="bg-white rounded-xl shadow p-4">
                <p className="text-xs text-gray-400 mb-1">Vendite del mese</p>
                <p className="text-2xl font-bold text-green-600">{valoreVendite>0?`€ ${Math.round(valoreVendite/1000)}k`:venditeM.length}</p>
              </div>
              <div className="bg-white rounded-xl shadow p-4">
                <p className="text-xs text-gray-400 mb-1">Pipeline ponderata</p>
                <p className="text-2xl font-bold text-blue-600">{valorePonderato>0?`€ ${Math.round(valorePonderato/1000)}k`:'—'}</p>
              </div>
            </div>

            {/* Azioni rapide */}
            <div className="flex gap-3 mb-6">
              <button onClick={()=>setShowIngressoForm(true)} className="flex-1 bg-green-600 text-white rounded-xl py-3 font-semibold text-sm hover:bg-green-700 transition-colors">+ Nuovo Ingresso</button>
              <button onClick={()=>setShowNewTask(true)} className="flex-1 bg-orange-500 text-white rounded-xl py-3 font-semibold text-sm hover:bg-orange-600 transition-colors">+ Nuova Task</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Lead non viste */}
              <div className="bg-white rounded-xl shadow p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold text-gray-700">Lead non viste</h2>
                  <button onClick={()=>navigateTo('leads')} className="text-xs text-purple-600 hover:underline">Vedi tutte →</button>
                </div>
                {leadNonVisteLista.length===0 ? (
                  <p className="text-sm text-gray-300 text-center py-4">Nessuna lead in attesa ✓</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {leadNonVisteLista.slice(0,5).map(lead=>(
                      <div key={lead.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-purple-50 border border-purple-100 hover:bg-purple-100 transition-colors">
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={async()=>{await supabase.from('deals').update({lead_viewed_at:new Date().toISOString()}).eq('id',lead.id);fetchDeals();goToDeal(lead)}}>
                          <p className="font-semibold text-sm text-gray-800 truncate">{lead.contact_name}</p>
                          <p className="text-xs text-gray-400">{lead.lead_stage||'Nuovo'} · {formatDate(lead.created_at.split('T')[0])}</p>
                        </div>
                        <button onClick={async(e)=>{e.stopPropagation();await supabase.from('deals').update({lead_viewed_at:new Date().toISOString()}).eq('id',lead.id);fetchDeals()}} className="text-[10px] text-gray-400 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 flex-shrink-0">✓ Letto</button>
                        <span className="text-gray-300 text-xs flex-shrink-0 cursor-pointer" onClick={async()=>{await supabase.from('deals').update({lead_viewed_at:new Date().toISOString()}).eq('id',lead.id);fetchDeals();goToDeal(lead)}}>→</span>
                      </div>
                    ))}
                    {leadNonVisteLista.length>5 && <p className="text-xs text-center text-gray-400 mt-1">+{leadNonVisteLista.length-5} altre</p>}
                  </div>
                )}
              </div>

              {/* Task */}
              <div className="bg-white rounded-xl shadow p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold text-gray-700">Task</h2>
                  <button onClick={()=>navigateTo('tasks')} className="text-xs text-orange-500 hover:underline">Vedi tutte →</button>
                </div>
                {taskScaduteList.length===0 && taskOggiList.length===0 && taskFuture.length===0 ? (
                  <p className="text-sm text-gray-300 text-center py-4">Nessuna task ✓</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {taskScaduteList.slice(0,3).map(t=>(
                      <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg bg-red-50 border border-red-100 hover:bg-red-100 transition-colors">
                        <input type="checkbox" className="w-4 h-4 accent-orange-500 flex-shrink-0" checked={t.done} onClick={e=>e.stopPropagation()} onChange={async(e)=>{e.stopPropagation();await supabase.from('tasks').update({done:true}).eq('id',t.id);fetchDeals()}} />
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={()=>t.deal_id&&router.push(`/deal/${t.deal_id}`)}>
                          <p className="text-sm font-medium text-gray-800 truncate">{t.title}</p>
                          <p className="text-xs text-red-400">{t.deals?.contact_name} · scad. {formatDate(t.due_date)}</p>
                        </div>
                        {t.deal_id && <span className="text-gray-300 text-xs flex-shrink-0 cursor-pointer" onClick={()=>router.push(`/deal/${t.deal_id}`)}>→</span>}
                      </div>
                    ))}
                    {taskOggiList.slice(0,3).map(t=>(
                      <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg bg-orange-50 border border-orange-100 hover:bg-orange-100 transition-colors">
                        <input type="checkbox" className="w-4 h-4 accent-orange-500 flex-shrink-0" checked={t.done} onClick={e=>e.stopPropagation()} onChange={async(e)=>{e.stopPropagation();await supabase.from('tasks').update({done:true}).eq('id',t.id);fetchDeals()}} />
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={()=>t.deal_id&&router.push(`/deal/${t.deal_id}`)}>
                          <p className="text-sm font-medium text-gray-800 truncate">{t.title}</p>
                          <p className="text-xs text-orange-400">{t.deals?.contact_name} · oggi</p>
                        </div>
                        {t.deal_id && <span className="text-gray-300 text-xs flex-shrink-0 cursor-pointer" onClick={()=>router.push(`/deal/${t.deal_id}`)}>→</span>}
                      </div>
                    ))}
                    {taskFuture.slice(0,2).map(t=>(
                      <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors">
                        <input type="checkbox" className="w-4 h-4 accent-orange-500 flex-shrink-0" checked={t.done} onClick={e=>e.stopPropagation()} onChange={async(e)=>{e.stopPropagation();await supabase.from('tasks').update({done:true}).eq('id',t.id);fetchDeals()}} />
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={()=>t.deal_id&&router.push(`/deal/${t.deal_id}`)}>
                          <p className="text-sm font-medium text-gray-800 truncate">{t.title}</p>
                          <p className="text-xs text-gray-400">{t.deals?.contact_name}{t.due_date?` · ${formatDate(t.due_date)}`:''}</p>
                        </div>
                        {t.deal_id && <span className="text-gray-300 text-xs flex-shrink-0 cursor-pointer" onClick={()=>router.push(`/deal/${t.deal_id}`)}>→</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {view==='kanban' && (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="p-3 sm:p-4 pb-0">
            <div className="bg-white rounded-xl shadow px-3 py-2 flex items-center gap-2 text-xs sm:text-sm flex-wrap">
              
              <input type="date" className="border rounded-lg p-1.5 text-xs" value={kanbanVenditaFrom} onChange={e=>setKanbanVenditaFrom(e.target.value)} />
              <span className="text-gray-400">→</span>
              <input type="date" className="border rounded-lg p-1.5 text-xs" value={kanbanVenditaTo} onChange={e=>setKanbanVenditaTo(e.target.value)} />
              <button onClick={()=>{const r=getCurrentMonthRange();setKanbanVenditaFrom(r.from);setKanbanVenditaTo(r.to)}} className="text-xs text-blue-600 underline">Mese</button>
            </div>
          </div>
          <div className="p-3 sm:p-4 overflow-x-auto sm:overflow-x-visible" style={{WebkitOverflowScrolling:'touch'}}>
            <div className="flex gap-3" style={{minWidth:'max-content'} as React.CSSProperties}>
              {STAGES.map(stage => {
                const stageDeals = kanbanDeals(stage)
                const total = stageDeals.reduce((sum,d)=>sum+(d.estimate||0),0)
                const weighted = stageDeals.reduce((sum,d)=>sum+(d.estimate||0)*(d.probability||0)/100,0)
                return (
                  <Droppable droppableId={stage} key={stage}>
                    {(provided,snapshot) => (
                      <div ref={provided.innerRef} {...provided.droppableProps}
                        className={`rounded-xl p-2.5 flex flex-col sm:flex-1 ${snapshot.isDraggingOver?'bg-blue-100':'bg-gray-200'}`}
                        style={{width:'200px', minWidth:'200px'} as React.CSSProperties}>
                        <h2 className="font-semibold text-gray-700 text-xs leading-tight">{stage}</h2>
                        <p className="text-xs text-gray-500">{stageDeals.length} affari</p>
                        {total>0 && <p className="text-xs text-green-700 font-semibold">€ {total.toLocaleString()}</p>}
                        {weighted>0 && weighted!==total && <p className="text-xs text-blue-600">pond. € {Math.round(weighted).toLocaleString()}</p>}
                        <div className="flex flex-col gap-2 mt-2 flex-1">
                          {stageDeals.map((deal,index) => (
                            <Draggable key={deal.id} draggableId={deal.id} index={index}>
                              {(provided,snapshot) => (
                                <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}
                                  onClick={()=>goToDeal(deal)}
                                  className={`bg-white rounded-lg p-2.5 cursor-pointer ${snapshot.isDragging?'shadow-xl rotate-1':'shadow hover:shadow-md'}`}>
                                  <p className="font-semibold text-xs text-gray-800 leading-tight">{deal.contact_name||deal.title}</p>
                                  {deal.estimate>0 && <p className="text-xs text-green-600 mt-0.5">€ {deal.estimate.toLocaleString()}</p>}
                                  {deal.environment && <p className="text-xs text-blue-500 truncate">{deal.environment}</p>}
                                  <p className="text-xs text-gray-400 mt-0.5">Inserimento: {formatDate(deal.created_at)}</p>
                                  {deal.entry_date && <p className="text-xs text-gray-500">Ingresso: {formatDate(deal.entry_date)}</p>}
                                  {deal.appointment_date && <p className="text-xs text-orange-500">📅 {formatDate(deal.appointment_date)}</p>}
                                  {deal.probability !== null && deal.probability !== undefined && (
                                    <span className={`inline-block mt-1 text-xs px-1.5 py-0.5 rounded-full font-medium ${PROB_COLORS[deal.probability]||'bg-gray-100 text-gray-600'}`}>{deal.probability}%</span>
                                  )}
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                        <button onClick={()=>{setQuickAddStage(stage);setQuickForm({...emptyDeal,stage})}} className="mt-2 w-full flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-white rounded-lg py-1 text-sm transition-colors">+</button>
                      </div>
                    )}
                  </Droppable>
                )
              })}
            </div>
          </div>
        </DragDropContext>
      )}

      {/* ── LISTA ── */}
      {view==='list' && (
        <div className="p-3 sm:p-6">
          <div className="bg-white rounded-xl shadow p-3 sm:p-4 mb-4 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <label className="text-xs font-semibold text-gray-700 whitespace-nowrap">Raggruppa:</label>
              <select className="border rounded-lg p-2 text-xs flex-1 sm:flex-none" value={groupBy} onChange={e=>setGroupBy(e.target.value)}>
                <option value="none">Nessuno</option><option value="stage">Fase</option><option value="origin">Origine</option><option value="environment">Ambiente</option><option value="project_timeline">Tempi</option>
              </select>
            </div>
            <div className="flex items-center gap-1 w-full sm:w-auto">
              <label className="text-xs font-semibold text-gray-700 whitespace-nowrap">Periodo:</label>
              <input type="date" className="border rounded-lg p-1.5 text-xs flex-1" value={listDateFrom} onChange={e=>{setListDateFrom(e.target.value);setListDateActive(true)}} />
              <span className="text-gray-400 text-xs">→</span>
              <input type="date" className="border rounded-lg p-1.5 text-xs flex-1" value={listDateTo} onChange={e=>{setListDateTo(e.target.value);setListDateActive(true)}} />
              {listDateActive && <button onClick={()=>setListDateActive(false)} className="text-xs text-gray-400 underline whitespace-nowrap">Tutti</button>}
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {ENVIRONMENTS.map(env=>{const active=listEnvFilter.includes(env);return <button key={env} type="button" onClick={()=>setListEnvFilter(prev=>active?prev.filter(e=>e!==env):[...prev,env])} className={`px-2 py-1 rounded-full text-xs border ${active?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-600 border-gray-300'}`}>{env}</button>})}
              {listEnvFilter.length>0 && <button onClick={()=>setListEnvFilter([])} className="text-xs text-gray-400 underline">✕</button>}
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
              <button onClick={()=>setFilterAggiudicati(p=>!p)} className={`px-2.5 py-1 rounded-full text-xs font-medium border ${filterAggiudicati?'bg-green-600 text-white border-green-600':'bg-white text-gray-600 border-gray-300'}`}>🏆 Aggiudicati</button>
              <div className="flex items-center gap-2 ml-auto sm:ml-0">
                <span className="text-xs text-gray-400">{listDeals.length}</span>
                <button onClick={downloadCSV} className="flex items-center gap-1 bg-gray-800 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  CSV
                </button>
              </div>
            </div>
          </div>
          <BulkActionBar dealsInView={listDeals} />
          {Object.entries(getGroupedDeals(listDeals)).map(([group,groupDeals]) => (
            <div key={group} className="mb-6">
              {groupBy!=='none' && <h2 className="font-bold text-gray-700 mb-2 text-sm">{group} <span className="text-gray-400 font-normal">({groupDeals.length})</span></h2>}
              <div className="bg-white rounded-xl shadow overflow-hidden">
                <div className="overflow-x-auto" style={{WebkitOverflowScrolling:'touch'}}>
                  <table className="w-full text-xs" style={{minWidth:'480px'}}>
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="p-2 w-8"><input type="checkbox" onChange={()=>toggleSelectAll(groupDeals)} checked={groupDeals.length>0&&groupDeals.every(d=>selectedIds.has(d.id))} /></th>
                        <th className="text-left p-2 font-semibold cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap" onClick={()=>toggleListSort('contact_name')}>
                          Contatto {listSortCol==='contact_name'?(listSortDir==='asc'?'↑':'↓'):<span className="text-gray-300">↕</span>}
                        </th>
                        {listCols.map(({label,col},idx)=>(
                          <th key={col} draggable onDragStart={()=>setDragColIdx(idx)} onDragOver={e=>e.preventDefault()}
                            onDrop={()=>{if(dragColIdx===null||dragColIdx===idx)return;const next=[...listCols];const[moved]=next.splice(dragColIdx,1);next.splice(idx,0,moved);setListCols(next);setDragColIdx(null)}}
                            onDragEnd={()=>setDragColIdx(null)}
                            className={`text-left p-2 cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap ${dragColIdx===idx?'opacity-40':''}`}
                            onClick={()=>toggleListSort(col)}>
                            <span className="inline-flex items-center gap-0.5">
                              {label} {listSortCol===col?(listSortDir==='asc'?'↑':'↓'):<span className="text-gray-300">↕</span>}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groupDeals.map(deal => (
                        <tr key={deal.id} className={`border-t hover:bg-gray-50 ${selectedIds.has(deal.id)?'bg-blue-50':''}`}>
                          <td className="p-2" onClick={e=>{e.stopPropagation();toggleSelect(deal.id)}}><input type="checkbox" checked={selectedIds.has(deal.id)} onChange={()=>toggleSelect(deal.id)} /></td>
                          <td className="p-2 font-medium whitespace-nowrap">
                            {inlineEdit?.id===deal.id&&inlineEdit.col==='contact_name'?(
                              <input autoFocus className="border rounded px-2 py-1 text-xs w-28 font-medium" value={inlineEdit.val}
                                onChange={e=>setInlineEdit({...inlineEdit,val:e.target.value})} onBlur={saveInlineEdit}
                                onKeyDown={e=>{if(e.key==='Enter')saveInlineEdit();if(e.key==='Escape')setInlineEdit(null)}} onClick={e=>e.stopPropagation()} />
                            ):(
                              <span className="cursor-pointer hover:text-blue-600 hover:underline" onClick={()=>goToDeal(deal)}>{deal.contact_name||<span className="text-gray-300 italic">—</span>}</span>
                            )}
                          </td>
                          {listCols.map(({col})=>{
                            const readonly = col==='created_at'||col==='weighted'
                            const rawVal: any = (deal as any)[col]
                            let display: any = rawVal
                            if(col==='entry_date'||col==='appointment_date') display=formatDate(rawVal||'')
                            else if(col==='created_at') display=formatDate((rawVal||'').split('T')[0])
                            else if(col==='estimate') display=Number(rawVal)>0?`€ ${Number(rawVal).toLocaleString()}`:'-'
                            else if(col==='probability') display=rawVal!=null?`${rawVal}%`:'-'
                            else if(col==='weighted') { const w=deal.estimate&&deal.probability!=null?Math.round(deal.estimate*deal.probability/100):null; display=w!=null&&w>0?`€ ${w.toLocaleString()}`:'-' }
                            else display=rawVal||'-'
                            const isEditing=inlineEdit?.id===deal.id&&inlineEdit.col===col
                            const editVal=inlineEdit?.val??''
                            return (
                              <td key={col} className={`p-2 whitespace-nowrap relative ${readonly?'text-gray-400':col==='estimate'||col==='weighted'?'text-green-600':col==='created_at'||col==='entry_date'||col==='appointment_date'?'text-gray-500':'text-gray-600'} ${readonly?'cursor-default':'cursor-text'}`}
                                onClick={e=>{e.stopPropagation();if(readonly)return;const current=col==='entry_date'||col==='appointment_date'?rawVal||'':col==='estimate'||col==='probability'?String(rawVal||''):rawVal||'';setInlineEdit({id:deal.id,col,val:current})}}>
                                {isEditing?(
                                  col==='stage'?(<select autoFocus className="border rounded px-2 py-1 text-xs" value={editVal} onChange={e=>setInlineEdit({...inlineEdit!,val:e.target.value})} onBlur={saveInlineEdit} onKeyDown={e=>{if(e.key==='Escape')setInlineEdit(null)}} onClick={e=>e.stopPropagation()}>{STAGES.map(s=><option key={s}>{s}</option>)}</select>)
                                  :col==='probability'?(<select autoFocus className="border rounded px-2 py-1 text-xs" value={editVal} onChange={e=>setInlineEdit({...inlineEdit!,val:e.target.value})} onBlur={saveInlineEdit} onKeyDown={e=>{if(e.key==='Escape')setInlineEdit(null)}} onClick={e=>e.stopPropagation()}><option value="">—</option>{PROB_OPTIONS.map(p=><option key={p} value={p}>{p}%</option>)}</select>)
                                  :col==='entry_date'||col==='appointment_date'?(<input autoFocus type="date" className="border rounded px-2 py-1 text-xs" value={editVal} onChange={e=>setInlineEdit({...inlineEdit!,val:e.target.value})} onBlur={saveInlineEdit} onKeyDown={e=>{if(e.key==='Enter')saveInlineEdit();if(e.key==='Escape')setInlineEdit(null)}} onClick={e=>e.stopPropagation()} />)
                                  :col==='estimate'?(<input autoFocus type="number" className="border rounded px-2 py-1 text-xs w-20" value={editVal} onChange={e=>setInlineEdit({...inlineEdit!,val:e.target.value})} onBlur={saveInlineEdit} onKeyDown={e=>{if(e.key==='Enter')saveInlineEdit();if(e.key==='Escape')setInlineEdit(null)}} onClick={e=>e.stopPropagation()} />)
                                  :col==='environment'?(
                                    <div className="flex flex-wrap gap-1 bg-white border rounded-lg p-2 shadow-lg z-10 absolute" onClick={e=>e.stopPropagation()} style={{minWidth:'200px'}}>
                                      {ENVIRONMENTS.map(env=>{const sel=editVal.split(',').map((s:string)=>s.trim()).filter(Boolean);const active=sel.includes(env);return <button key={env} type="button" className={`px-2 py-1 rounded-full text-xs border transition-colors ${active?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`} onClick={e=>{e.stopPropagation();const next=active?sel.filter((x:string)=>x!==env):[...sel,env];setInlineEdit({...inlineEdit!,val:next.join(', ')})}}>{env}</button>})}
                                      <div className="w-full flex justify-end gap-1 mt-1 pt-1 border-t">
                                        <button className="text-xs text-gray-500 px-2 py-1" onClick={e=>{e.stopPropagation();setInlineEdit(null)}}>Annulla</button>
                                        <button className="text-xs bg-blue-600 text-white px-2 py-1 rounded" onClick={e=>{e.stopPropagation();saveInlineEdit()}}>OK</button>
                                      </div>
                                    </div>
                                  ):(<input autoFocus className="border rounded px-2 py-1 text-xs w-24" value={editVal} onChange={e=>setInlineEdit({...inlineEdit!,val:e.target.value})} onBlur={saveInlineEdit} onKeyDown={e=>{if(e.key==='Enter')saveInlineEdit();if(e.key==='Escape')setInlineEdit(null)}} onClick={e=>e.stopPropagation()} />)
                                ):(
                                  col==='stage'?<span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs">{display}</span>
                                  :col==='probability'&&rawVal!=null?<span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${PROB_COLORS[rawVal]||'bg-gray-100 text-gray-600'}`}>{display}</span>
                                  :<span className={`rounded ${readonly?'':'hover:bg-blue-50'}`}>{display}</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {groupDeals.length===0 && <p className="text-center text-gray-400 py-8 text-sm">Nessun contatto nel periodo</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── DASHBOARD ── */}
      {view==='dashboard' && (
        <div className="p-3 sm:p-6">
          <div className="bg-white rounded-xl shadow p-3 mb-4">
            <div className="flex flex-wrap gap-1.5">
              <button onClick={()=>applyQuick('today')} className={btnClass('today')}>Oggi</button>
              <button onClick={()=>applyQuick('week')} className={btnClass('week')}>Settimana</button>
              <button onClick={()=>applyQuick('month')} className={btnClass('month')}>Mese</button>
              <button onClick={()=>applyQuick('lastmonth')} className={btnClass('lastmonth')}>Scorso</button>
              <button onClick={()=>applyQuick('alltime')} className={btnClass('alltime')}>Tutto</button>
              {activeQuick!=='alltime' && (
                <div className="flex items-center gap-1 w-full mt-1">
                  <input type="date" className="border rounded-lg p-1.5 text-xs flex-1" value={dateFrom} onChange={e=>{setActiveQuick('custom');setDateFrom(e.target.value)}} />
                  <span className="text-gray-400 text-xs">→</span>
                  <input type="date" className="border rounded-lg p-1.5 text-xs flex-1" value={dateTo} onChange={e=>{setActiveQuick('custom');setDateTo(e.target.value)}} />
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-white rounded-xl shadow p-3 sm:p-5 border-l-4 border-green-500">
              <p className="text-gray-500 text-xs">Vendite certe</p>
              <p className="text-xl sm:text-3xl font-bold text-green-600 mt-1">€ {venditeCerte.toLocaleString()}</p>
              <p className="text-xs text-gray-400">{vendite.length} vendite</p>
            </div>
            <div className="bg-white rounded-xl shadow p-3 sm:p-5 border-l-4 border-blue-500">
              <p className="text-gray-500 text-xs">Pipeline pond.</p>
              <p className="text-xl sm:text-3xl font-bold text-blue-600 mt-1">€ {Math.round(pipelineTotal).toLocaleString()}</p>
              <p className="text-xs text-gray-400">× probabilità</p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-3 sm:p-5 mb-4">
            <p className="font-semibold text-gray-700 text-sm mb-3">Ingressi per giorno</p>
            {days.length===0?<p className="text-gray-400 text-sm">Nessun dato</p>:(
              <div className="flex items-end gap-1" style={{height:'80px'}}>
                {days.map(day=>{const count=dayMap[day];const parts=day.split('-');const label=`${parts[2]}/${parts[1]}`;return(
                  <div key={day} className="flex flex-col items-center flex-1 min-w-0">
                    <div className="w-full flex flex-col justify-end" style={{height:'65px'}}><div style={{height:`${Math.round((count/maxDay)*65)}px`}} className="bg-blue-400 w-full rounded-t-sm"/></div>
                    <span className="text-gray-400 mt-0.5 truncate w-full text-center" style={{fontSize:'7px'}}>{label}</span>
                  </div>
                )})}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-white rounded-xl shadow p-3"><p className="text-xs text-gray-500">Ingressi</p><p className="text-xl font-bold text-gray-800">{ingressiCount}</p></div>
            <div className="bg-white rounded-xl shadow p-3"><p className="text-xs text-gray-500">Medio ingresso</p><p className="text-base font-bold text-gray-800">€ {avgIngresso.toLocaleString()}</p></div>
            <div className="bg-white rounded-xl shadow p-3"><p className="text-xs text-gray-500">Medio vendita</p><p className="text-base font-bold text-green-600">€ {avgVendita.toLocaleString()}</p></div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-white rounded-xl shadow p-3"><p className="text-xs text-gray-500">Medio prev.</p><p className="text-base font-bold text-blue-600">€ {avgPreventivo.toLocaleString()}</p></div>
            <div className="bg-white rounded-xl shadow p-3"><p className="text-xs text-gray-500">Conv. ingresso</p><p className="text-xl font-bold text-purple-600">{tassoConvIngresso}%</p></div>
            <div className="bg-white rounded-xl shadow p-3"><p className="text-xs text-gray-500">Conv. prev.</p><p className="text-xl font-bold text-orange-500">{tassoConvPreventivo}%</p></div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[{title:'Venduto per ambiente',data:envSoldData,fmt:(v:number)=>`€ ${v.toLocaleString()}`},{title:'Ingressi per ambiente',data:envCountData,fmt:(v:number)=>`${v}`}].map(({title,data,fmt})=>(
              <div key={title} className="bg-white rounded-xl shadow p-3 sm:p-5">
                <p className="font-semibold text-gray-700 text-sm mb-3">{title}</p>
                <div className="flex items-center gap-3">
                  <PieChart data={data} size={100}/>
                  <div className="flex flex-col gap-1 text-xs flex-1 min-w-0">
                    {data.filter(d=>d.value>0).map(d=>(<div key={d.label} className="flex items-center gap-1.5 min-w-0"><span className="w-2 h-2 rounded-full flex-shrink-0" style={{background:d.color}}/><span className="text-gray-600 truncate">{d.label}</span><span className="text-gray-400 ml-auto flex-shrink-0">{fmt(d.value)}</span></div>))}
                    {data.every(d=>d.value===0)&&<p className="text-gray-400">Nessun dato</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── LEAD ── */}
      {view==='leads' && (
        <div className="p-3 sm:p-6 overflow-x-auto sm:overflow-x-visible" style={{WebkitOverflowScrolling:'touch', minHeight:'calc(100vh - 120px)'}}>
          {/* Filtro date */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-sm text-gray-500">Ultima modifica fase:</span>
            <input type="date" className="border rounded-lg px-2 py-1.5 text-sm" value={leadFrom} onChange={e=>setLeadFrom(e.target.value)} />
            <span className="text-gray-400">→</span>
            <input type="date" className="border rounded-lg px-2 py-1.5 text-sm" value={leadTo} onChange={e=>setLeadTo(e.target.value)} />
            <button onClick={()=>{const d=leadDefault30();setLeadFrom(d.from);setLeadTo(d.to)}} className="text-xs text-blue-600 underline">30 giorni</button>
          </div>
          <div className="flex gap-3 pb-4 sm:pb-0 h-full" style={{minWidth:'max-content'} as React.CSSProperties}>
            {(['Nuovo','Contattato','Qualificato','Non Qualificato'] as const).map(stage => {
              const stageLeads = leads.filter(l => {
                if ((l.lead_stage||'Nuovo') !== stage) return false
                const d = (l.lead_stage_updated_at || l.created_at)?.split('T')[0] || ''
                if (leadFrom && d < leadFrom) return false
                if (leadTo && d > leadTo) return false
                return true
              })
              return (
                <div key={stage} className="sm:flex-1" style={{width:'220px', minWidth:'220px'} as React.CSSProperties}>
                  <div className={`rounded-t-xl px-3 py-2.5 flex items-center justify-between ${stage==='Nuovo'?'bg-gray-700':stage==='Contattato'?'bg-blue-600':stage==='Qualificato'?'bg-green-600':'bg-red-500'}`}>
                    <span className="text-white font-semibold text-sm">{stage}</span>
                    <span className="bg-white bg-opacity-20 text-white text-xs px-2 py-0.5 rounded-full">{stageLeads.length}</span>
                  </div>
                  <div className="bg-gray-100 rounded-b-xl p-2 flex flex-col gap-2 min-h-24" onDragOver={e=>e.preventDefault()} onDrop={async e=>{e.preventDefault();const id=e.dataTransfer.getData('leadId');if(id){await supabase.from('deals').update({lead_stage:stage, lead_stage_updated_at: new Date().toISOString()}).eq('id',id);fetchDeals()}}}>
                    {stageLeads.map(lead => {
                      const isNew = !lead.lead_viewed_at
                      return (
                      <div key={lead.id} draggable onDragStart={e=>{e.dataTransfer.setData('leadId',lead.id)}}
                        className={`bg-white rounded-lg p-2.5 shadow cursor-grab active:cursor-grabbing relative ${isNew?'ring-2 ring-purple-400':''}`}
                        onClick={async()=>{if(isNew){await supabase.from('deals').update({lead_viewed_at:new Date().toISOString()}).eq('id',lead.id);fetchDeals()}; goToDeal(lead)}}>
                        {isNew && <span className="absolute top-1.5 right-1.5 bg-purple-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">NEW</span>}
                        <p className="font-semibold text-sm text-gray-800 pr-8">{lead.contact_name}</p>
                        {lead.phone&&<p className="text-xs text-gray-500 mt-0.5">{lead.phone}</p>}
                        {(lead.origin||lead.environment)&&<div className="flex gap-2 mt-0.5">{lead.origin&&<p className="text-xs text-blue-400">{lead.origin}</p>}{lead.environment&&<p className="text-xs text-green-600">{lead.environment}</p>}</div>}
                        <p className="text-xs text-gray-400 mt-0.5">{formatDate(lead.created_at.split('T')[0])}</p>
                        <div className="flex gap-1 mt-1.5" onClick={e=>e.stopPropagation()}>
                          {isNew && <button onClick={async()=>{await supabase.from('deals').update({lead_viewed_at:new Date().toISOString()}).eq('id',lead.id);fetchDeals()}} className="text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50">✓ Segna letto</button>}
                        </div>
                        {stage==='Qualificato'&&(<button onClick={e=>{e.stopPropagation();setConvertingLead(lead)}} className="mt-1.5 w-full text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white">⇒ Converti</button>)}
                      </div>
                    )})}
                    <button onClick={()=>setShowLeadForm(true)} className="text-xs text-gray-400 py-2 text-center border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400">+ Aggiungi</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── TASK ── */}
      {view==='tasks' && (
        <div className="p-3 sm:p-6 max-w-4xl mx-auto">
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-gray-800">Task</h2>
                <button onClick={()=>setShowNewTask(true)} className="bg-orange-500 text-white px-2.5 py-1.5 rounded-lg text-xs hover:bg-orange-600">+ Nuova</button>
              </div>
              <div className="flex border rounded-lg overflow-hidden">
                <button onClick={()=>setTaskFilter('todo')} className={`px-2.5 py-1.5 text-xs ${taskFilter==='todo'?'bg-orange-500 text-white':'bg-white text-gray-600'}`}>Da fare</button>
                <button onClick={()=>setTaskFilter('done')} className={`px-2.5 py-1.5 text-xs ${taskFilter==='done'?'bg-orange-500 text-white':'bg-white text-gray-600'}`}>Fatti</button>
                <button onClick={()=>setTaskFilter('all')} className={`px-2.5 py-1.5 text-xs ${taskFilter==='all'?'bg-orange-500 text-white':'bg-white text-gray-600'}`}>Tutti</button>
              </div>
            </div>
            {(()=>{
              const today=toYMD(new Date())
              const filtered=allTasks.filter(t=>taskFilter==='all'?true:taskFilter==='todo'?!t.done:t.done).sort((a,b)=>{const da=a.due_date||a.created_at.split('T')[0];const db=b.due_date||b.created_at.split('T')[0];return da<db?-1:da>db?1:0})
              if(filtered.length===0) return <p className="text-gray-400 text-sm text-center py-8">Nessun task</p>
              const groups: Record<string,typeof filtered>={}
              filtered.forEach(t=>{const day=t.due_date||t.created_at.split('T')[0];if(!groups[day])groups[day]=[];groups[day].push(t)})
              return (
                <div className="flex flex-col gap-4">
                  {Object.entries(groups).map(([day,tasks])=>(
                    <div key={day}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${day===today?'bg-orange-100 text-orange-600':day<today?'bg-red-100 text-red-500':'bg-gray-100 text-gray-500'}`}>{day===today?`${formatDate(day)} (oggi)`:formatDate(day)}</span>
                        <div className="flex-1 h-px bg-gray-100"/>
                      </div>
                      <div className="flex flex-col divide-y border rounded-lg overflow-hidden">
                        {(tasks as any[]).map(task=>(
                          <div key={task.id} className="flex items-start gap-3 px-3 py-3 bg-white hover:bg-gray-50 group">
                            <input type="checkbox" checked={task.done} onChange={async()=>{const nowDone=!task.done;await supabase.from('tasks').update({done:nowDone,completed_at:nowDone?new Date().toISOString():null}).eq('id',task.id);fetchDeals()}} className="mt-0.5 cursor-pointer flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              {editingTask?.id===task.id?(
                                <div className="flex flex-col gap-2 py-1">
                                  <input className="border rounded p-2 text-sm w-full" value={editingTask!.title} onChange={e=>setEditingTask(t=>t?{...t,title:e.target.value}:t)} autoFocus />
                                  <input type="date" className="border rounded p-2 text-xs" value={editingTask!.due_date} onChange={e=>setEditingTask(t=>t?{...t,due_date:e.target.value}:t)} />
                                  <div className="relative">
                                    <input className="border rounded p-2 text-xs w-full" placeholder="Associa contatto..." value={editTaskSearch}
                                      onChange={async e=>{
                                        const v=e.target.value
                                        setEditTaskSearch(v)
                                        // Reset associazione se l'utente modifica il testo
                                        setEditingTask(t=>t?{...t,deal_id:'',deal_name:''}:t)
                                        if(v.length>=2){const{data}=await supabase.from('deals').select('*').or(`contact_name.ilike.%${v}%,phone.ilike.%${v}%`).limit(5);setEditTaskSearchResults(data||[])}else setEditTaskSearchResults([])
                                      }} />
                                    {editTaskSearchResults.length>0&&(<div className="absolute z-10 left-0 right-0 border rounded bg-white shadow-lg mt-0.5 max-h-32 overflow-y-auto">{editTaskSearchResults.map(d=>(<button key={d.id} onClick={()=>{setEditingTask(t=>t?{...t,deal_id:d.id,deal_name:d.contact_name}:t);setEditTaskSearch(d.contact_name);setEditTaskSearchResults([])}} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 border-b"><span className="font-medium">{d.contact_name}</span></button>))}</div>)}
                                    {editingTask?.deal_name&&!editTaskSearchResults.length&&<p className="text-xs text-green-600 mt-0.5">✓ {editingTask.deal_name}</p>}
                                    {!editingTask?.deal_name&&editTaskSearch.trim().length>=2&&editTaskSearchResults.length===0&&(
                                      <button onClick={async()=>{const nome=editTaskSearch.trim();const{data:nd}=await supabase.from('deals').insert({title:nome,contact_name:nome,stage:'Qualificato',is_lead:false,probability:null}).select().single();if(nd){setEditingTask(t=>t?{...t,deal_id:nd.id,deal_name:nd.contact_name}:t);setEditTaskSearch(nd.contact_name);fetchDeals()}}} className="mt-1 w-full text-left px-2 py-1.5 text-xs bg-blue-50 border border-blue-200 rounded text-blue-700 hover:bg-blue-100">+ Crea contatto &quot;{editTaskSearch.trim()}&quot;</button>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button onClick={async()=>{const et=editingTask!;await supabase.from('tasks').update({title:et.title,due_date:et.due_date||null,deal_id:et.deal_id||null}).eq('id',task.id);setEditingTask(null);setEditTaskSearch('');setEditTaskSearchResults([]);fetchDeals()}} className="text-xs bg-orange-500 text-white px-3 py-1.5 rounded">Salva</button>
                                    <button onClick={()=>{setEditingTask(null);setEditTaskSearch('');setEditTaskSearchResults([])}} className="text-xs text-gray-400">Annulla</button>
                                    <button onClick={async()=>{if(confirm('Eliminare?')){await supabase.from('tasks').delete().eq('id',task.id);setEditingTask(null);fetchDeals()}}} className="text-xs text-red-400 ml-auto">Elimina</button>
                                  </div>
                                </div>
                              ):(
                                <>
                                  <p className={`text-sm ${task.done?'line-through text-gray-400':'text-gray-800'}`}>{task.title}</p>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    {task.deals?.contact_name&&<button onClick={()=>router.push(`/deal/${task.deal_id}`)} className="text-xs text-blue-500 hover:underline">{task.deals.contact_name}</button>}
                                    {task.deals?.stage&&<span className="text-xs text-gray-400">{task.deals.stage}</span>}
                                    {task.auto&&<span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">auto</span>}
                                    {task.done&&task.completed_at&&<span className="text-xs text-green-500">✓ {new Date(task.completed_at).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'})} {new Date(task.completed_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</span>}
                                  </div>
                                </>
                              )}
                            </div>
                            {editingTask?.id!==task.id&&(
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button onClick={()=>{setEditingTask({id:task.id,title:task.title,due_date:task.due_date||'',deal_id:task.deal_id||'',deal_name:task.deals?.contact_name||''});setEditTaskSearch(task.deals?.contact_name||'');setEditTaskSearchResults([])}} className="p-1.5 rounded-lg text-gray-400 hover:text-orange-500 hover:bg-orange-50 transition-colors">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                </button>
                                <button onClick={async()=>{if(confirm('Eliminare questa task?')){await supabase.from('tasks').delete().eq('id',task.id);fetchDeals()}}} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ── CONTATTI ── */}
      {view==='contacts' && <ContactsView router={router} />}

      {/* ── MODALI (sheet su mobile) ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50" onKeyDown={e=>{if(e.key==='Escape'){setShowForm(false);setFormContactSearch('');setFormContactResults([]);setFormContactId(null);setFormTitle('');setFormEnvError(false)}}}>
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-5 w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Nuovo Affare</h2>
            <div className="flex flex-col gap-3">
              {/* Ricerca contatto con omonimi */}
              <div className="relative">
                <label className="text-xs text-gray-500">Contatto *</label>
                <input className="border rounded-lg p-3 w-full mt-1" placeholder="Cerca contatto esistente o scrivi nuovo..."
                  value={formContactSearch}
                  onChange={async e=>{
                    const v=e.target.value
                    setFormContactSearch(v); setFormContactId(null)
                    setForm(f=>({...f,contact_name:v,phone:'',email:'',origin:''}))
                    setFormTitle(buildDealTitle(v, form.environment))
                    if(v.length>=2){const{data}=await supabase.from('contacts').select('*').or(`name.ilike.%${v}%,phone.ilike.%${v}%`).limit(8);setFormContactResults(data||[])}else setFormContactResults([])
                  }} />
                {formContactResults.length>0&&(
                  <div className="absolute left-0 right-0 bg-white border rounded-lg shadow-lg z-10 mt-0.5" style={{maxHeight:'220px',overflowY:'auto'}}>
                    {formContactResults.map((c:any)=>(
                      <div key={c.id}
                        onClick={()=>{setFormContactId(c.id);setFormContactSearch(c.name);setForm(f=>({...f,contact_name:c.name,phone:c.phone||'',email:c.email||'',origin:c.origin||''}));setFormTitle(buildDealTitle(c.name,form.environment));setFormContactResults([])}}
                        className="p-3 hover:bg-blue-50 cursor-pointer border-b last:border-0 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">{c.name?.charAt(0)?.toUpperCase()}</div>
                        <div><p className="font-semibold text-sm">{c.name}</p>{c.phone&&<p className="text-xs text-gray-400">{c.phone}</p>}</div>
                      </div>
                    ))}
                    {/* Opzione crea nuovo anche se ci sono omonimi */}
                    <div onClick={()=>{setFormContactId(null);setFormContactResults([])}}
                      className="p-3 hover:bg-green-50 cursor-pointer text-green-700 font-medium text-sm flex items-center gap-2 border-t">
                      <span className="text-lg leading-none">+</span> Crea nuovo &quot;{formContactSearch}&quot;
                    </div>
                  </div>
                )}
                {formContactId&&<p className="text-xs text-green-600 mt-1">✓ Contatto esistente: {formContactSearch}</p>}
                {!formContactId&&formContactSearch.length>0&&formContactResults.length===0&&<p className="text-xs text-blue-500 mt-1">✦ Verrà creato un nuovo contatto</p>}
              </div>
              <input className="border rounded-lg p-3" placeholder="Telefono" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} />
              <input className="border rounded-lg p-3" placeholder="Email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} />
              <input className="border rounded-lg p-3" placeholder="Origine" value={form.origin} onChange={e=>setForm({...form,origin:e.target.value})} />
              {/* Ambiente obbligatorio */}
              <div>
                <label className={`text-xs font-medium ${formEnvError?'text-red-500':'text-gray-500'}`}>Ambiente * {formEnvError&&<span className="text-red-500">— obbligatorio</span>}</label>
                <EnvSelect value={form.environment} onChange={v=>{setForm(f=>({...f,environment:v}));setFormTitle(buildDealTitle(form.contact_name,v));setFormEnvError(false)}} />
              </div>
              {/* Nome affare auto-generato, modificabile */}
              <div>
                <label className="text-xs text-gray-500">Nome affare</label>
                <input className="border rounded-lg p-3 w-full mt-1 text-sm" placeholder="Es. Mario Rossi | Cucina"
                  value={formTitle}
                  onChange={e=>setFormTitle(e.target.value)} />
                <p className="text-xs text-gray-400 mt-0.5">Generato automaticamente, puoi modificarlo</p>
              </div>
              <label className="text-xs text-gray-500">Data ingresso</label><input className="border rounded-lg p-3" type="date" value={form.entry_date} onChange={e=>setForm({...form,entry_date:e.target.value})} />
              <label className="text-xs text-gray-500">Data appuntamento</label><input className="border rounded-lg p-3" type="date" value={form.appointment_date} onChange={e=>setForm({...form,appointment_date:e.target.value})} />
              <input className="border rounded-lg p-3" type="number" placeholder="Preventivo (€)" value={form.estimate||''} onChange={e=>setForm({...form,estimate:Number(e.target.value)})} />
              <input className="border rounded-lg p-3" placeholder="Tempi progettuali" value={form.project_timeline} onChange={e=>setForm({...form,project_timeline:e.target.value})} />
              <select className="border rounded-lg p-3" value={form.stage} onChange={e=>setForm({...form,stage:e.target.value})}>{STAGES.map(s=><option key={s}>{s}</option>)}</select>
              {(form.stage==='Preventivo'||form.stage==='Vendita')&&(<div><label className="text-xs text-gray-500">Probabilità</label><select className="border rounded-lg p-3 w-full mt-1" value={form.probability??''} onChange={e=>setForm({...form,probability:e.target.value?Number(e.target.value):null})} disabled={form.stage==='Vendita'}>{form.stage==='Vendita'?<option value={100}>100%</option>:PROB_OPTIONS.map(p=><option key={p} value={p}>{p}%</option>)}</select></div>)}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={addDeal} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium">Salva</button>
              <button onClick={()=>{setShowForm(false);setFormContactSearch('');setFormContactResults([]);setFormContactId(null);setFormTitle('');setFormEnvError(false)}} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {quickAddStage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-5 w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-1">Nuovo contatto</h2>
            <p className="text-sm text-blue-600 mb-4 font-medium">Fase: {quickAddStage}</p>
            <div className="flex flex-col gap-3">
              <input className="border rounded-lg p-3" placeholder="Nome contatto *" value={quickForm.contact_name} onChange={e=>setQuickForm({...quickForm,contact_name:e.target.value})} />
              <input className="border rounded-lg p-3" placeholder="Telefono" value={quickForm.phone} onChange={e=>setQuickForm({...quickForm,phone:e.target.value})} />
              <input className="border rounded-lg p-3" placeholder="Email" value={quickForm.email} onChange={e=>setQuickForm({...quickForm,email:e.target.value})} />
              <input className="border rounded-lg p-3" placeholder="Origine" value={quickForm.origin} onChange={e=>setQuickForm({...quickForm,origin:e.target.value})} />
              <label className="text-xs text-gray-500">Ambiente</label><EnvSelect value={quickForm.environment} onChange={v=>setQuickForm({...quickForm,environment:v})} />
              <label className="text-xs text-gray-500">Data ingresso</label><input className="border rounded-lg p-3" type="date" value={quickForm.entry_date} onChange={e=>setQuickForm({...quickForm,entry_date:e.target.value})} />
              <label className="text-xs text-gray-500">Data appuntamento</label><input className="border rounded-lg p-3" type="date" value={quickForm.appointment_date} onChange={e=>setQuickForm({...quickForm,appointment_date:e.target.value})} />
              <input className="border rounded-lg p-3" type="number" placeholder="Preventivo (€)" value={quickForm.estimate||''} onChange={e=>setQuickForm({...quickForm,estimate:Number(e.target.value)})} />
              <input className="border rounded-lg p-3" placeholder="Tempi progettuali" value={quickForm.project_timeline} onChange={e=>setQuickForm({...quickForm,project_timeline:e.target.value})} />
              {(quickAddStage==='Preventivo'||quickAddStage==='Vendita')&&(<div><label className="text-xs text-gray-500">Probabilità</label><select className="border rounded-lg p-3 w-full mt-1" value={quickForm.probability??''} onChange={e=>setQuickForm({...quickForm,probability:e.target.value?Number(e.target.value):null})} disabled={quickAddStage==='Vendita'}>{quickAddStage==='Vendita'?<option value={100}>100%</option>:PROB_OPTIONS.map(p=><option key={p} value={p}>{p}%</option>)}</select></div>)}
            </div>
            <div className="flex gap-2 mt-5"><button onClick={addQuickDeal} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium">Salva</button><button onClick={()=>setQuickAddStage(null)} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg">Annulla</button></div>
          </div>
        </div>
      )}

      {showIngressoForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-5 w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Nuovo Ingresso</h2>
            <div className="flex gap-2 mb-4">
              <button onClick={()=>setIsNewContact(false)} className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${!isNewContact?'bg-blue-600 text-white':'bg-gray-200 text-gray-700'}`}>Esistente</button>
              <button onClick={()=>{setIsNewContact(true);setExistingDealId(null)}} className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${isNewContact?'bg-blue-600 text-white':'bg-gray-200 text-gray-700'}`}>Nuovo</button>
            </div>
            {!isNewContact && (
              <div className="relative mb-4">
                <input className="border rounded-lg p-3 w-full" placeholder="Cerca per nome o telefono..." value={searchQuery} onChange={e=>{searchContacts(e.target.value);setExistingDealId(null)}} />
                {searchResults.length>0&&(<div className="absolute top-full left-0 right-0 bg-white border rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">{searchResults.map(d=>(<div key={d.id} onClick={()=>selectExistingContact(d)} className="p-3 hover:bg-gray-50 cursor-pointer border-b"><p className="font-semibold text-sm">{d.contact_name}</p><p className="text-xs text-gray-500">{d.phone}</p></div>))}</div>)}
                {searchQuery.length>=2&&searchResults.length===0&&<p className="text-sm text-gray-500 mt-2">Nessuno. <button onClick={()=>{setIsNewContact(true);setExistingDealId(null)}} className="text-blue-600 underline">Crea nuovo</button></p>}
                {existingContactId && <p className="text-xs text-green-600 mt-1 font-medium">✓ Contatto trovato: {ingressoForm.contact_name}</p>}
              </div>
            )}
            <div className="flex flex-col gap-3">
              <input className="border rounded-lg p-3" placeholder="Nome contatto *" value={ingressoForm.contact_name} onChange={e=>setIngressoForm({...ingressoForm,contact_name:e.target.value})} />
              <input className="border rounded-lg p-3" placeholder="Telefono" value={ingressoForm.phone||''} onChange={e=>setIngressoForm({...ingressoForm,phone:e.target.value})} />
              <input className="border rounded-lg p-3" placeholder="Email" value={ingressoForm.email||''} onChange={e=>setIngressoForm({...ingressoForm,email:e.target.value})} />
              <input className="border rounded-lg p-3" placeholder="Origine" value={ingressoForm.origin||''} onChange={e=>setIngressoForm({...ingressoForm,origin:e.target.value})} />
              <label className="text-xs text-gray-500">Ambiente</label><EnvSelect value={ingressoForm.environment} onChange={v=>setIngressoForm({...ingressoForm,environment:v})} />
              <label className="text-xs text-gray-500">Data ingresso</label><input className="border rounded-lg p-3" type="date" value={ingressoForm.entry_date} onChange={e=>setIngressoForm({...ingressoForm,entry_date:e.target.value})} />
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={addIngresso} className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium">Salva Ingresso</button>
              <button onClick={()=>{setShowIngressoForm(false);setSearchQuery('');setSearchResults([]);setIsNewContact(false);setExistingDealId(null);setExistingContactId(null)}} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {saleDatePopup && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end sm:items-center justify-center z-[70]">
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-6 w-full sm:max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-1">Contatto aggiudicato! 🏆</h3>
            <p className="text-gray-600 text-sm mb-4">Inserisci la data di vendita:</p>
            <input type="date" className="border rounded-lg p-3 w-full mb-4" value={saleDateValue} onChange={e=>setSaleDateValue(e.target.value)} />
            <div className="flex gap-2"><button onClick={confirmSaleDate} className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium">Conferma</button><button onClick={()=>{setSaleDatePopup(null);fetchDeals()}} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg">Annulla</button></div>
          </div>
        </div>
      )}

      {nonConvPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end sm:items-center justify-center z-[70]" onKeyDown={e=>{if(e.key==='Escape'){setNonConvPopup(null);setNonConvMotivo('');setNonConvAltro('');fetchDeals()}}}>
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-6 w-full sm:max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-1">Motivo non conversione</h3>
            <p className="text-gray-500 text-sm mb-4">Seleziona il motivo per cui il contatto non si è convertito:</p>
            <div className="flex flex-col gap-2 mb-4">
              {['Prezzo','Design','Finanziamento','Tempi','Altro'].map(m=>(
                <button key={m} onClick={()=>setNonConvMotivo(m)}
                  className={`text-left px-4 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${nonConvMotivo===m?'border-red-500 bg-red-50 text-red-700':'border-gray-200 hover:border-gray-300 text-gray-700'}`}>
                  {m}
                </button>
              ))}
            </div>
            {nonConvMotivo==='Altro' && (
              <input autoFocus className="border rounded-lg p-3 w-full mb-4 text-sm" placeholder="Specifica il motivo..." value={nonConvAltro} onChange={e=>setNonConvAltro(e.target.value)} />
            )}
            <div className="flex gap-2">
              <button onClick={confirmNonConv} disabled={!nonConvMotivo||(nonConvMotivo==='Altro'&&!nonConvAltro.trim())} className="flex-1 bg-red-500 text-white py-3 rounded-lg font-medium disabled:opacity-40">Conferma</button>
              <button onClick={()=>{setNonConvPopup(null);setNonConvMotivo('');setNonConvAltro('');fetchDeals()}} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}
      {confirmBulkDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end sm:items-center justify-center z-[60]">
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-6 w-full sm:max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-2">Conferma eliminazione</h3>
            <p className="text-gray-600 text-sm mb-5">Eliminare <strong>{selectedIds.size} contatti</strong>? Irreversibile.</p>
            <div className="flex gap-2"><button onClick={bulkDelete} className="flex-1 bg-red-500 text-white py-3 rounded-lg">Elimina</button><button onClick={()=>setConfirmBulkDelete(false)} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg">Annulla</button></div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end sm:items-center justify-center z-[60]">
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-6 w-full sm:max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-2">Conferma eliminazione</h3>
            <p className="text-gray-600 text-sm mb-5">Eliminare questo contatto? Irreversibile.</p>
            <div className="flex gap-2"><button onClick={()=>deleteDeal(confirmDelete)} className="flex-1 bg-red-500 text-white py-3 rounded-lg">Elimina</button><button onClick={()=>setConfirmDelete(null)} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg">Annulla</button></div>
          </div>
        </div>
      )}
      {confirmLogout && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end sm:items-center justify-center z-[60]">
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-6 w-full sm:max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-2">Conferma uscita</h3>
            <p className="text-gray-600 text-sm mb-5">Sei sicuro di voler uscire?</p>
            <div className="flex gap-2"><button onClick={()=>{supabase.auth.signOut();window.location.replace('/login')}} className="flex-1 bg-gray-800 text-white py-3 rounded-lg">Esci</button><button onClick={()=>setConfirmLogout(false)} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg">Annulla</button></div>
          </div>
        </div>
      )}

      {showNewTask && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50" onKeyDown={e=>{if(e.key==='Escape'){setShowNewTask(false);setNewTaskForm({title:'',due_date:'',deal_id:'',search:''});setNewTaskSearch('');setNewTaskSearchResults([])}}}>
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-5 w-full sm:max-w-md shadow-xl">
            <h2 className="text-lg font-bold mb-4">Nuova Task</h2>
            <div className="flex flex-col gap-3">
              <div><label className="text-xs text-gray-500">Titolo *</label><input className="border rounded-lg p-3 w-full mt-1 text-sm" placeholder="Es. Richiamare cliente..." value={newTaskForm.title} onChange={e=>setNewTaskForm({...newTaskForm,title:e.target.value})} /></div>
              <div><label className="text-xs text-gray-500">Data scadenza</label><input type="date" className="border rounded-lg p-3 w-full mt-1 text-sm" value={newTaskForm.due_date} onChange={e=>setNewTaskForm({...newTaskForm,due_date:e.target.value})} /></div>
              <div>
                <label className="text-xs text-gray-500">Associa a contatto</label>
                <input className="border rounded-lg p-3 w-full mt-1 text-sm" placeholder="Cerca o scrivi nome nuovo..." value={newTaskSearch} onChange={async e=>{
                  const v=e.target.value
                  setNewTaskSearch(v)
                  setNewTaskForm(f=>({...f,deal_id:''}))
                  if(v.length>=2){const{data}=await supabase.from('deals').select('*').or(`contact_name.ilike.%${v}%,phone.ilike.%${v}%`).limit(5);setNewTaskSearchResults(data||[])}else{setNewTaskSearchResults([])}
                }} />
                {newTaskSearchResults.length>0 && (
                  <div className="border rounded-lg mt-1 bg-white shadow-lg max-h-40 overflow-y-auto">
                    {newTaskSearchResults.map(d=>(
                      <button key={d.id} onClick={()=>{setNewTaskForm({...newTaskForm,deal_id:d.id});setNewTaskSearch(d.contact_name);setNewTaskSearchResults([])}} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b last:border-0">
                        <span className="font-medium">{d.contact_name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {newTaskForm.deal_id ? (
                  <p className="text-xs text-green-600 mt-1">✓ Associato a: {newTaskSearch}</p>
                ) : newTaskSearch.trim().length>=2 && newTaskSearchResults.length===0 ? (
                  <button onClick={async()=>{
                    const nome=newTaskSearch.trim()
                    const{data:newDeal}=await supabase.from('deals').insert({title:nome,contact_name:nome,stage:'Qualificato',is_lead:false,probability:null}).select().single()
                    if(newDeal){setNewTaskForm(f=>({...f,deal_id:newDeal.id}));fetchDeals()}
                  }} className="mt-1.5 w-full text-left px-3 py-2 text-sm bg-blue-50 border border-blue-200 rounded-lg text-blue-700 hover:bg-blue-100 transition-colors">
                    + Crea nuovo contatto "<strong>{newTaskSearch.trim()}</strong>"
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={async()=>{if(!newTaskForm.title.trim())return;await supabase.from('tasks').insert({title:newTaskForm.title.trim(),due_date:newTaskForm.due_date||null,deal_id:newTaskForm.deal_id||null,auto:false,done:false});setNewTaskForm({title:'',due_date:'',deal_id:'',search:''});setNewTaskSearch('');setNewTaskSearchResults([]);setShowNewTask(false);fetchDeals()}} className="flex-1 bg-orange-500 text-white py-3 rounded-lg font-medium">Salva</button>
              <button onClick={()=>{setShowNewTask(false);setNewTaskForm({title:'',due_date:'',deal_id:'',search:''});setNewTaskSearch('');setNewTaskSearchResults([])}} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {showLeadForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-5 w-full sm:max-w-md shadow-xl">
            <h2 className="text-lg font-bold mb-4">Nuovo Lead</h2>
            <div className="flex flex-col gap-3">
              <div><label className="text-xs text-gray-500">Nome *</label><input className="border rounded-lg p-3 w-full mt-1 text-sm" value={leadForm.contact_name} onChange={e=>setLeadForm({...leadForm,contact_name:e.target.value})} /></div>
              <div><label className="text-xs text-gray-500">Telefono</label><input className="border rounded-lg p-3 w-full mt-1 text-sm" value={leadForm.phone} onChange={e=>setLeadForm({...leadForm,phone:e.target.value})} /></div>
              <div><label className="text-xs text-gray-500">Email</label><input className="border rounded-lg p-3 w-full mt-1 text-sm" value={leadForm.email} onChange={e=>setLeadForm({...leadForm,email:e.target.value})} /></div>
              <div><label className="text-xs text-gray-500">Origine</label><input className="border rounded-lg p-3 w-full mt-1 text-sm" value={leadForm.origin} onChange={e=>setLeadForm({...leadForm,origin:e.target.value})} /></div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={async()=>{if(!leadForm.contact_name.trim())return;const{data:newLead}=await supabase.from('deals').insert({title:leadForm.contact_name,contact_name:leadForm.contact_name,phone:leadForm.phone||null,email:leadForm.email||null,origin:leadForm.origin||null,stage:'Qualificato',is_lead:true,lead_stage:'Nuovo',probability:null}).select().single();if(newLead)await createAutoTaskIfNeeded(newLead.id,'Contattare il contatto');setLeadForm({contact_name:'',phone:'',email:'',origin:''});setShowLeadForm(false);fetchDeals()}} className="flex-1 bg-purple-600 text-white py-3 rounded-lg font-medium">Salva</button>
              <button onClick={()=>{setShowLeadForm(false);setLeadForm({contact_name:'',phone:'',email:'',origin:''})}} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {convertingLead && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-5 w-full sm:max-w-md shadow-xl">
            <h2 className="text-lg font-bold mb-2">Converti in Contatto</h2>
            <p className="text-gray-600 text-sm mb-4"><strong>{convertingLead.contact_name}</strong> → Pipeline come <span className="text-blue-600 font-medium">Qualificato</span>.</p>
            <div className="flex gap-2">
              <button onClick={async()=>{await supabase.from('deals').update({is_lead:false,lead_stage:null,stage:'Qualificato',probability:25}).eq('id',convertingLead.id);await logStageChange(convertingLead.id,convertingLead.lead_stage||'Lead','Qualificato');setConvertingLead(null);fetchDeals()}} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium">Converti</button>
              <button onClick={()=>setConvertingLead(null)} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  )
}
