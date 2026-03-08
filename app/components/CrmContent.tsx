'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'

const STAGES = ['Nuovo Lead', 'Qualificato', 'Appuntamento fissato', 'Ingresso', 'Preventivo', 'Vendita', 'Non convertito']
const ENVIRONMENTS = ['Cucina', 'Soggiorno', 'Camera da letto', 'Cameretta', 'Tavoli e sedie', 'Altro']

interface Deal {
  id: string
  title: string
  contact_name: string
  phone: string
  email: string
  origin: string
  environment: string
  entry_date: string
  appointment_date: string
  estimate: number
  project_timeline: string
  stage: string
  created_at: string
}

const emptyDeal = { title: '', contact_name: '', phone: '', email: '', origin: '', environment: '', entry_date: '', appointment_date: '', estimate: 0, project_timeline: '', stage: 'Nuovo Lead' }

type View = 'kanban' | 'list' | 'analytics'
type QuickRange = 'today' | 'week' | 'month' | 'lastmonth' | 'alltime' | 'custom'

function formatDate(dateStr: string) {
  if (!dateStr) return '-'
  const parts = dateStr.split('-')
  if (parts.length === 3) return `${parseInt(parts[2])}/${parseInt(parts[1])}/${parts[0]}`
  return '-'
}

function toYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function getRangeForQuick(type: QuickRange): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const mo = now.getMonth()
  if (type === 'today') { const s = toYMD(now); return { from: s, to: s } }
  if (type === 'week') {
    const day = now.getDay() === 0 ? 7 : now.getDay()
    const mon = new Date(now); mon.setDate(now.getDate() - day + 1)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { from: toYMD(mon), to: toYMD(sun) }
  }
  if (type === 'month') { return { from: toYMD(new Date(y, mo, 1)), to: toYMD(new Date(y, mo + 1, 0)) } }
  if (type === 'lastmonth') { return { from: toYMD(new Date(y, mo - 1, 1)), to: toYMD(new Date(y, mo, 0)) } }
  return { from: '', to: '' }
}

