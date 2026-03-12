'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const STAGES = ['Qualificato', 'Appuntamento fissato', 'Ingresso', 'Preventivo', 'Vendita', 'Non convertito']
const PROB_COLORS: Record<number, string> = { 0: 'bg-gray-100 text-gray-500', 25: 'bg-red-100 text-red-700', 50: 'bg-orange-100 text-orange-700', 75: 'bg-yellow-100 text-yellow-700', 90: 'bg-blue-100 text-blue-700', 100: 'bg-green-100 text-green-700' }

function formatDate(dateStr: string) {
  if (!dateStr) return '—'
  const parts = dateStr.split('-')
  if (parts.length === 3) return `${parseInt(parts[2])}/${parseInt(parts[1])}/${parts[0]}`
  return '—'
}

interface Contact {
  id: string; name: string; phone: string; email: string; origin: string; company?: string; notes?: string; created_at: string
}

interface Deal {
  id: string; contact_name: string; environment: string; entry_date: string; estimate: number
  stage: string; probability: number | null; sale_date?: string; created_at: string; appointment_date: string
}

export default function ContactPage({ contactId }: { contactId: string }) {
  const router = useRouter()
  const [contact, setContact] = useState<Contact | null>(null)
  const [deals, setDeals] = useState<Deal[]>([])
  const [editMode, setEditMode] = useState(false)
  const [editContact, setEditContact] = useState<Contact | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { fetchAll() }, [contactId])

  async function fetchAll() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { window.location.replace('/login'); return }
    const { data: c, error } = await supabase.from('contacts').select('*').eq('id', contactId).single()
    if (c) { setContact(c); setEditContact({ ...c }) }
    const { data: d } = await supabase.from('deals').select('*').eq('contact_id', contactId).order('created_at', { ascending: false })
    setDeals(d || [])
    setLoading(false)
  }

  async function saveContact() {
    if (!editContact) return
    setSaving(true)
    await supabase.from('contacts').update({
      name: editContact.name, phone: editContact.phone || null,
      email: editContact.email || null, origin: editContact.origin || null,
    }).eq('id', contactId)
    setSaving(false)
    setEditMode(false)
    fetchAll()
  }

  async function deleteContact() {
    await supabase.from('contacts').delete().eq('id', contactId)
    router.push('/?tab=contacts')
  }

  async function newDeal() {
    const { data } = await supabase.from('deals').insert({
      title: contact?.name || '', contact_name: contact?.name || '',
      phone: contact?.phone || null, email: contact?.email || null,
      origin: contact?.origin || null, stage: 'Qualificato',
      is_lead: false, probability: null, contact_id: contactId,
    }).select().single()
    if (data) router.push(`/deal/${data.id}`)
  }

  const stageColor: Record<string, string> = {
    'Qualificato': 'bg-gray-100 text-gray-600',
    'Appuntamento fissato': 'bg-blue-100 text-blue-700',
    'Ingresso': 'bg-cyan-100 text-cyan-700',
    'Preventivo': 'bg-yellow-100 text-yellow-700',
    'Vendita': 'bg-green-100 text-green-700',
    'Non convertito': 'bg-red-100 text-red-500',
  }

  const totaleVenduto = deals.filter(d => d.stage === 'Vendita').reduce((s, d) => s + (d.estimate || 0), 0)
  const inCorso = deals.filter(d => !['Vendita', 'Non convertito'].includes(d.stage)).length

  if (loading) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <p className="text-gray-400">Caricamento...</p>
    </div>
  )

  if (!contact) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <p className="text-gray-400">Contatto non trovato</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow px-4 py-3 flex items-center gap-3 sticky top-0 z-40">
        <button onClick={() => router.push('/?tab=contacts')} className="text-gray-400 hover:text-blue-600 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
          </svg>
        </button>
        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
          {contact.name?.charAt(0)?.toUpperCase()}
        </div>
        <h1 className="font-bold text-gray-800 flex-1 truncate">{contact.name}</h1>
        <button onClick={() => setEditMode(e => !e)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${editMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          {editMode ? 'Modifica' : '✏️ Modifica'}
        </button>
      </div>

      <div className="p-4 sm:p-6 max-w-3xl mx-auto">

        {/* Anagrafica */}
        <div className="bg-white rounded-xl shadow p-4 mb-4">
          <h2 className="font-bold text-gray-700 mb-3">Anagrafica</h2>
          {editMode && editContact ? (
            <div className="flex flex-col gap-3">
              <div><label className="text-xs text-gray-400">Nome</label>
                <input className="border rounded-lg p-2.5 w-full mt-1 text-sm" value={editContact.name} onChange={e => setEditContact({...editContact, name: e.target.value})} /></div>
              <div><label className="text-xs text-gray-400">Telefono</label>
                <input className="border rounded-lg p-2.5 w-full mt-1 text-sm" value={editContact.phone || ''} onChange={e => setEditContact({...editContact, phone: e.target.value})} /></div>
              <div><label className="text-xs text-gray-400">Email</label>
                <input className="border rounded-lg p-2.5 w-full mt-1 text-sm" value={editContact.email || ''} onChange={e => setEditContact({...editContact, email: e.target.value})} /></div>
              <div><label className="text-xs text-gray-400">Origine</label>
                <input className="border rounded-lg p-2.5 w-full mt-1 text-sm" value={editContact.origin || ''} onChange={e => setEditContact({...editContact, origin: e.target.value})} /></div>
              <div className="flex gap-2 mt-1">
                <button onClick={saveContact} disabled={saving} className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-40">
                  {saving ? 'Salvo...' : 'Salva'}
                </button>
                <button onClick={() => { setEditMode(false); setEditContact({...contact}) }} className="flex-1 bg-gray-200 text-gray-700 py-2.5 rounded-lg text-sm">Annulla</button>
              </div>
              <button onClick={() => setConfirmDelete(true)} className="text-xs text-red-400 hover:text-red-600 text-center mt-1">Elimina contatto</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-gray-400">Telefono</p><p className="text-sm font-medium text-gray-800 mt-0.5">{contact.phone || '—'}</p></div>
              <div><p className="text-xs text-gray-400">Email</p><p className="text-sm font-medium text-gray-800 mt-0.5 truncate">{contact.email || '—'}</p></div>
              <div><p className="text-xs text-gray-400">Origine</p><p className="text-sm font-medium text-gray-800 mt-0.5">{contact.origin || '—'}</p></div>
              <div><p className="text-xs text-gray-400">Contatto dal</p><p className="text-sm font-medium text-gray-800 mt-0.5">{formatDate(contact.created_at?.split('T')[0])}</p></div>
            </div>
          )}
        </div>

        {/* KPI */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-xl shadow p-3 text-center">
            <p className="text-xs text-gray-400">Affari totali</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{deals.length}</p>
          </div>
          <div className="bg-white rounded-xl shadow p-3 text-center">
            <p className="text-xs text-gray-400">In corso</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{inCorso}</p>
          </div>
          <div className="bg-white rounded-xl shadow p-3 text-center">
            <p className="text-xs text-gray-400">Venduto</p>
            <p className="text-lg font-bold text-green-600 mt-1">{totaleVenduto > 0 ? `€${Math.round(totaleVenduto / 1000)}k` : '—'}</p>
          </div>
        </div>

        {/* Affari */}
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-700">Affari</h2>
            <button onClick={newDeal} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-blue-700">
              + Nuovo Affare
            </button>
          </div>

          {deals.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Nessun affare ancora</p>
          ) : (
            <div className="flex flex-col gap-2">
              {deals.map(deal => (
                <div key={deal.id}
                  onClick={() => router.push(`/deal/${deal.id}`)}
                  className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50 cursor-pointer transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stageColor[deal.stage] || 'bg-gray-100 text-gray-600'}`}>{deal.stage}</span>
                      {deal.environment && <span className="text-xs text-gray-500">{deal.environment}</span>}
                      {deal.probability !== null && deal.probability !== undefined && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${PROB_COLORS[deal.probability] || 'bg-gray-100 text-gray-600'}`}>{deal.probability}%</span>
                      )}
                    </div>
                    <div className="flex gap-3 mt-1">
                      {deal.estimate > 0 && <span className="text-xs text-green-600 font-semibold">€ {deal.estimate.toLocaleString()}</span>}
                      {deal.entry_date && <span className="text-xs text-gray-400">Ingresso: {formatDate(deal.entry_date)}</span>}
                      {deal.sale_date && <span className="text-xs text-green-500">Vendita: {formatDate(deal.sale_date)}</span>}
                    </div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                  </svg>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Popup conferma eliminazione */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-6 w-full sm:max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-2">Elimina contatto</h3>
            <p className="text-gray-600 text-sm mb-5">Eliminare <strong>{contact.name}</strong>? Gli affari collegati non verranno eliminati.</p>
            <div className="flex gap-2">
              <button onClick={deleteContact} className="flex-1 bg-red-500 text-white py-3 rounded-lg">Elimina</button>
              <button onClick={() => setConfirmDelete(false)} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
