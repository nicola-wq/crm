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
}

const emptyDeal = { title: '', contact_name: '', phone: '', email: '', origin: '', environment: '', entry_date: '', appointment_date: '', estimate: 0, project_timeline: '', stage: 'Nuovo Lead' }

export default function CrmContent() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [checked, setChecked] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
  const [form, setForm] = useState(emptyDeal)

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

  if (!checked) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">Verifica accesso...</p></div>

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">CRM - Pipeline Vendita</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowForm(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">+ Nuovo Affare</button>
          <button onClick={() => { supabase.auth.signOut(); window.location.replace('/login') }} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Esci</button>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="overflow-x-auto p-6">
          <div className="flex gap-4" style={{ minWidth: 'max-content' }}>
            {STAGES.map(stage => (
              <Droppable droppableId={stage} key={stage}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`rounded-xl p-3 w-64 ${snapshot.isDraggingOver ? 'bg-blue-100' : 'bg-gray-200'}`}
                  >
                    <h2 className="font-semibold text-gray-700 mb-1">{stage}</h2>
                    <p className="text-xs text-gray-500 mb-3">{deals.filter(d => d.stage === stage).length} affari</p>
                    <div className="flex flex-col gap-2">
                      {deals.filter(d => d.stage === stage).map((deal, index) => (
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
            ))}
          </div>
        </div>
      </DragDropContext>

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
              <input className="border rounded-lg p-2" type="date" placeholder="Data ingresso" value={form.entry_date} onChange={e => setForm({...form, entry_date: e.target.value})} />
              <input className="border rounded-lg p-2" type="date" placeholder="Data appuntamento" value={form.appointment_date} onChange={e => setForm({...form, appointment_date: e.target.value})} />
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
              {selectedDeal.entry_date && <p><span className="font-semibold">Data ingresso:</span> {selectedDeal.entry_date}</p>}
              {selectedDeal.appointment_date && <p><span className="font-semibold">Appuntamento:</span> {selectedDeal.appointment_date}</p>}
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