function EnvSelect({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  const selected = value ? value.split(',').map(s => s.trim()).filter(Boolean) : []
  function toggle(env: string) {
    const next = selected.includes(env) ? selected.filter(e => e !== env) : [...selected, env]
    onChange(next.join(', '))
  }
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {ENVIRONMENTS.map(env => (
        <button key={env} type="button" onClick={() => toggle(env)}
          className={`px-3 py-1 rounded-full text-xs border transition-colors ${selected.includes(env) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
          {env}
        </button>
      ))}
    </div>
  )
}

export default function CrmContent() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [checked, setChecked] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showIngressoForm, setShowIngressoForm] = useState(false)
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editDeal, setEditDeal] = useState<Deal | null>(null)
  const [form, setForm] = useState(emptyDeal)
  const [quickAddStage, setQuickAddStage] = useState<string | null>(null)
  const [quickForm, setQuickForm] = useState(emptyDeal)
  const [ingressoForm, setIngressoForm] = useState({ ...emptyDeal, stage: 'Ingresso', entry_date: toYMD(new Date()) })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Deal[]>([])
  const [isNewContact, setIsNewContact] = useState(false)
  const [view, setView] = useState<View>('kanban')
  const [groupBy, setGroupBy] = useState('stage')
  const [activeQuick, setActiveQuick] = useState<QuickRange>('week')
  const [saveError, setSaveError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkStage, setBulkStage] = useState('')
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  const weekRange = getRangeForQuick('week')
  const [dateFrom, setDateFrom] = useState(weekRange.from)
  const [dateTo, setDateTo] = useState(weekRange.to)

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { window.location.replace('/login'); return }
      setChecked(true)
      fetchDeals()
    }
    init()
  }, [])

  async function fetchDeals() {
    const { data } = await supabase.from('deals').select('*').order('created_at', { ascending: false })
    setDeals(data || [])
  }

  async function addDeal() {
    if (!form.contact_name) return
    const { error } = await supabase.rpc('insert_deal', {
      p_title: form.contact_name,
      p_contact_name: form.contact_name,
      p_stage: form.stage,
      p_phone: form.phone || null,
      p_email: form.email || null,
      p_origin: form.origin || null,
      p_environment: form.environment || null,
      p_entry_date: form.entry_date || null,
      p_appointment_date: form.appointment_date || null,
      p_estimate: form.estimate || null,
      p_project_timeline: form.project_timeline || null,
    })
    if (!error) {
      setForm(emptyDeal)
      setShowForm(false)
      fetchDeals()
    }
  }

  async function addQuickDeal() {
    if (!quickForm.contact_name || !quickAddStage) return
    const { error } = await supabase.rpc('insert_deal', {
      p_title: quickForm.contact_name,
      p_contact_name: quickForm.contact_name,
      p_stage: quickAddStage,
      p_phone: quickForm.phone || null,
      p_email: quickForm.email || null,
      p_origin: quickForm.origin || null,
      p_environment: quickForm.environment || null,
      p_entry_date: quickForm.entry_date || null,
      p_appointment_date: quickForm.appointment_date || null,
      p_estimate: quickForm.estimate || null,
      p_project_timeline: quickForm.project_timeline || null,
    })
    if (!error) {
      setQuickForm(emptyDeal)
      setQuickAddStage(null)
      fetchDeals()
    }
  }

  async function addIngresso() {
    if (!ingressoForm.contact_name) return
    const { error } = await supabase.rpc('insert_deal', {
      p_title: ingressoForm.contact_name,
      p_contact_name: ingressoForm.contact_name,
      p_stage: 'Ingresso',
      p_phone: ingressoForm.phone || null,
      p_email: ingressoForm.email || null,
      p_origin: ingressoForm.origin || null,
      p_environment: ingressoForm.environment || null,
      p_entry_date: ingressoForm.entry_date || null,
      p_appointment_date: ingressoForm.appointment_date || null,
      p_estimate: ingressoForm.estimate || null,
      p_project_timeline: ingressoForm.project_timeline || null,
    })
    if (!error) {
      setIngressoForm({ ...emptyDeal, stage: 'Ingresso', entry_date: toYMD(new Date()) })
      setShowIngressoForm(false)
      setIsNewContact(false)
      setSearchQuery('')
      setSearchResults([])
      fetchDeals()
    }
  }

  async function saveDeal(deal: Deal) {
    setSaveError('')
    const { error } = await supabase.from('deals').update({
      title: deal.contact_name,
      contact_name: deal.contact_name,
      phone: deal.phone,
      email: deal.email,
      origin: deal.origin,
      environment: deal.environment,
      entry_date: deal.entry_date || null,
      appointment_date: deal.appointment_date || null,
      estimate: deal.estimate || 0,
      project_timeline: deal.project_timeline,
      stage: deal.stage,
    }).eq('id', deal.id)
    if (error) { setSaveError('Errore: ' + error.message); return }
    setSelectedDeal(null)
    setEditMode(false)
    setEditDeal(null)
    fetchDeals()
  }

  async function searchContacts(q: string) {
    setSearchQuery(q)
    if (q.length < 2) { setSearchResults([]); return }
    const { data } = await supabase.from('deals').select('*').or(`contact_name.ilike.%${q}%,phone.ilike.%${q}%`)
    const unique = data ? data.filter((d, i, arr) => arr.findIndex(x => x.contact_name === d.contact_name && x.phone === d.phone) === i) : []
    setSearchResults(unique)
  }

  function selectExistingContact(deal: Deal) {
    setIngressoForm({
      ...emptyDeal,
      stage: 'Ingresso',
      entry_date: toYMD(new Date()),
      contact_name: deal.contact_name || '',
      phone: deal.phone || '',
      email: deal.email || '',
      origin: deal.origin || ''
    })
    setSearchQuery(deal.contact_name)
    setSearchResults([])
    setIsNewContact(false)
  }

  async function updateStage(id: string, stage: string) {
    await supabase.from('deals').update({ stage }).eq('id', id)
  }

  async function deleteDeal(id: string) {
    await supabase.from('deals').delete().eq('id', id)
    setConfirmDelete(null)
    setSelectedDeal(null)
    setEditMode(false)
    fetchDeals()
  }

  async function onDragEnd(result: DropResult) {
    if (!result.destination) return
    const dealId = result.draggableId
    const newStage = result.destination.droppableId
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: newStage } : d))
    await updateStage(dealId, newStage)
  }

  function applyQuick(type: QuickRange) {
    setActiveQuick(type)
    if (type !== 'alltime') { const range = getRangeForQuick(type); setDateFrom(range.from); setDateTo(range.to) }
  }

  function getFilteredDeals() {
    if (activeQuick === 'alltime') return deals
    return deals.filter(d => {
      const dateStr = d.entry_date || d.created_at.split('T')[0]
      return dateStr >= dateFrom && dateStr <= dateTo
    })
  }

  function getGroupedDeals() {
    const grouped: { [key: string]: Deal[] } = {}
    deals.forEach(deal => {
      const key = (deal as any)[groupBy] || 'Non specificato'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(deal)
    })
    return grouped
  }

  function btnClass(type: QuickRange) {
    return `px-3 py-1 rounded-lg text-sm font-medium transition-colors ${activeQuick === type ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`
  }

  function openDeal(deal: Deal) {
    setSelectedDeal(deal)
    setEditDeal({ ...deal })
    setEditMode(false)
    setSaveError('')
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll(dealsToSelect: Deal[]) {
    if (dealsToSelect.every(d => selectedIds.has(d.id))) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(dealsToSelect.map(d => d.id)))
    }
  }

  async function bulkDelete() {
    await supabase.from('deals').delete().in('id', Array.from(selectedIds))
    setSelectedIds(new Set())
    setConfirmBulkDelete(false)
    fetchDeals()
  }

  async function bulkChangeStage() {
    if (!bulkStage) return
    await supabase.from('deals').update({ stage: bulkStage }).in('id', Array.from(selectedIds))
    setSelectedIds(new Set())
    setBulkStage('')
    fetchDeals()
  }

  if (!checked) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">Verifica accesso...</p></div>

  const filteredDeals = getFilteredDeals()

  const BulkActionBar = ({ dealsInView }: { dealsInView: Deal[] }) => (
    selectedIds.size > 0 ? (
      <div className="flex items-center gap-2 mb-4 flex-wrap bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
        <span className="text-sm text-blue-700 font-semibold">{selectedIds.size} selezionati</span>
        <select className="border rounded-lg p-2 text-sm ml-2" value={bulkStage} onChange={e => setBulkStage(e.target.value)}>
          <option value="">Cambia fase...</option>
          {STAGES.map(s => <option key={s}>{s}</option>)}
        </select>
        {bulkStage && <button onClick={bulkChangeStage} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700">Applica</button>}
        <button onClick={() => setConfirmBulkDelete(true)} className="bg-red-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-red-600">Elimina selezionati</button>
        <button onClick={() => { setSelectedIds(new Set()); setBulkStage('') }} className="bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-300 ml-auto">Deseleziona tutto</button>
      </div>
    ) : null
  )

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <div className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">CRM</h1>
        <div className="flex gap-2 items-center">
          <div className="flex border rounded-lg overflow-hidden mr-2">
            <button onClick={() => setView('kanban')} className={`px-3 py-2 text-sm ${view === 'kanban' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>Kanban</button>
            <button onClick={() => setView('list')} className={`px-3 py-2 text-sm ${view === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>Lista</button>
            <button onClick={() => setView('analytics')} className={`px-3 py-2 text-sm ${view === 'analytics' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>Analisi</button>
          </div>
          <button onClick={() => setShowIngressoForm(true)} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">+ Nuovo Ingresso</button>
          <button onClick={() => setShowForm(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">+ Nuovo Affare</button>
          <button onClick={() => setConfirmLogout(true)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Esci</button>
        </div>
      </div>

      {/* KANBAN */}
      {view === 'kanban' && (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="overflow-x-auto p-6">
            <div className="flex gap-4" style={{ minWidth: 'max-content' }}>
              {STAGES.map(stage => {
                const stageDeals = deals.filter(d => d.stage === stage)
                const total = stageDeals.reduce((sum, d) => sum + (d.estimate || 0), 0)
                return (
                  <Droppable droppableId={stage} key={stage}>
                    {(provided, snapshot) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className={`rounded-xl p-3 w-64 flex flex-col ${snapshot.isDraggingOver ? 'bg-blue-100' : 'bg-gray-200'}`}>
                        <h2 className="font-semibold text-gray-700">{stage}</h2>
                        <p className="text-xs text-gray-500">{stageDeals.length} affari</p>
                        {total > 0 && <p className="text-xs text-green-700 font-semibold mb-2">€ {total.toLocaleString()}</p>}
                        <div className="flex flex-col gap-2 mt-2 flex-1">
                          {stageDeals.map((deal, index) => (
                            <Draggable key={deal.id} draggableId={deal.id} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  onClick={() => openDeal(deal)}
                                  className={`bg-white rounded-lg p-3 cursor-pointer ${snapshot.isDragging ? 'shadow-xl rotate-1' : 'shadow hover:shadow-md'}`}
                                >
                                  <p className="font-semibold text-sm text-gray-800">{deal.contact_name || deal.title}</p>
                                  {deal.estimate > 0 && <p className="text-xs text-green-600 mt-1">€ {deal.estimate.toLocaleString()}</p>}
                                  {deal.environment && <p className="text-xs text-blue-500">{deal.environment}</p>}
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                        <button
                          onClick={() => { setQuickAddStage(stage); setQuickForm({ ...emptyDeal, stage }) }}
                          className="mt-3 w-full flex items-center justify-center gap-1 text-gray-400 hover:text-blue-600 hover:bg-white rounded-lg py-1 text-sm transition-colors"
                        >
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
      {view === 'list' && (
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <label className="text-sm font-semibold text-gray-700">Raggruppa per:</label>
            <select className="border rounded-lg p-2 text-sm" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
              <option value="stage">Fase</option>
              <option value="origin">Origine</option>
              <option value="environment">Ambiente</option>
              <option value="project_timeline">Tempi progettuali</option>
            </select>
          </div>
          <BulkActionBar dealsInView={deals} />
          {Object.entries(getGroupedDeals()).map(([group, groupDeals]) => (
            <div key={group} className="mb-6">
              <h2 className="font-bold text-gray-700 mb-2">{group} <span className="text-gray-400 font-normal text-sm">({groupDeals.length})</span></h2>
              <div className="bg-white rounded-xl shadow overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="p-3 w-8">
                        <input type="checkbox"
                          onChange={() => toggleSelectAll(groupDeals)}
                          checked={groupDeals.length > 0 && groupDeals.every(d => selectedIds.has(d.id))}
                        />
                      </th>
                      <th className="text-left p-3">Contatto</th>
                      <th className="text-left p-3">Ambiente</th>
                      <th className="text-left p-3">Fase</th>
                      <th className="text-left p-3">Preventivo</th>
                      <th className="text-left p-3">Appuntamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupDeals.map(deal => (
                      <tr key={deal.id} className={`border-t hover:bg-gray-50 ${selectedIds.has(deal.id) ? 'bg-blue-50' : ''}`}>
                        <td className="p-3" onClick={e => { e.stopPropagation(); toggleSelect(deal.id) }}>
                          <input type="checkbox" checked={selectedIds.has(deal.id)} onChange={() => toggleSelect(deal.id)} />
                        </td>
                        <td className="p-3 font-medium cursor-pointer" onClick={() => openDeal(deal)}>{deal.contact_name}</td>
                        <td className="p-3 text-gray-600 cursor-pointer" onClick={() => openDeal(deal)}>{deal.environment}</td>
                        <td className="p-3 cursor-pointer" onClick={() => openDeal(deal)}><span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs">{deal.stage}</span></td>
                        <td className="p-3 text-green-600 cursor-pointer" onClick={() => openDeal(deal)}>{deal.estimate > 0 ? `€ ${deal.estimate.toLocaleString()}` : '-'}</td>
                        <td className="p-3 text-gray-600 cursor-pointer" onClick={() => openDeal(deal)}>{formatDate(deal.appointment_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ANALYTICS */}
      {view === 'analytics' && (
        <div className="p-6">
          <div className="bg-white rounded-xl shadow p-4 mb-6">
            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={() => applyQuick('today')} className={btnClass('today')}>Oggi</button>
              <button onClick={() => applyQuick('week')} className={btnClass('week')}>Questa settimana</button>
              <button onClick={() => applyQuick('month')} className={btnClass('month')}>Questo mese</button>
              <button onClick={() => applyQuick('lastmonth')} className={btnClass('lastmonth')}>Scorso mese</button>
              <button onClick={() => applyQuick('alltime')} className={btnClass('alltime')}>Dall'inizio</button>
              {activeQuick !== 'alltime' && (
                <div className="flex items-center gap-2 ml-2">
                  <input type="date" className="border rounded-lg p-2 text-sm" value={dateFrom} onChange={e => { setActiveQuick('custom'); setDateFrom(e.target.value) }} />
                  <span className="text-gray-500">→</span>
                  <input type="date" className="border rounded-lg p-2 text-sm" value={dateTo} onChange={e => { setActiveQuick('custom'); setDateTo(e.target.value) }} />
                </div>
              )}
              {activeQuick === 'alltime' && <span className="text-sm text-gray-400 ml-2 italic">Tutti i dati</span>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow p-4">
              <p className="text-gray-500 text-sm">Ingressi periodo</p>
              <p className="text-3xl font-bold text-blue-600">{filteredDeals.length}</p>
            </div>
            <div className="bg-white rounded-xl shadow p-4">
              <p className="text-gray-500 text-sm">Valore totale</p>
              <p className="text-3xl font-bold text-green-600">€ {filteredDeals.reduce((s, d) => s + (d.estimate || 0), 0).toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-xl shadow p-4">
              <p className="text-gray-500 text-sm">Media per affare</p>
              <p className="text-3xl font-bold text-purple-600">€ {filteredDeals.length > 0 ? Math.round(filteredDeals.reduce((s, d) => s + (d.estimate || 0), 0) / filteredDeals.length).toLocaleString() : 0}</p>
            </div>
          </div>
          <BulkActionBar dealsInView={filteredDeals} />
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="p-3 w-8">
                    <input type="checkbox"
                      onChange={() => toggleSelectAll(filteredDeals)}
                      checked={filteredDeals.length > 0 && filteredDeals.every(d => selectedIds.has(d.id))}
                    />
                  </th>
                  <th className="text-left p-3">Contatto</th>
                  <th className="text-left p-3">Origine</th>
                  <th className="text-left p-3">Ambiente</th>
                  <th className="text-left p-3">Preventivo</th>
                  <th className="text-left p-3">Data ingresso</th>
                </tr>
              </thead>
              <tbody>
                {filteredDeals.map(deal => (
                  <tr key={deal.id} className={`border-t hover:bg-gray-50 ${selectedIds.has(deal.id) ? 'bg-blue-50' : ''}`}>
                    <td className="p-3" onClick={e => { e.stopPropagation(); toggleSelect(deal.id) }}>
                      <input type="checkbox" checked={selectedIds.has(deal.id)} onChange={() => toggleSelect(deal.id)} />
                    </td>
                    <td className="p-3 font-medium cursor-pointer" onClick={() => openDeal(deal)}>{deal.contact_name}</td>
                    <td className="p-3 cursor-pointer" onClick={() => openDeal(deal)}>{deal.origin}</td>
                    <td className="p-3 cursor-pointer" onClick={() => openDeal(deal)}>{deal.environment}</td>
                    <td className="p-3 text-green-600 cursor-pointer" onClick={() => openDeal(deal)}>{deal.estimate > 0 ? `€ ${deal.estimate.toLocaleString()}` : '-'}</td>
                    <td className="p-3 cursor-pointer" onClick={() => openDeal(deal)}>{formatDate(deal.entry_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredDeals.length === 0 && <p className="text-center text-gray-400 py-8">Nessun ingresso nel periodo selezionato</p>}
          </div>
        </div>
      )}

      {/* Modal Nuovo Affare */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-screen overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Nuovo Affare</h2>
            <div className="flex flex-col gap-3">
              <input className="border rounded-lg p-2" placeholder="Nome contatto *" value={form.contact_name} onChange={e => setForm({...form, contact_name: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Telefono" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Origine (es. Meta Ads)" value={form.origin} onChange={e => setForm({...form, origin: e.target.value})} />
              <label className="text-xs text-gray-500">Ambiente</label>
              <EnvSelect value={form.environment} onChange={v => setForm({...form, environment: v})} />
              <label className="text-xs text-gray-500">Data ingresso</label>
              <input className="border rounded-lg p-2" type="date" value={form.entry_date} onChange={e => setForm({...form, entry_date: e.target.value})} />
              <label className="text-xs text-gray-500">Data appuntamento</label>
              <input className="border rounded-lg p-2" type="date" value={form.appointment_date} onChange={e => setForm({...form, appointment_date: e.target.value})} />
              <input className="border rounded-lg p-2" type="number" placeholder="Preventivo (€)" value={form.estimate || ''} onChange={e => setForm({...form, estimate: Number(e.target.value)})} />
              <input className="border rounded-lg p-2" placeholder="Tempi progettuali" value={form.project_timeline} onChange={e => setForm({...form, project_timeline: e.target.value})} />
              <select className="border rounded-lg p-2" value={form.stage} onChange={e => setForm({...form, stage: e.target.value})}>
                {STAGES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={addDeal} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Salva</button>
              <button onClick={() => setShowForm(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Quick Add da colonna */}
      {quickAddStage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-screen overflow-y-auto">
            <h2 className="text-xl font-bold mb-1">Nuovo contatto</h2>
            <p className="text-sm text-blue-600 mb-4 font-medium">Fase: {quickAddStage}</p>
            <div className="flex flex-col gap-3">
              <input className="border rounded-lg p-2" placeholder="Nome contatto *" value={quickForm.contact_name} onChange={e => setQuickForm({...quickForm, contact_name: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Telefono" value={quickForm.phone} onChange={e => setQuickForm({...quickForm, phone: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Email" value={quickForm.email} onChange={e => setQuickForm({...quickForm, email: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Origine (es. Meta Ads)" value={quickForm.origin} onChange={e => setQuickForm({...quickForm, origin: e.target.value})} />
              <label className="text-xs text-gray-500">Ambiente</label>
              <EnvSelect value={quickForm.environment} onChange={v => setQuickForm({...quickForm, environment: v})} />
              <label className="text-xs text-gray-500">Data ingresso</label>
              <input className="border rounded-lg p-2" type="date" value={quickForm.entry_date} onChange={e => setQuickForm({...quickForm, entry_date: e.target.value})} />
              <label className="text-xs text-gray-500">Data appuntamento</label>
              <input className="border rounded-lg p-2" type="date" value={quickForm.appointment_date} onChange={e => setQuickForm({...quickForm, appointment_date: e.target.value})} />
              <input className="border rounded-lg p-2" type="number" placeholder="Preventivo (€)" value={quickForm.estimate || ''} onChange={e => setQuickForm({...quickForm, estimate: Number(e.target.value)})} />
              <input className="border rounded-lg p-2" placeholder="Tempi progettuali" value={quickForm.project_timeline} onChange={e => setQuickForm({...quickForm, project_timeline: e.target.value})} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={addQuickDeal} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Salva</button>
              <button onClick={() => setQuickAddStage(null)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
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
              <button onClick={() => setIsNewContact(false)} className={`px-4 py-2 rounded-lg text-sm ${!isNewContact ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>Contatto esistente</button>
              <button onClick={() => setIsNewContact(true)} className={`px-4 py-2 rounded-lg text-sm ${isNewContact ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>Nuovo contatto</button>
            </div>
            {!isNewContact && (
              <div className="relative mb-4">
                <input className="border rounded-lg p-2 w-full" placeholder="Cerca per nome o telefono..." value={searchQuery} onChange={e => searchContacts(e.target.value)} />
                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {searchResults.map(d => (
                      <div key={d.id} onClick={() => selectExistingContact(d)} className="p-3 hover:bg-gray-50 cursor-pointer border-b">
                        <p className="font-semibold text-sm">{d.contact_name}</p>
                        <p className="text-xs text-gray-500">{d.phone} · {d.email}</p>
                      </div>
                    ))}
                  </div>
                )}
                {searchQuery.length >= 2 && searchResults.length === 0 && (
                  <p className="text-sm text-gray-500 mt-2">Nessun contatto trovato. <button onClick={() => setIsNewContact(true)} className="text-blue-600 underline">Crea nuovo</button></p>
                )}
              </div>
            )}
            <div className="flex flex-col gap-3">
              <input className="border rounded-lg p-2" placeholder="Nome contatto *" value={ingressoForm.contact_name} onChange={e => setIngressoForm({...ingressoForm, contact_name: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Telefono" value={ingressoForm.phone || ''} onChange={e => setIngressoForm({...ingressoForm, phone: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Email" value={ingressoForm.email || ''} onChange={e => setIngressoForm({...ingressoForm, email: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Origine (es. Meta Ads)" value={ingressoForm.origin || ''} onChange={e => setIngressoForm({...ingressoForm, origin: e.target.value})} />
              <label className="text-xs text-gray-500">Ambiente</label>
              <EnvSelect value={ingressoForm.environment} onChange={v => setIngressoForm({...ingressoForm, environment: v})} />
              <label className="text-xs text-gray-500">Data ingresso</label>
              <input className="border rounded-lg p-2" type="date" value={ingressoForm.entry_date} onChange={e => setIngressoForm({...ingressoForm, entry_date: e.target.value})} />
              <label className="text-xs text-gray-500">Data appuntamento</label>
              <input className="border rounded-lg p-2" type="date" value={ingressoForm.appointment_date} onChange={e => setIngressoForm({...ingressoForm, appointment_date: e.target.value})} />
              <input className="border rounded-lg p-2" type="number" placeholder="Preventivo (€)" value={ingressoForm.estimate || ''} onChange={e => setIngressoForm({...ingressoForm, estimate: Number(e.target.value)})} />
              <input className="border rounded-lg p-2" placeholder="Tempi progettuali" value={ingressoForm.project_timeline || ''} onChange={e => setIngressoForm({...ingressoForm, project_timeline: e.target.value})} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={addIngresso} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">Salva Ingresso</button>
              <button onClick={() => { setShowIngressoForm(false); setSearchQuery(''); setSearchResults([]); setIsNewContact(false) }} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Dettaglio / Preview + Modifica */}
      {selectedDeal && editDeal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-screen overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold">{selectedDeal.contact_name || selectedDeal.title}</h2>
              <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs">{selectedDeal.stage}</span>
            </div>
            {!editMode ? (
              <div className="flex flex-col gap-2 text-sm">
                {selectedDeal.phone && <p><span className="font-semibold text-gray-500">Telefono:</span> {selectedDeal.phone}</p>}
                {selectedDeal.email && <p><span className="font-semibold text-gray-500">Email:</span> {selectedDeal.email}</p>}
                {selectedDeal.origin && <p><span className="font-semibold text-gray-500">Origine:</span> {selectedDeal.origin}</p>}
                {selectedDeal.environment && <p><span className="font-semibold text-gray-500">Ambiente:</span> {selectedDeal.environment}</p>}
                {selectedDeal.entry_date && <p><span className="font-semibold text-gray-500">Data ingresso:</span> {formatDate(selectedDeal.entry_date)}</p>}
                {selectedDeal.appointment_date && <p><span className="font-semibold text-gray-500">Appuntamento:</span> {formatDate(selectedDeal.appointment_date)}</p>}
                {selectedDeal.estimate > 0 && <p><span className="font-semibold text-gray-500">Preventivo:</span> € {selectedDeal.estimate.toLocaleString()}</p>}
                {selectedDeal.project_timeline && <p><span className="font-semibold text-gray-500">Tempi progettuali:</span> {selectedDeal.project_timeline}</p>}
              </div>
            ) : (
              <div className="flex flex-col gap-3 text-sm">
                <div><label className="text-xs text-gray-500">Contatto</label>
                  <input className="border rounded-lg p-2 w-full mt-1" value={editDeal.contact_name || ''} onChange={e => setEditDeal({...editDeal, contact_name: e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Telefono</label>
                  <input className="border rounded-lg p-2 w-full mt-1" value={editDeal.phone || ''} onChange={e => setEditDeal({...editDeal, phone: e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Email</label>
                  <input className="border rounded-lg p-2 w-full mt-1" value={editDeal.email || ''} onChange={e => setEditDeal({...editDeal, email: e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Origine</label>
                  <input className="border rounded-lg p-2 w-full mt-1" value={editDeal.origin || ''} onChange={e => setEditDeal({...editDeal, origin: e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Ambiente</label>
                  <EnvSelect value={editDeal.environment || ''} onChange={v => setEditDeal({...editDeal, environment: v})} /></div>
                <div><label className="text-xs text-gray-500">Data ingresso</label>
                  <input type="date" className="border rounded-lg p-2 w-full mt-1" value={editDeal.entry_date || ''} onChange={e => setEditDeal({...editDeal, entry_date: e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Data appuntamento</label>
                  <input type="date" className="border rounded-lg p-2 w-full mt-1" value={editDeal.appointment_date || ''} onChange={e => setEditDeal({...editDeal, appointment_date: e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Preventivo (€)</label>
                  <input type="number" className="border rounded-lg p-2 w-full mt-1" value={editDeal.estimate || ''} onChange={e => setEditDeal({...editDeal, estimate: Number(e.target.value)})} /></div>
                <div><label className="text-xs text-gray-500">Tempi progettuali</label>
                  <input className="border rounded-lg p-2 w-full mt-1" value={editDeal.project_timeline || ''} onChange={e => setEditDeal({...editDeal, project_timeline: e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">Fase</label>
                  <select className="border rounded-lg p-2 w-full mt-1" value={editDeal.stage} onChange={e => setEditDeal({...editDeal, stage: e.target.value})}>
                    {STAGES.map(s => <option key={s}>{s}</option>)}
                  </select></div>
                {saveError && <p className="text-red-500 text-sm">{saveError}</p>}
              </div>
            )}
            <div className="flex gap-2 mt-5">
              {!editMode ? (
                <>
                  <button onClick={() => setEditMode(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Modifica</button>
                  <button onClick={() => { setSelectedDeal(null); setEditDeal(null) }} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Chiudi</button>
                  <button onClick={() => setConfirmDelete(selectedDeal.id)} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 ml-auto">Elimina</button>
                </>
              ) : (
                <>
                  <button onClick={() => saveDeal(editDeal)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Salva modifiche</button>
                  <button onClick={() => setEditMode(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
                  <button onClick={() => setConfirmDelete(selectedDeal.id)} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 ml-auto">Elimina</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Conferma Bulk Delete */}
      {confirmBulkDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-2">Conferma eliminazione</h3>
            <p className="text-gray-600 text-sm mb-5">Sei sicuro di voler eliminare <strong>{selectedIds.size} contatti</strong>? L'operazione è irreversibile.</p>
            <div className="flex gap-2">
              <button onClick={bulkDelete} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600">Sì, elimina</button>
              <button onClick={() => setConfirmBulkDelete(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {/* Conferma Elimina */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-2">Conferma eliminazione</h3>
            <p className="text-gray-600 text-sm mb-5">Sei sicuro di voler eliminare questo contatto? L'operazione è irreversibile.</p>
            <div className="flex gap-2">
              <button onClick={() => deleteDeal(confirmDelete)} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600">Sì, elimina</button>
              <button onClick={() => setConfirmDelete(null)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {/* Conferma Logout */}
      {confirmLogout && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-2">Conferma uscita</h3>
            <p className="text-gray-600 text-sm mb-5">Sei sicuro di voler uscire?</p>
            <div className="flex gap-2">
              <button onClick={() => { supabase.auth.signOut(); window.location.replace('/login') }} className="bg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gray-900">Sì, esci</button>
              <button onClick={() => setConfirmLogout(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
