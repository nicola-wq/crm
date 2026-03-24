'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const STATI_OUTREACH = [
  'Da contattare', 'Primo contatto', 'Risposta ricevuta',
  'Demo schedulata', 'Proposta inviata', 'Trattativa', 'Cliente', 'Non interessato',
]

const RUOLI_CATEGORIA = [
  'CEO/DG/Presidente', 'Marketing/Comunicazione', 'IT/ICT', 'Marketing/Digital', 'Altro',
]

const SCORE_LABELS: Record<number, string> = { 1: 'Bassa', 2: 'Media', 3: 'Alta' }

interface Contact {
  id: string; first_name: string; last_name: string; azienda: string
  ruolo_categoria: string; titolo: string; score: number
  email: string; email2: string; phone: string; phone2: string
  linkedin_url: string; location: string; connection_degree: string
  stato_outreach: string; note: string; created_at: string; updated_at: string
}

interface OutreachLog {
  id: string; contact_id: string; tipo: string; data: string; note: string; created_by: string; created_at: string
}

function fullName(c: Contact) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'
}

function initials(c: Contact) {
  return ((c.first_name?.[0] || '') + (c.last_name?.[0] || '')).toUpperCase() || '?'
}

function scoreColor(score: number) {
  if (score === 3) return 'bg-[#1D3557]/10 text-[#1D3557] border-[#1D3557]/20'
  if (score === 2) return 'bg-yellow-50 text-yellow-700 border-yellow-200'
  return 'bg-gray-50 text-gray-500 border-gray-200'
}

function roleColor(role: string) {
  if (role?.includes('CEO') || role?.includes('Presidente') || role?.includes('DG'))
    return 'bg-amber-50 text-amber-700'
  if (role?.includes('IT') || role?.includes('ICT'))
    return 'bg-blue-50 text-blue-700'
  if (role?.includes('Marketing') || role?.includes('Comunicazione'))
    return 'bg-emerald-50 text-emerald-700'
  return 'bg-gray-50 text-gray-500'
}

function statoColor(stato: string) {
  const map: Record<string, string> = {
    'Da contattare': 'bg-gray-100 text-gray-600',
    'Primo contatto': 'bg-blue-100 text-blue-700',
    'Risposta ricevuta': 'bg-purple-100 text-purple-700',
    'Demo schedulata': 'bg-orange-100 text-orange-700',
    'Proposta inviata': 'bg-yellow-100 text-yellow-700',
    'Trattativa': 'bg-indigo-100 text-indigo-700',
    'Cliente': 'bg-emerald-100 text-emerald-700',
    'Non interessato': 'bg-red-100 text-red-500',
  }
  return map[stato] || 'bg-gray-100 text-gray-600'
}

function formatDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateTime(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const TIPI_OUTREACH = ['Email', 'LinkedIn', 'Telefono', 'Meeting', 'Demo', 'Altro']

export default function ContactPage({ contactId }: { contactId: string }) {
  const router = useRouter()
  const [contact, setContact] = useState<Contact | null>(null)
  const [logs, setLogs] = useState<OutreachLog[]>([])
  const [editMode, setEditMode] = useState(false)
  const [editContact, setEditContact] = useState<Contact | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showLogForm, setShowLogForm] = useState(false)
  const [logForm, setLogForm] = useState({ tipo: 'Email', data: new Date().toISOString().split('T')[0], note: '' })
  const [savingLog, setSavingLog] = useState(false)
  const [userEmail, setUserEmail] = useState('')

  useEffect(() => { fetchAll() }, [contactId])

  async function fetchAll() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { window.location.replace('/login'); return }
    setUserEmail(session.user.email || '')

    const { data: c } = await supabase.from('contacts').select('*').eq('id', contactId).single()
    if (c) { setContact(c); setEditContact({ ...c }) }

    const { data: l } = await supabase.from('outreach_log').select('*').eq('contact_id', contactId).order('data', { ascending: false })
    setLogs(l || [])
    setLoading(false)
  }

  async function saveContact() {
    if (!editContact) return
    setSaving(true)
    await supabase.from('contacts').update({ ...editContact, updated_at: new Date().toISOString() }).eq('id', contactId)
    setSaving(false)
    setEditMode(false)
    fetchAll()
  }

  async function deleteContact() {
    await supabase.from('outreach_log').delete().eq('contact_id', contactId)
    await supabase.from('contacts').delete().eq('id', contactId)
    router.push('/?tab=contacts')
  }

  async function addLog() {
    if (!logForm.note.trim()) return
    setSavingLog(true)
    await supabase.from('outreach_log').insert({
      contact_id: contactId,
      tipo: logForm.tipo,
      data: logForm.data,
      note: logForm.note,
      created_by: userEmail,
    })

    // Auto-advance stato if appropriate
    const statoMap: Record<string, string> = {
      'Email': 'Primo contatto',
      'LinkedIn': 'Primo contatto',
      'Telefono': 'Primo contatto',
      'Meeting': 'Demo schedulata',
      'Demo': 'Demo schedulata',
    }
    const currentStato = contact?.stato_outreach || 'Da contattare'
    const targetStato = statoMap[logForm.tipo]
    const order = STATI_OUTREACH.indexOf(targetStato)
    const currentOrder = STATI_OUTREACH.indexOf(currentStato)
    if (targetStato && order > currentOrder && currentStato !== 'Cliente') {
      await supabase.from('contacts').update({ stato_outreach: targetStato, updated_at: new Date().toISOString() }).eq('id', contactId)
    }

    setLogForm({ tipo: 'Email', data: new Date().toISOString().split('T')[0], note: '' })
    setShowLogForm(false)
    setSavingLog(false)
    fetchAll()
  }

  async function deleteLog(logId: string) {
    await supabase.from('outreach_log').delete().eq('id', logId)
    fetchAll()
  }

  function set(k: keyof Contact, v: string | number) {
    setEditContact(e => e ? { ...e, [k]: v } : e)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-10 h-10 rounded-full border-4 border-[#1D3557] border-t-transparent animate-spin" />
    </div>
  )

  if (!contact) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p className="text-[#9490A0]">Contatto non trovato</p>
      <button className="btn btn-ghost" onClick={() => router.push('/?tab=contacts')}>← Torna ai contatti</button>
    </div>
  )

  const c = editMode ? editContact! : contact
  const stageIdx = STATI_OUTREACH.indexOf(contact.stato_outreach || 'Da contattare')

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-gradient)' }}>
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-white/30 backdrop-blur border-b border-white/20">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button className="btn btn-ghost p-2" onClick={() => router.push('/?tab=contacts')}>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
          </button>
          <span className="font-semibold text-[#1A1A1A] flex-1 truncate">{fullName(contact)}</span>
          <div className="flex gap-2">
            {!editMode ? (
              <>
                <button className="btn btn-ghost text-sm" onClick={() => setEditMode(true)}>Modifica</button>
                <button className="btn btn-ghost text-sm text-red-500 hover:bg-red-50" onClick={() => setConfirmDelete(true)}>Elimina</button>
              </>
            ) : (
              <>
                <button className="btn btn-ghost text-sm" onClick={() => { setEditMode(false); setEditContact({ ...contact }) }}>Annulla</button>
                <button className="btn btn-primary text-sm" onClick={saveContact} disabled={saving}>
                  {saving ? 'Salvataggio…' : 'Salva'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column: contact info */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Header card */}
          <div className="card p-5">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-[#1D3557]/10 text-[#1D3557] flex items-center justify-center font-bold text-xl flex-shrink-0">
                {initials(contact)}
              </div>
              <div className="flex-1 min-w-0">
                {editMode ? (
                  <div className="flex gap-2 mb-2">
                    <input className="input flex-1" placeholder="Nome" value={c.first_name} onChange={e => set('first_name', e.target.value)} autoFocus />
                    <input className="input flex-1" placeholder="Cognome" value={c.last_name} onChange={e => set('last_name', e.target.value)} />
                  </div>
                ) : (
                  <h1 className="text-xl font-bold text-[#1A1A1A]">{fullName(contact)}</h1>
                )}

                {editMode ? (
                  <input className="input mb-2" placeholder="Titolo" value={c.titolo} onChange={e => set('titolo', e.target.value)} />
                ) : (
                  <p className="text-sm text-[#5C5862] mt-0.5">{contact.titolo || '—'}</p>
                )}

                {editMode ? (
                  <input className="input" placeholder="Azienda" value={c.azienda} onChange={e => set('azienda', e.target.value)} />
                ) : (
                  <p className="font-semibold text-[#1D3557] mt-1">{contact.azienda || '—'}</p>
                )}
              </div>
            </div>

            {/* Score & Ruolo */}
            <div className="flex flex-wrap gap-2 mt-4">
              {editMode ? (
                <>
                  <div className="flex gap-2">
                    {[1,2,3].map(s => (
                      <button key={s} type="button" onClick={() => set('score', s)}
                        className={`px-3 py-1.5 rounded-full text-xs border font-semibold transition-colors ${c.score === s ? scoreColor(s) + ' border-current' : 'bg-white/50 text-[#9490A0] border-white/30'}`}>
                        {'★'.repeat(s)} {SCORE_LABELS[s]}
                      </button>
                    ))}
                  </div>
                  <select className="input w-auto text-xs" value={c.ruolo_categoria} onChange={e => set('ruolo_categoria', e.target.value)}>
                    <option value="">Ruolo…</option>
                    {RUOLI_CATEGORIA.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </>
              ) : (
                <>
                  <span className={`badge border text-xs font-semibold ${scoreColor(contact.score)}`}>
                    {'★'.repeat(contact.score || 1)} {SCORE_LABELS[contact.score] || 'Bassa'} priorità
                  </span>
                  {contact.ruolo_categoria && (
                    <span className={`badge text-xs ${roleColor(contact.ruolo_categoria)}`}>{contact.ruolo_categoria}</span>
                  )}
                  {contact.location && (
                    <span className="badge text-xs bg-white/50 text-[#9490A0]">📍 {contact.location}</span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Contact details */}
          <div className="card p-5">
            <h2 className="font-semibold text-sm text-[#5C5862] uppercase tracking-wide mb-4">Contatti</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {editMode ? (
                <>
                  <div>
                    <label className="text-xs text-[#9490A0] mb-1 block">Email</label>
                    <input className="input" type="email" placeholder="email@azienda.it" value={c.email} onChange={e => set('email', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-[#9490A0] mb-1 block">Email 2</label>
                    <input className="input" type="email" placeholder="email2@azienda.it" value={c.email2} onChange={e => set('email2', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-[#9490A0] mb-1 block">Telefono</label>
                    <input className="input" placeholder="+39 …" value={c.phone} onChange={e => set('phone', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-[#9490A0] mb-1 block">Telefono 2</label>
                    <input className="input" placeholder="+39 …" value={c.phone2} onChange={e => set('phone2', e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-[#9490A0] mb-1 block">LinkedIn URL</label>
                    <input className="input" placeholder="https://linkedin.com/in/…" value={c.linkedin_url} onChange={e => set('linkedin_url', e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-[#9490A0] mb-1 block">Città / Area</label>
                    <input className="input" placeholder="Milano, Lombardia" value={c.location} onChange={e => set('location', e.target.value)} />
                  </div>
                </>
              ) : (
                <>
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} className="flex items-center gap-2 p-3 rounded-xl bg-white/40 hover:bg-white/60 transition-colors group">
                      <div className="w-8 h-8 rounded-lg bg-[#2A9D8F]/10 flex items-center justify-center text-[#2A9D8F] flex-shrink-0">✉</div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-[#9490A0]">Email</p>
                        <p className="text-sm text-[#1A1A1A] truncate group-hover:text-[#2A9D8F]">{contact.email}</p>
                      </div>
                    </a>
                  ) : (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-white/20">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 flex-shrink-0">✉</div>
                      <div><p className="text-[10px] text-[#9490A0]">Email</p><p className="text-sm text-[#9490A0]">—</p></div>
                    </div>
                  )}
                  {contact.email2 && (
                    <a href={`mailto:${contact.email2}`} className="flex items-center gap-2 p-3 rounded-xl bg-white/40 hover:bg-white/60 transition-colors group">
                      <div className="w-8 h-8 rounded-lg bg-[#2A9D8F]/10 flex items-center justify-center text-[#2A9D8F] flex-shrink-0">✉</div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-[#9490A0]">Email 2</p>
                        <p className="text-sm text-[#1A1A1A] truncate group-hover:text-[#2A9D8F]">{contact.email2}</p>
                      </div>
                    </a>
                  )}
                  {contact.phone ? (
                    <a href={`tel:${contact.phone}`} className="flex items-center gap-2 p-3 rounded-xl bg-white/40 hover:bg-white/60 transition-colors group">
                      <div className="w-8 h-8 rounded-lg bg-[#1D3557]/10 flex items-center justify-center text-[#1D3557] flex-shrink-0">☎</div>
                      <div><p className="text-[10px] text-[#9490A0]">Telefono</p><p className="text-sm text-[#1A1A1A] group-hover:text-[#1D3557]">{contact.phone}</p></div>
                    </a>
                  ) : (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-white/20">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 flex-shrink-0">☎</div>
                      <div><p className="text-[10px] text-[#9490A0]">Telefono</p><p className="text-sm text-[#9490A0]">—</p></div>
                    </div>
                  )}
                  {contact.phone2 && (
                    <a href={`tel:${contact.phone2}`} className="flex items-center gap-2 p-3 rounded-xl bg-white/40 hover:bg-white/60 transition-colors group">
                      <div className="w-8 h-8 rounded-lg bg-[#1D3557]/10 flex items-center justify-center text-[#1D3557] flex-shrink-0">☎</div>
                      <div><p className="text-[10px] text-[#9490A0]">Telefono 2</p><p className="text-sm text-[#1A1A1A] group-hover:text-[#1D3557]">{contact.phone2}</p></div>
                    </a>
                  )}
                  {contact.linkedin_url && (
                    <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 rounded-xl bg-white/40 hover:bg-white/60 transition-colors group sm:col-span-2">
                      <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0 font-bold text-xs">in</div>
                      <div className="min-w-0"><p className="text-[10px] text-[#9490A0]">LinkedIn</p><p className="text-sm text-[#1A1A1A] truncate group-hover:text-blue-600">{contact.linkedin_url}</p></div>
                    </a>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Note */}
          <div className="card p-5">
            <h2 className="font-semibold text-sm text-[#5C5862] uppercase tracking-wide mb-3">Note</h2>
            {editMode ? (
              <textarea
                className="input resize-none"
                rows={4}
                placeholder="Note sul contatto…"
                value={c.note}
                onChange={e => set('note', e.target.value)}
              />
            ) : (
              <p className="text-sm text-[#5C5862] whitespace-pre-wrap">{contact.note || <span className="text-[#9490A0]">Nessuna nota</span>}</p>
            )}
          </div>

          {/* Outreach log */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm text-[#5C5862] uppercase tracking-wide">Log outreach</h2>
              {!showLogForm && (
                <button className="btn btn-primary text-xs" onClick={() => setShowLogForm(true)}>+ Aggiungi</button>
              )}
            </div>

            {showLogForm && (
              <div className="mb-4 p-4 rounded-xl bg-white/40 border border-white/40 flex flex-col gap-3">
                <div className="flex gap-3">
                  <select className="input flex-1 text-sm" value={logForm.tipo} onChange={e => setLogForm(f => ({ ...f, tipo: e.target.value }))}>
                    {TIPI_OUTREACH.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input type="date" className="input w-auto text-sm" value={logForm.data} onChange={e => setLogForm(f => ({ ...f, data: e.target.value }))} />
                </div>
                <textarea
                  className="input resize-none text-sm"
                  rows={3}
                  placeholder="Descrivi l'interazione…"
                  value={logForm.note}
                  onChange={e => setLogForm(f => ({ ...f, note: e.target.value }))}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={() => { setShowLogForm(false); setLogForm({ tipo: 'Email', data: new Date().toISOString().split('T')[0], note: '' }) }} className="btn btn-ghost flex-1 text-sm">Annulla</button>
                  <button onClick={addLog} disabled={savingLog || !logForm.note.trim()} className="btn btn-primary flex-1 text-sm disabled:opacity-40">
                    {savingLog ? 'Salvataggio…' : 'Salva'}
                  </button>
                </div>
              </div>
            )}

            {logs.length === 0 ? (
              <p className="text-sm text-[#9490A0] py-4 text-center">Nessuna interazione registrata</p>
            ) : (
              <div className="space-y-3">
                {logs.map(log => (
                  <div key={log.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-[#1D3557]/10 text-[#1D3557] flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {log.tipo === 'Email' ? '✉' : log.tipo === 'LinkedIn' ? 'in' : log.tipo === 'Telefono' ? '☎' : log.tipo === 'Demo' ? '▶' : '●'}
                      </div>
                      <div className="w-px flex-1 bg-white/30 mt-1" />
                    </div>
                    <div className="flex-1 pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="badge text-[10px] bg-[#1D3557]/10 text-[#1D3557]">{log.tipo}</span>
                          <span className="text-xs text-[#9490A0]">{formatDate(log.data)}</span>
                        </div>
                        <button onClick={() => deleteLog(log.id)} className="text-[#9490A0] hover:text-red-400 transition-colors p-1">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                      </div>
                      <p className="text-sm text-[#5C5862] mt-1.5 whitespace-pre-wrap">{log.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column: status & pipeline */}
        <div className="flex flex-col gap-4">
          {/* Stato outreach */}
          <div className="card p-5">
            <h2 className="font-semibold text-sm text-[#5C5862] uppercase tracking-wide mb-3">Stato outreach</h2>
            {editMode ? (
              <select className="input" value={c.stato_outreach} onChange={e => set('stato_outreach', e.target.value)}>
                {STATI_OUTREACH.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <div className="flex flex-col gap-1.5">
                {STATI_OUTREACH.map((stato, idx) => {
                  const isActive = stato === (contact.stato_outreach || 'Da contattare')
                  const isPast = idx < stageIdx
                  return (
                    <button
                      key={stato}
                      onClick={async () => {
                        if (!editMode) {
                          await supabase.from('contacts').update({ stato_outreach: stato, updated_at: new Date().toISOString() }).eq('id', contactId)
                          fetchAll()
                        }
                      }}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors text-left ${
                        isActive ? `${statoColor(stato)} font-semibold` :
                        isPast ? 'text-[#9490A0] bg-white/20 hover:bg-white/30' :
                        'text-[#9490A0] bg-transparent hover:bg-white/20'
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-current' : isPast ? 'bg-[#2A9D8F]' : 'bg-white/40'}`} />
                      {stato}
                      {isPast && <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 ml-auto text-[#2A9D8F]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="card p-5">
            <h2 className="font-semibold text-sm text-[#5C5862] uppercase tracking-wide mb-3">Azioni rapide</h2>
            <div className="flex flex-col gap-2">
              {contact.email && (
                <a href={`mailto:${contact.email}?subject=Atinedis - Soluzione per la gestione volantini GDO`}
                  className="btn btn-ghost text-sm gap-2 justify-start">
                  <span>✉</span> Invia email
                </a>
              )}
              {contact.linkedin_url && (
                <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer"
                  className="btn btn-ghost text-sm gap-2 justify-start">
                  <span className="font-bold text-blue-600">in</span> Apri LinkedIn
                </a>
              )}
              {contact.phone && (
                <a href={`tel:${contact.phone}`} className="btn btn-ghost text-sm gap-2 justify-start">
                  <span>☎</span> Chiama
                </a>
              )}
              <button
                onClick={() => setShowLogForm(true)}
                className="btn btn-sage text-sm gap-2 justify-start">
                <span>+</span> Registra interazione
              </button>
            </div>
          </div>

          {/* Meta info */}
          <div className="card p-5">
            <h2 className="font-semibold text-sm text-[#5C5862] uppercase tracking-wide mb-3">Info</h2>
            <div className="space-y-2 text-xs">
              {contact.connection_degree && (
                <div className="flex justify-between">
                  <span className="text-[#9490A0]">Connessione LinkedIn</span>
                  <span className="font-medium">{contact.connection_degree}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[#9490A0]">Aggiunto il</span>
                <span className="font-medium">{formatDate(contact.created_at)}</span>
              </div>
              {contact.updated_at && (
                <div className="flex justify-between">
                  <span className="text-[#9490A0]">Aggiornato</span>
                  <span className="font-medium">{formatDate(contact.updated_at)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[#9490A0]">Interazioni</span>
                <span className="font-medium">{logs.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="modal-content p-6 max-w-sm text-center" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </div>
            <p className="font-semibold text-lg mb-1">Elimina contatto?</p>
            <p className="text-sm text-[#9490A0] mb-5">Questa azione è irreversibile. Verranno eliminati anche tutti i log di outreach.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(false)} className="btn btn-ghost flex-1">Annulla</button>
              <button onClick={deleteContact} className="btn flex-1 bg-red-500 text-white border-red-500 hover:bg-red-600">Elimina</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
