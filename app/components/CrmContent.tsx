'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'

const STAGES = ['Nuovo Lead', 'Qualificato', 'Appuntamento fissato', 'Ingresso', 'Preventivo', 'Vendita', 'Non convertito']

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

// Crea una stringa YYYY-MM-DD senza problemi di fuso orario
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

  if (type === 'today') {
    const s = toYMD(now)
    return { from: s, to: s }
  }
  if (type === 'week') {
    // Lun-Dom della settimana corrente
    const day = now.getDay() === 0 ? 7 : now.getDay()
    const mon = new Date(now); mon.setDate(now.getDate() - day + 1)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { from: toYMD(mon), to: toYMD(sun) }
  }
  if (type === 'month') {
    const start = new Date(y, mo, 1)
    const end = new Date(y, mo + 1, 0)
    return { from: toYMD(start), to: toYMD(end) }
  }
  if (type === 'lastmonth') {
    const start = new Date(y, mo - 1, 1)
    const end = new Date(y, mo, 0)
    return { from: toYMD(start), to: toYMD(end) }
  }
  return { from: '', to: '' }
}

export default function CrmContent() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [checked, setChecked] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showIngressoForm, setShowIngressoForm] = useState(false)
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
  const [form, setForm] = useState(emptyDeal)
  const [ingressoForm, setIngressoForm] = useState({ ...emptyDeal, stage: 'Ingresso' })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Deal[]>([])
  const [isNewContact, setIsNewContact] = useState(false)
  const [view, setView] = useState<View>('kanban')
  const [groupBy, setGroupBy] = useState('stage')
  const [activeQuick, setActiveQuick] = useState<QuickRange>('week')

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
    if (!form.title) return
    await supabase.from('deals').insert([form])
    setForm(emptyDeal)
    setShowForm(false)
    fetchDeals()
  }

  async function addIngresso() {
    if (!ingressoForm.contact_name) return
    const deal = { ...ingressoForm, stage: 'Ingresso', title: `${ingressoForm.environment || 'Affare'} - ${ingressoForm.contact_name}` }
    await supabase.from('deals').insert([deal])
    setIngressoForm({ ...emptyDeal, stage: 'Ingresso' })
    setShowIngressoForm(false)
    setIsNewContact(false)
    setSearchQuery('')
    setSearchResults([])
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
    setIngressoForm({ ...emptyDeal, stage: 'Ingresso', contact_name: deal.contact_name, phone: deal.phone, email: deal.email, origin: deal.origin })
    setSearchQuery(deal.contact_name)
    setSearchResults([])
    setIsNewContact(false)
  }

  async function updateStage(id: string, stage: string) {
    await supabase.from('deals').update({ stage }).eq('id', id)
  }

  async function deleteDeal(id: string) {
    await supabase.from('deals').delete().eq('id', id)
    setSelectedDeal(null)
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
    if (type !== 'alltime') {
      const range = getRangeForQuick(type)
      setDateFrom(range.from)
      setDateTo(range.to)
    }
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

  if (!checked) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-500">Verifica accesso...</p>
    </div>
  )

  const filteredDeals = getFilteredDeals()

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
          <button onClick={() => { supabase.auth.signOut(); window.location.replace('/login') }} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Esci</button>
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
                      <div ref={provided.innerRef} {...provided.droppableProps} className={`rounded-xl p-3 w-64 ${snapshot.isDraggingOver ? 'bg-blue-100' : 'bg-gray-200'}`}>
                        <h2 className="font-semibold text-gray-700">{stage}</h2>
                        <p className="text-xs text-gray-500">{stageDeals.length} affari</p>
                        {total > 0 && <p className="text-xs text-green-700 font-semibold mb-2">€ {total.toLocaleString()}</p>}
                        <div className="flex flex-col gap-2 mt-2">
                          {stageDeals.map((deal, index) => (
                            <Draggable key={deal.id} draggableId={deal.id} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  onClick={() => setSelectedDeal(deal)}
                                  className={`bg-white rounded-lg p-3 cursor-pointer ${snapshot.isDragging ? 'shadow-xl rotate-1' : 'shadow hover:shadow-md'}`}
                                >
                                  <p className="font-semibold text-sm text-gray-800">{deal.title}</p>
                                  {deal.contact_name && <p className="text-xs text-gray-500">{deal.contact_name}</p>}
                                  {deal.estimate > 0 && <p className="text-xs text-green-600 mt-1">€ {deal.estimate.toLocaleString()}</p>}
                                  {deal.environment && <p className="text-xs text-blue-500">{deal.environment}</p>}
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
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
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm font-semibold text-gray-700">Raggruppa per:</label>
            <select className="border rounded-lg p-2 text-sm" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
              <option value="stage">Fase</option>
              <option value="origin">Origine</option>
              <option value="environment">Ambiente</option>
              <option value="project_timeline">Tempi progettuali</option>
            </select>
          </div>
          {Object.entries(getGroupedDeals()).map(([group, groupDeals]) => (
            <div key={group} className="mb-6">
              <h2 className="font-bold text-gray-700 mb-2">{group} <span className="text-gray-400 font-normal text-sm">({groupDeals.length})</span></h2>
              <div className="bg-white rounded-xl shadow overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left p-3">Titolo</th>
                      <th className="text-left p-3">Contatto</th>
                      <th className="text-left p-3">Ambiente</th>
                      <th className="text-left p-3">Fase</th>
                      <th className="text-left p-3">Preventivo</th>
                      <th className="text-left p-3">Appuntamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupDeals.map(deal => (
                      <tr key={deal.id} onClick={() => setSelectedDeal(deal)} className="border-t hover:bg-gray-50 cursor-pointer">
                        <td className="p-3 font-medium">{deal.title}</td>
                        <td className="p-3 text-gray-600">{deal.contact_name}</td>
                        <td className="p-3 text-gray-600">{deal.environment}</td>
                        <td className="p-3"><span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs">{deal.stage}</span></td>
                        <td className="p-3 text-green-600">{deal.estimate > 0 ? `€ ${deal.estimate.toLocaleString()}` : '-'}</td>
                        <td className="p-3 text-gray-600">{formatDate(deal.appointment_date)}</td>
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
                  <input
                    type="date"
                    className="border rounded-lg p-2 text-sm"
                    value={dateFrom}
                    onChange={e => { setActiveQuick('custom'); setDateFrom(e.target.value) }}
                  />
                  <span className="text-gray-500">→</span>
                  <input
                    type="date"
                    className="border rounded-lg p-2 text-sm"
                    value={dateTo}
                    onChange={e => { setActiveQuick('custom'); setDateTo(e.target.value) }}
                  />
                </div>
              )}
              {activeQuick === 'alltime' && (
                <span className="text-sm text-gray-400 ml-2 italic">Tutti i dati</span>
              )}
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

          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left p-3">Titolo</th>
                  <th className="text-left p-3">Contatto</th>
                  <th className="text-left p-3">Origine</th>
                  <th className="text-left p-3">Ambiente</th>
                  <th className="text-left p-3">Preventivo</th>
                  <th className="text-left p-3">Data ingresso</th>
                </tr>
              </thead>
              <tbody>
                {filteredDeals.map(deal => (
                  <tr key={deal.id} onClick={() => setSelectedDeal(deal)} className="border-t hover:bg-gray-50 cursor-pointer">
                    <td className="p-3 font-medium">{deal.title}</td>
                    <td className="p-3">{deal.contact_name}</td>
                    <td className="p-3">{deal.origin}</td>
                    <td className="p-3">{deal.environment}</td>
                    <td className="p-3 text-green-600">{deal.estimate > 0 ? `€ ${deal.estimate.toLocaleString()}` : '-'}</td>
                    <td className="p-3">{formatDate(deal.entry_date)}</td>
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
              <input className="border rounded-lg p-2" placeholder="Titolo *" value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Nome contatto" value={form.contact_name} onChange={e => setForm({...form, contact_name: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Telefono" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Origine (es. Meta Ads)" value={form.origin} onChange={e => setForm({...form, origin: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Ambiente (es. Cucina)" value={form.environment} onChange={e => setForm({...form, environment: e.target.value})} />
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
              <input className="border rounded-lg p-2" placeholder="Telefono" value={ingressoForm.phone} onChange={e => setIngressoForm({...ingressoForm, phone: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Email" value={ingressoForm.email} onChange={e => setIngressoForm({...ingressoForm, email: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Origine (es. Meta Ads)" value={ingressoForm.origin} onChange={e => setIngressoForm({...ingressoForm, origin: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Ambiente (es. Cucina)" value={ingressoForm.environment} onChange={e => setIngressoForm({...ingressoForm, environment: e.target.value})} />
              <label className="text-xs text-gray-500">Data ingresso</label>
              <input className="border rounded-lg p-2" type="date" value={ingressoForm.entry_date} onChange={e => setIngressoForm({...ingressoForm, entry_date: e.target.value})} />
              <label className="text-xs text-gray-500">Data appuntamento</label>
              <input className="border rounded-lg p-2" type="date" value={ingressoForm.appointment_date} onChange={e => setIngressoForm({...ingressoForm, appointment_date: e.target.value})} />
              <input className="border rounded-lg p-2" type="number" placeholder="Preventivo (€)" value={ingressoForm.estimate || ''} onChange={e => setIngressoForm({...ingressoForm, estimate: Number(e.target.value)})} />
              <input className="border rounded-lg p-2" placeholder="Tempi progettuali" value={ingressoForm.project_timeline} onChange={e => setIngressoForm({...ingressoForm, project_timeline: e.target.value})} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={addIngresso} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">Salva Ingresso</button>
              <button onClick={() => { setShowIngressoForm(false); setSearchQuery(''); setSearchResults([]); setIsNewContact(false) }} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Dettaglio */}
      {selectedDeal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-screen overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">{selectedDeal.title}</h2>
            <div className="flex flex-col gap-2 text-sm">
              {selectedDeal.contact_name && <p><span className="font-semibold">Contatto:</span> {selectedDeal.contact_name}</p>}
              {selectedDeal.phone && <p><span className="font-semibold">Telefono:</span> {selectedDeal.phone}</p>}
              {selectedDeal.email && <p><span className="font-semibold">Email:</span> {selectedDeal.email}</p>}
              {selectedDeal.origin && <p><span className="font-semibold">Origine:</span> {selectedDeal.origin}</p>}
              {selectedDeal.environment && <p><span className="font-semibold">Ambiente:</span> {selectedDeal.environment}</p>}
              {selectedDeal.entry_date && <p><span className="font-semibold">Data ingresso:</span> {formatDate(selectedDeal.entry_date)}</p>}
              {selectedDeal.appointment_date && <p><span className="font-semibold">Appuntamento:</span> {formatDate(selectedDeal.appointment_date)}</p>}
              {selectedDeal.estimate > 0 && <p><span className="font-semibold">Preventivo:</span> € {selectedDeal.estimate.toLocaleString()}</p>}
              {selectedDeal.project_timeline && <p><span className="font-semibold">Tempi progettuali:</span> {selectedDeal.project_timeline}</p>}
            </div>
            <div className="mt-4">
              <label className="text-sm font-semibold">Sposta nella fase:</label>
              <select className="border rounded-lg p-2 w-full mt-1" value={selectedDeal.stage} onChange={e => { updateStage(selectedDeal.id, e.target.value); setSelectedDeal({...selectedDeal, stage: e.target.value}) }}>
                {STAGES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setSelectedDeal(null)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Chiudi</button>
              <button onClick={() => deleteDeal(selectedDeal.id)} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600">Elimina</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}