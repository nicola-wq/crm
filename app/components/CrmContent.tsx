'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATI_OUTREACH = [
  'Da contattare',
  'Primo contatto',
  'Risposta ricevuta',
  'Demo schedulata',
  'Proposta inviata',
  'Trattativa',
  'Cliente',
  'Non interessato',
]

const RUOLI_CATEGORIA = [
  'CEO/DG/Presidente',
  'Marketing/Comunicazione',
  'IT/ICT',
  'Marketing/Digital',
  'Altro',
]

const SCORE_LABELS: Record<number, string> = { 1: 'Bassa', 2: 'Media', 3: 'Alta' }

// ─── Types ────────────────────────────────────────────────────────────────────

interface Contact {
  id: string
  first_name: string
  last_name: string
  azienda: string
  ruolo_categoria: string
  titolo: string
  score: number
  email: string
  email2: string
  phone: string
  phone2: string
  linkedin_url: string
  location: string
  connection_degree: string
  stato_outreach: string
  note: string
  created_at: string
  updated_at: string
}

type View = 'dashboard' | 'contacts' | 'pipeline' | 'companies'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(c: Contact) {
  return ((c.first_name?.[0] || '') + (c.last_name?.[0] || '')).toUpperCase() || '?'
}

function fullName(c: Contact) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'
}

function scoreColor(score: number) {
  if (score === 3) return 'bg-[#1D3557]/10 text-[#1D3557] border-[#1D3557]/20'
  if (score === 2) return 'bg-yellow-50 text-yellow-700 border-yellow-200'
  return 'bg-gray-50 text-gray-500 border-gray-200'
}

function roleColor(role: string) {
  if (role?.includes('CEO') || role?.includes('Presidente') || role?.includes('DG'))
    return 'bg-amber-50 text-amber-700 border-amber-200'
  if (role?.includes('IT') || role?.includes('ICT'))
    return 'bg-blue-50 text-blue-700 border-blue-200'
  if (role?.includes('Marketing') || role?.includes('Comunicazione'))
    return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return 'bg-gray-50 text-gray-500 border-gray-200'
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

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }

  function parseLine(line: string): string[] {
    const result: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQ = !inQ }
      else if (line[i] === ',' && !inQ) { result.push(cur.trim()); cur = '' }
      else cur += line[i]
    }
    result.push(cur.trim())
    return result
  }

  const headers = parseLine(lines[0])
  const rows = lines.slice(1).map(l => {
    const vals = parseLine(l)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = vals[i] || '' })
    return obj
  })
  return { headers, rows }
}

function toCSV(contacts: Contact[]): string {
  const headers = ['first_name','last_name','azienda','ruolo_categoria','titolo','score',
    'email','email2','phone','phone2','linkedin_url','location','stato_outreach','note']
  const rows = contacts.map(c => headers.map(h => {
    const val = String((c as any)[h] ?? '')
    return val.includes(',') || val.includes('"') || val.includes('\n')
      ? `"${val.replace(/"/g, '""')}"` : val
  }).join(','))
  return [headers.join(','), ...rows].join('\n')
}

// Map CSV column names to Contact fields
function mapCSVToContact(row: Record<string, string>): Partial<Contact> {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const val = row[k] ?? row[k.toLowerCase()] ?? ''
      if (val && val !== 'ND' && val !== '#ERROR!') return val
    }
    return ''
  }

  const nome = get('Nome', 'first_name', 'nome')
  const cognome = get('Cognome', 'last_name', 'cognome')
  const scoreRaw = get('Score', 'score', 'priorità')
  const score = parseInt(scoreRaw) || 1

  return {
    first_name: nome,
    last_name: cognome,
    azienda: get('Azienda', 'azienda', 'company'),
    ruolo_categoria: get('Ruolo Categoria', 'ruolo_categoria', 'Ruolo'),
    titolo: get('Titolo', 'titolo', 'job', 'title'),
    score: [1,2,3].includes(score) ? score : 1,
    email: get('Email', 'email'),
    email2: get('Email 2', 'email2'),
    phone: get('Telefono 1', 'phone', 'telefono', 'Phone 1'),
    phone2: get('Telefono 2', 'phone2', 'telefono2', 'Phone 2'),
    linkedin_url: get('LinkedIn URL', 'linkedin_url', 'profileUrl'),
    location: get('Città/Area', 'location', 'città'),
    connection_degree: get('Connessione', 'connection_degree'),
    stato_outreach: get('stato_outreach', 'stato') || 'Da contattare',
    note: get('Note', 'note'),
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const stars = '★'.repeat(score) + '☆'.repeat(3 - score)
  return (
    <span className={`badge border text-[10px] font-semibold ${scoreColor(score)}`}>
      {stars}
    </span>
  )
}

function RoleBadge({ role }: { role: string }) {
  if (!role) return null
  const short = role.replace('/Comunicazione','').replace('/Digital','').replace('Marketing','Mktg')
  return (
    <span className={`badge border text-[10px] ${roleColor(role)}`}>{short}</span>
  )
}

function StatoBadge({ stato }: { stato: string }) {
  return (
    <span className={`badge text-[10px] font-medium ${statoColor(stato)}`}>{stato}</span>
  )
}

// ─── CSV Import Modal ─────────────────────────────────────────────────────────

interface ImportRow {
  contact: Partial<Contact>
  action: 'new' | 'update' | 'skip'
  existingId?: string
  changes?: string[]
  approved: boolean
}

function CsvImportModal({
  onClose,
  onDone,
  existingContacts,
}: {
  onClose: () => void
  onDone: () => void
  existingContacts: Contact[]
}) {
  const [step, setStep] = useState<'upload' | 'review' | 'importing' | 'done'>('upload')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const text = ev.target?.result as string
        const { rows: csvRows } = parseCSV(text)
        if (!csvRows.length) { setError('File vuoto o formato non riconosciuto'); return }

        const importRows: ImportRow[] = csvRows.map(row => {
          const contact = mapCSVToContact(row)
          if (!contact.first_name && !contact.last_name) return null

          // Try to match existing by linkedin_url or email
          let existing = contact.linkedin_url
            ? existingContacts.find(c => c.linkedin_url === contact.linkedin_url)
            : undefined
          if (!existing && contact.email) {
            existing = existingContacts.find(c => c.email === contact.email)
          }

          if (existing) {
            const changes: string[] = []
            const fields: (keyof Contact)[] = ['email','email2','phone','phone2','stato_outreach','note','score','ruolo_categoria','titolo','azienda']
            for (const f of fields) {
              const newVal = String(contact[f] ?? '')
              const oldVal = String(existing[f] ?? '')
              if (newVal && newVal !== oldVal) changes.push(`${f}: "${oldVal}" → "${newVal}"`)
            }
            return { contact, action: changes.length > 0 ? 'update' : 'skip', existingId: existing.id, changes, approved: changes.length > 0 }
          }

          return { contact, action: 'new', changes: [], approved: true }
        }).filter(Boolean) as ImportRow[]

        setRows(importRows)
        setStep('review')
        setError('')
      } catch {
        setError('Errore nel parsing del file CSV')
      }
    }
    reader.readAsText(file, 'UTF-8')
  }

  function toggleApprove(idx: number) {
    setRows(r => r.map((row, i) => i === idx ? { ...row, approved: !row.approved } : row))
  }

  function approveAll() { setRows(r => r.map(row => ({ ...row, approved: row.action !== 'skip' }))) }
  function approveNone() { setRows(r => r.map(row => ({ ...row, approved: false }))) }

  async function runImport() {
    setImporting(true)
    setStep('importing')
    let count = 0
    const toProcess = rows.filter(r => r.approved)
    for (const row of toProcess) {
      if (row.action === 'new') {
        await supabase.from('contacts').insert({
          ...row.contact,
          stato_outreach: row.contact.stato_outreach || 'Da contattare',
        })
      } else if (row.action === 'update' && row.existingId) {
        await supabase.from('contacts').update({ ...row.contact, updated_at: new Date().toISOString() }).eq('id', row.existingId)
      }
      count++
      setImported(count)
    }
    setStep('done')
    setImporting(false)
    setTimeout(() => { onDone() }, 1200)
  }

  const toApprove = rows.filter(r => r.approved)
  const newCount = rows.filter(r => r.action === 'new').length
  const updateCount = rows.filter(r => r.action === 'update').length
  const skipCount = rows.filter(r => r.action === 'skip').length

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-content p-0 w-full max-w-3xl" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/20">
          <div>
            <h2 className="text-lg font-semibold text-[#1A1A1A]">Importa contatti da CSV</h2>
            {step === 'review' && (
              <p className="text-xs text-[#9490A0] mt-0.5">
                {newCount} nuovi · {updateCount} aggiornamenti · {skipCount} invariati
              </p>
            )}
          </div>
          <button onClick={onClose} className="btn btn-ghost p-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: 'calc(90vh - 140px)' }}>
          {/* Upload step */}
          {step === 'upload' && (
            <div className="p-8 flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-[#1D3557]/10 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-[#1D3557]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="font-semibold text-[#1A1A1A]">Carica il file CSV</p>
                <p className="text-sm text-[#9490A0] mt-1">
                  Compatibile con l'export del CRM e con <strong>GDO_Contatti_LinkedIn_Completo.xlsx</strong> (salvato come CSV)
                </p>
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
              <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
                Scegli file CSV
              </button>
              <div className="w-full max-w-md bg-[#1D3557]/5 rounded-xl p-4 text-xs text-[#5C5862]">
                <p className="font-semibold mb-2">Colonne riconosciute:</p>
                <p>Nome, Cognome, Azienda, Ruolo Categoria, Titolo, Score, Email, Email 2, Telefono 1, Telefono 2, LinkedIn URL, Città/Area, stato_outreach, Note</p>
              </div>
            </div>
          )}

          {/* Review step */}
          {step === 'review' && (
            <div>
              <div className="flex items-center gap-3 px-5 py-3 border-b border-white/20 bg-white/20">
                <button onClick={approveAll} className="btn btn-ghost text-xs py-1.5 px-3">Approva tutti</button>
                <button onClick={approveNone} className="btn btn-ghost text-xs py-1.5 px-3">Deseleziona tutti</button>
                <span className="ml-auto text-xs text-[#9490A0]">
                  {toApprove.length} selezionati su {rows.length}
                </span>
              </div>
              <div className="divide-y divide-white/20">
                {rows.map((row, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-3 px-5 py-3.5 transition-colors ${
                      row.approved ? 'bg-white/10' : 'opacity-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={row.approved}
                      onChange={() => toggleApprove(idx)}
                      disabled={row.action === 'skip'}
                      className="mt-1 accent-[#1D3557] w-4 h-4 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-[#1A1A1A]">
                          {[row.contact.first_name, row.contact.last_name].filter(Boolean).join(' ') || '—'}
                        </span>
                        {row.contact.azienda && (
                          <span className="text-xs text-[#9490A0]">· {row.contact.azienda}</span>
                        )}
                        <span className={`badge text-[10px] ${
                          row.action === 'new' ? 'bg-emerald-100 text-emerald-700' :
                          row.action === 'update' ? 'bg-amber-100 text-amber-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {row.action === 'new' ? '+ Nuovo' : row.action === 'update' ? '↻ Aggiorna' : '= Invariato'}
                        </span>
                      </div>
                      {row.contact.titolo && (
                        <p className="text-xs text-[#9490A0] mt-0.5">{row.contact.titolo}</p>
                      )}
                      {row.action === 'update' && row.changes && row.changes.length > 0 && (
                        <div className="mt-1.5 space-y-0.5">
                          {row.changes.map((c, i) => (
                            <p key={i} className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-0.5 font-mono">{c}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Importing step */}
          {step === 'importing' && (
            <div className="p-12 flex flex-col items-center gap-4">
              <div className="w-12 h-12 rounded-full border-4 border-[#1D3557] border-t-transparent animate-spin" />
              <p className="font-medium text-[#1A1A1A]">Importazione in corso…</p>
              <p className="text-sm text-[#9490A0]">{imported} di {toApprove.length} contatti</p>
            </div>
          )}

          {/* Done step */}
          {step === 'done' && (
            <div className="p-12 flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                </svg>
              </div>
              <p className="font-semibold text-[#1A1A1A]">Importazione completata</p>
              <p className="text-sm text-[#9490A0]">{imported} contatti elaborati</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div className="flex gap-3 p-5 border-t border-white/20">
            <button onClick={onClose} className="btn btn-ghost flex-1">Annulla</button>
            <button
              onClick={runImport}
              disabled={toApprove.length === 0}
              className="btn btn-primary flex-1 disabled:opacity-40"
            >
              Importa {toApprove.length} contatti
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Contact Form Modal ───────────────────────────────────────────────────────

const emptyContactForm = {
  first_name: '', last_name: '', azienda: '', ruolo_categoria: '', titolo: '',
  score: 2 as number, email: '', email2: '', phone: '', phone2: '',
  linkedin_url: '', location: '', stato_outreach: 'Da contattare', note: '',
}

function ContactFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Partial<Contact>
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({ ...emptyContactForm, ...initial })
  const [saving, setSaving] = useState(false)
  const isEdit = !!initial?.id

  function set(k: string, v: string | number) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    if (!form.first_name.trim()) return
    setSaving(true)
    if (isEdit) {
      await supabase.from('contacts').update({ ...form, updated_at: new Date().toISOString() }).eq('id', initial!.id!)
    } else {
      await supabase.from('contacts').insert({ ...form })
    }
    setSaving(false)
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-content p-0">
        <div className="flex items-center justify-between p-5 border-b border-white/20">
          <h2 className="text-lg font-semibold">{isEdit ? 'Modifica contatto' : 'Nuovo contatto'}</h2>
          <button onClick={onClose} className="btn btn-ghost p-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex flex-col gap-3" style={{ maxHeight: 'calc(90vh - 140px)' }}>
          <div className="flex gap-3">
            <input className="input flex-1" placeholder="Nome *" value={form.first_name} onChange={e => set('first_name', e.target.value)} autoFocus />
            <input className="input flex-1" placeholder="Cognome" value={form.last_name} onChange={e => set('last_name', e.target.value)} />
          </div>
          <input className="input" placeholder="Azienda" value={form.azienda} onChange={e => set('azienda', e.target.value)} />
          <select className="input" value={form.ruolo_categoria} onChange={e => set('ruolo_categoria', e.target.value)}>
            <option value="">Ruolo categoria…</option>
            {RUOLI_CATEGORIA.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <input className="input" placeholder="Titolo (es. Marketing Director)" value={form.titolo} onChange={e => set('titolo', e.target.value)} />
          <div className="flex gap-3 items-center">
            <label className="text-sm text-[#5C5862] whitespace-nowrap">Priorità:</label>
            {[1,2,3].map(s => (
              <button key={s} type="button" onClick={() => set('score', s)}
                className={`px-3 py-1.5 rounded-full text-xs border font-semibold transition-colors ${form.score === s ? scoreColor(s) + ' border-current' : 'bg-white/50 text-[#9490A0] border-white/30'}`}>
                {'★'.repeat(s)} {SCORE_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <input className="input flex-1" placeholder="Email" value={form.email} onChange={e => set('email', e.target.value)} />
            <input className="input flex-1" placeholder="Email 2" value={form.email2} onChange={e => set('email2', e.target.value)} />
          </div>
          <div className="flex gap-3">
            <input className="input flex-1" placeholder="Telefono" value={form.phone} onChange={e => set('phone', e.target.value)} />
            <input className="input flex-1" placeholder="Telefono 2" value={form.phone2} onChange={e => set('phone2', e.target.value)} />
          </div>
          <input className="input" placeholder="LinkedIn URL" value={form.linkedin_url} onChange={e => set('linkedin_url', e.target.value)} />
          <input className="input" placeholder="Città / Area" value={form.location} onChange={e => set('location', e.target.value)} />
          <select className="input" value={form.stato_outreach} onChange={e => set('stato_outreach', e.target.value)}>
            {STATI_OUTREACH.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <textarea className="input resize-none" rows={3} placeholder="Note…" value={form.note} onChange={e => set('note', e.target.value)} />
        </div>
        <div className="flex gap-3 p-5 border-t border-white/20">
          <button onClick={onClose} className="btn btn-ghost flex-1">Annulla</button>
          <button onClick={save} disabled={saving || !form.first_name.trim()} className="btn btn-primary flex-1 disabled:opacity-40">
            {saving ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Crea contatto'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard View ───────────────────────────────────────────────────────────

function DashboardView({ contacts }: { contacts: Contact[] }) {
  const total = contacts.length
  const byScore = [3, 2, 1].map(s => ({ label: `Score ${s}`, value: contacts.filter(c => c.score === s).length, color: ['#1D3557', '#f59e0b', '#d1d5db'][3 - s] }))
  const byStato = STATI_OUTREACH.map(s => ({ label: s, value: contacts.filter(c => c.stato_outreach === s).length }))
  const clienti = contacts.filter(c => c.stato_outreach === 'Cliente').length
  const withEmail = contacts.filter(c => c.email).length
  const alta = contacts.filter(c => c.score === 3).length

  const byRuolo = RUOLI_CATEGORIA.map(r => ({
    label: r.replace('/Comunicazione','').replace('/Digital',''),
    value: contacts.filter(c => c.ruolo_categoria === r).length,
  })).filter(r => r.value > 0)

  const topAziende = Object.entries(
    contacts.reduce((acc, c) => { if (c.azienda) acc[c.azienda] = (acc[c.azienda] || 0) + 1; return acc }, {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1]).slice(0, 8)

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Dashboard</h1>
        <p className="text-sm text-[#9490A0] mt-1">Panoramica del database GDO Atinedis</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Contatti totali', value: total, color: '#1D3557', icon: '👤' },
          { label: 'Alta priorità', value: alta, color: '#1D3557', icon: '★' },
          { label: 'Con email', value: withEmail, color: '#2A9D8F', icon: '✉' },
          { label: 'Clienti acquisiti', value: clienti, color: '#2A9D8F', icon: '✓' },
        ].map(kpi => (
          <div key={kpi.label} className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{kpi.icon}</span>
              <span className="text-xs text-[#9490A0] font-medium">{kpi.label}</span>
            </div>
            <p className="text-3xl font-bold" style={{ color: kpi.color }}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        {/* Pipeline funnel */}
        <div className="card p-5 lg:col-span-2">
          <h3 className="font-semibold text-sm text-[#1A1A1A] mb-4">Pipeline outreach</h3>
          <div className="space-y-2">
            {byStato.filter(s => s.value > 0 || s.label === 'Da contattare').map(s => (
              <div key={s.label} className="flex items-center gap-3">
                <span className="text-xs text-[#5C5862] w-36 flex-shrink-0">{s.label}</span>
                <div className="flex-1 bg-white/30 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{ width: total ? `${(s.value / total) * 100}%` : '0%', background: statoColor(s.label).includes('emerald') ? '#2A9D8F' : statoColor(s.label).includes('blue') ? '#3b82f6' : statoColor(s.label).includes('amber') ? '#f59e0b' : statoColor(s.label).includes('red') ? '#ef4444' : '#9490A0' }}
                  />
                </div>
                <span className="text-xs font-semibold text-[#1A1A1A] w-6 text-right">{s.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* By score */}
        <div className="card p-5">
          <h3 className="font-semibold text-sm text-[#1A1A1A] mb-4">Per priorità</h3>
          <div className="space-y-3">
            {byScore.map(s => (
              <div key={s.label} className="flex items-center gap-3">
                <span className="text-xs text-[#5C5862] w-16">{s.label}</span>
                <div className="flex-1 bg-white/30 rounded-full h-2">
                  <div className="h-2 rounded-full" style={{ width: total ? `${(s.value / total) * 100}%` : '0%', background: s.color }} />
                </div>
                <span className="text-xs font-bold w-6 text-right" style={{ color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-white/20">
            <h4 className="text-xs font-semibold text-[#5C5862] mb-3">Per ruolo</h4>
            <div className="space-y-1.5">
              {byRuolo.map(r => (
                <div key={r.label} className="flex justify-between text-xs">
                  <span className="text-[#5C5862]">{r.label}</span>
                  <span className="font-semibold text-[#1A1A1A]">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Top aziende */}
      <div className="card p-5">
        <h3 className="font-semibold text-sm text-[#1A1A1A] mb-4">Top aziende per contatti</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {topAziende.map(([az, count]) => (
            <div key={az} className="bg-white/30 rounded-xl p-3">
              <p className="text-xs font-semibold text-[#1A1A1A] truncate">{az}</p>
              <p className="text-2xl font-bold text-[#1D3557] mt-1">{count}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Contacts View ────────────────────────────────────────────────────────────

function ContactsView({
  contacts,
  onRefresh,
  router,
}: {
  contacts: Contact[]
  onRefresh: () => void
  router: any
}) {
  const [search, setSearch] = useState('')
  const [filterScore, setFilterScore] = useState<number | null>(null)
  const [filterRuolo, setFilterRuolo] = useState('')
  const [filterStato, setFilterStato] = useState('')
  const [filterAzienda, setFilterAzienda] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [showNewContact, setShowNewContact] = useState(false)
  const [sortCol, setSortCol] = useState<keyof Contact>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const aziende = [...new Set(contacts.map(c => c.azienda).filter(Boolean))].sort()

  const filtered = contacts.filter(c => {
    if (filterScore !== null && c.score !== filterScore) return false
    if (filterRuolo && c.ruolo_categoria !== filterRuolo) return false
    if (filterStato && c.stato_outreach !== filterStato) return false
    if (filterAzienda && c.azienda !== filterAzienda) return false
    if (search) {
      const q = search.toLowerCase()
      return fullName(c).toLowerCase().includes(q) ||
        c.azienda?.toLowerCase().includes(q) ||
        c.titolo?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)
    }
    return true
  }).sort((a, b) => {
    const va = (a as any)[sortCol] ?? ''
    const vb = (b as any)[sortCol] ?? ''
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  function toggleSort(col: keyof Contact) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  function downloadCSV() {
    const csv = toCSV(filtered)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `GDO_Contatti_${new Date().toISOString().split('T')[0]}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const SortIcon = ({ col }: { col: keyof Contact }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 ml-1 inline-block transition-opacity ${sortCol === col ? 'opacity-100' : 'opacity-30'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      {sortDir === 'desc' || sortCol !== col
        ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
        : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7"/>}
    </svg>
  )

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[#1A1A1A]">Contatti</h1>
          <p className="text-sm text-[#9490A0]">{filtered.length} di {contacts.length} contatti</p>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadCSV} className="btn btn-ghost text-xs gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            Export CSV
          </button>
          <button onClick={() => setShowImport(true)} className="btn btn-ghost text-xs gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12"/></svg>
            Import CSV
          </button>
          <button onClick={() => setShowNewContact(true)} className="btn btn-primary text-xs">
            + Nuovo
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="input max-w-xs text-sm"
          placeholder="🔍 Cerca nome, azienda, email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input w-auto text-sm" value={filterScore ?? ''} onChange={e => setFilterScore(e.target.value ? +e.target.value : null)}>
          <option value="">Tutte le priorità</option>
          {[3,2,1].map(s => <option key={s} value={s}>{'★'.repeat(s)} {SCORE_LABELS[s]}</option>)}
        </select>
        <select className="input w-auto text-sm" value={filterRuolo} onChange={e => setFilterRuolo(e.target.value)}>
          <option value="">Tutti i ruoli</option>
          {RUOLI_CATEGORIA.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="input w-auto text-sm" value={filterStato} onChange={e => setFilterStato(e.target.value)}>
          <option value="">Tutti gli stati</option>
          {STATI_OUTREACH.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input w-auto text-sm" value={filterAzienda} onChange={e => setFilterAzienda(e.target.value)}>
          <option value="">Tutte le aziende</option>
          {aziende.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        {(filterScore !== null || filterRuolo || filterStato || filterAzienda || search) && (
          <button className="btn btn-ghost text-xs" onClick={() => { setSearch(''); setFilterScore(null); setFilterRuolo(''); setFilterStato(''); setFilterAzienda('') }}>
            Azzera filtri
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/20 bg-white/20">
                <th className="text-left px-4 py-3 font-semibold text-xs text-[#5C5862] cursor-pointer select-none" onClick={() => toggleSort('last_name')}>
                  Nome <SortIcon col="last_name" />
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs text-[#5C5862] cursor-pointer select-none hidden sm:table-cell" onClick={() => toggleSort('azienda')}>
                  Azienda <SortIcon col="azienda" />
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs text-[#5C5862] hidden md:table-cell">
                  Ruolo
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs text-[#5C5862] cursor-pointer select-none" onClick={() => toggleSort('score')}>
                  Score <SortIcon col="score" />
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs text-[#5C5862] hidden lg:table-cell">
                  Contatti
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs text-[#5C5862] cursor-pointer select-none hidden sm:table-cell" onClick={() => toggleSort('stato_outreach')}>
                  Stato <SortIcon col="stato_outreach" />
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-[#9490A0]">Nessun contatto trovato</td></tr>
              ) : (
                filtered.map((c, i) => (
                  <tr
                    key={c.id}
                    className={`table-row cursor-pointer ${i % 2 === 0 ? '' : 'bg-white/10'}`}
                    onClick={() => router.push(`/contact/${c.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#1D3557]/10 text-[#1D3557] flex items-center justify-center font-bold text-xs flex-shrink-0">
                          {initials(c)}
                        </div>
                        <div>
                          <p className="font-medium text-[#1A1A1A]">{fullName(c)}</p>
                          <p className="text-xs text-[#9490A0] truncate max-w-[180px]">{c.titolo}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-[#5C5862] font-medium">{c.azienda || '—'}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <RoleBadge role={c.ruolo_categoria} />
                    </td>
                    <td className="px-4 py-3">
                      <ScoreBadge score={c.score} />
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex flex-col gap-0.5">
                        {c.email && <span className="text-xs text-[#5C5862] truncate max-w-[180px]">{c.email}</span>}
                        {c.phone && <span className="text-xs text-[#9490A0]">{c.phone}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <StatoBadge stato={c.stato_outreach || 'Da contattare'} />
                    </td>
                    <td className="px-4 py-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showImport && (
        <CsvImportModal
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); onRefresh() }}
          existingContacts={contacts}
        />
      )}
      {showNewContact && (
        <ContactFormModal
          onClose={() => setShowNewContact(false)}
          onSaved={() => { setShowNewContact(false); onRefresh() }}
        />
      )}
    </div>
  )
}

// ─── Pipeline View (Kanban by stato_outreach) ─────────────────────────────────

function PipelineView({
  contacts,
  onRefresh,
}: {
  contacts: Contact[]
  onRefresh: () => void
}) {
  const [filterScore, setFilterScore] = useState<number | null>(null)
  const [filterRuolo, setFilterRuolo] = useState('')
  const [local, setLocal] = useState<Contact[]>(contacts)
  const router = useRouter()

  useEffect(() => { setLocal(contacts) }, [contacts])

  const filtered = local.filter(c => {
    if (filterScore !== null && c.score !== filterScore) return false
    if (filterRuolo && c.ruolo_categoria !== filterRuolo) return false
    return true
  })

  async function onDragEnd(result: DropResult) {
    if (!result.destination) return
    const { draggableId, destination } = result
    const newStato = destination.droppableId

    setLocal(prev => prev.map(c => c.id === draggableId ? { ...c, stato_outreach: newStato } : c))
    await supabase.from('contacts').update({ stato_outreach: newStato, updated_at: new Date().toISOString() }).eq('id', draggableId)
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">Pipeline</h1>
          <p className="text-sm text-[#9490A0]">Trascina i contatti tra le fasi</p>
        </div>
        <div className="flex gap-2 ml-auto flex-wrap">
          <select className="input w-auto text-sm" value={filterScore ?? ''} onChange={e => setFilterScore(e.target.value ? +e.target.value : null)}>
            <option value="">Tutte le priorità</option>
            {[3,2,1].map(s => <option key={s} value={s}>{'★'.repeat(s)} {SCORE_LABELS[s]}</option>)}
          </select>
          <select className="input w-auto text-sm" value={filterRuolo} onChange={e => setFilterRuolo(e.target.value)}>
            <option value="">Tutti i ruoli</option>
            {RUOLI_CATEGORIA.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 200px)' }}>
          {STATI_OUTREACH.map(stato => {
            const colContacts = filtered.filter(c => (c.stato_outreach || 'Da contattare') === stato)
            return (
              <div key={stato} className="kanban-col flex flex-col gap-2">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className={`badge text-[10px] ${statoColor(stato)}`}>{stato}</span>
                    <span className="text-xs text-[#9490A0] font-semibold">{colContacts.length}</span>
                  </div>
                </div>
                <Droppable droppableId={stato}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 rounded-2xl p-2 min-h-[200px] transition-colors ${snapshot.isDraggingOver ? 'bg-[#1D3557]/5' : 'bg-white/20'}`}
                    >
                      {colContacts.map((c, idx) => (
                        <Draggable key={c.id} draggableId={c.id} index={idx}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`kanban-card mb-2 ${snapshot.isDragging ? 'shadow-lg rotate-1' : ''}`}
                              onClick={() => router.push(`/contact/${c.id}`)}
                            >
                              <div className="flex items-start justify-between gap-2 mb-1.5">
                                <p className="font-semibold text-sm text-[#1A1A1A] leading-tight">{fullName(c)}</p>
                                <ScoreBadge score={c.score} />
                              </div>
                              {c.azienda && <p className="text-xs text-[#5C5862] font-medium">{c.azienda}</p>}
                              {c.titolo && <p className="text-xs text-[#9490A0] truncate mt-0.5">{c.titolo}</p>}
                              <div className="flex gap-1.5 mt-2 flex-wrap">
                                <RoleBadge role={c.ruolo_categoria} />
                                {c.email && (
                                  <span className="badge text-[10px] bg-[#2A9D8F]/10 text-[#2A9D8F] border-[#2A9D8F]/20 border">✉</span>
                                )}
                                {c.linkedin_url && (
                                  <span className="badge text-[10px] bg-blue-50 text-blue-600 border-blue-200 border">in</span>
                                )}
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            )
          })}
        </div>
      </DragDropContext>
    </div>
  )
}

// ─── Companies View ───────────────────────────────────────────────────────────

function CompaniesView({ contacts, router }: { contacts: Contact[]; router: any }) {
  const [search, setSearch] = useState('')
  const [filterStato, setFilterStato] = useState('')

  const companies = Object.entries(
    contacts.reduce((acc, c) => {
      if (!c.azienda) return acc
      if (!acc[c.azienda]) acc[c.azienda] = []
      acc[c.azienda].push(c)
      return acc
    }, {} as Record<string, Contact[]>)
  )
    .filter(([name]) => !search || name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const scoreA = Math.max(...a[1].map(c => c.score))
      const scoreB = Math.max(...b[1].map(c => c.score))
      return scoreB - scoreA || a[0].localeCompare(b[0])
    })

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Aziende</h1>
        <p className="text-sm text-[#9490A0]">{companies.length} insegne GDO</p>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          className="input max-w-xs text-sm"
          placeholder="🔍 Cerca azienda…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input w-auto text-sm" value={filterStato} onChange={e => setFilterStato(e.target.value)}>
          <option value="">Tutti gli stati</option>
          {STATI_OUTREACH.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid gap-3">
        {companies.map(([name, ctcs]) => {
          const displayed = filterStato ? ctcs.filter(c => c.stato_outreach === filterStato) : ctcs
          if (displayed.length === 0) return null

          const maxScore = Math.max(...ctcs.map(c => c.score))
          const withEmail = ctcs.filter(c => c.email).length
          const clienti = ctcs.filter(c => c.stato_outreach === 'Cliente').length
          const stati = [...new Set(ctcs.map(c => c.stato_outreach || 'Da contattare'))]

          return (
            <div key={name} className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#1D3557]/10 flex items-center justify-center font-bold text-[#1D3557] text-sm flex-shrink-0">
                    {name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-semibold text-[#1A1A1A]">{name}</p>
                    <div className="flex gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-[#9490A0]">{ctcs.length} contatti</span>
                      {withEmail > 0 && <span className="text-xs text-[#2A9D8F]">✉ {withEmail} email</span>}
                      {clienti > 0 && <span className="text-xs text-emerald-600 font-semibold">✓ Cliente</span>}
                    </div>
                  </div>
                </div>
                <ScoreBadge score={maxScore} />
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {stati.map(s => <StatoBadge key={s} stato={s} />)}
              </div>

              <div className="divide-y divide-white/20">
                {displayed.map(c => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-white/20 -mx-4 px-4 rounded-xl transition-colors"
                    onClick={() => router.push(`/contact/${c.id}`)}
                  >
                    <div className="w-7 h-7 rounded-full bg-[#1D3557]/10 text-[#1D3557] flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {initials(c)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1A1A1A]">{fullName(c)}</p>
                      <p className="text-xs text-[#9490A0] truncate">{c.titolo}</p>
                    </div>
                    <RoleBadge role={c.ruolo_categoria} />
                    <StatoBadge stato={c.stato_outreach || 'Da contattare'} />
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="text-[#2A9D8F] hover:underline text-xs hidden sm:block" onClick={e => e.stopPropagation()}>{c.email}</a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main CrmContent ──────────────────────────────────────────────────────────

export default function CrmContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as View | null
  const [view, setView] = useState<View>(tabParam || 'dashboard')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [checked, setChecked] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [confirmLogout, setConfirmLogout] = useState(false)

  useEffect(() => {
    const t = searchParams.get('tab') as View | null
    setView(t || 'dashboard')
  }, [searchParams])

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { window.location.replace('/login'); return }
      setUserEmail(session.user.email || '')
      setChecked(true)
      fetchContacts()
    }
    init()
  }, [])

  async function fetchContacts() {
    setLoading(true)
    const { data } = await supabase.from('contacts').select('*').order('score', { ascending: false })
    setContacts(data || [])
    setLoading(false)
  }

  function navigateTo(v: View) {
    setMobileMenuOpen(false)
    router.push(v === 'dashboard' ? '/' : `/?tab=${v}`)
  }

  async function logout() {
    await supabase.auth.signOut()
    window.location.replace('/login')
  }

  if (!checked) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-10 h-10 rounded-full border-4 border-[#1D3557] border-t-transparent animate-spin" />
    </div>
  )

  const navItems: { view: View; label: string; icon: React.ReactNode }[] = [
    {
      view: 'dashboard', label: 'Dashboard',
      icon: <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>,
    },
    {
      view: 'contacts', label: 'Contatti',
      icon: <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>,
    },
    {
      view: 'pipeline', label: 'Pipeline',
      icon: <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/></svg>,
    },
    {
      view: 'companies', label: 'Aziende',
      icon: <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>,
    },
  ]

  return (
    <div className="flex min-h-screen">
      {/* Sidebar overlay (mobile) */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-30 md:hidden" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="flex items-center gap-2 px-2 mb-6">
          <img src="/logo.png" alt="Atinedis" className="w-7 h-7 rounded-lg object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <div>
            <p className="font-bold text-[#1A1A1A] text-sm leading-tight">Atinedis</p>
            <p className="text-[10px] text-[#9490A0]">GDO CRM</p>
          </div>
        </div>

        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map(item => (
            <button
              key={item.view}
              className={`sidebar-link ${view === item.view ? 'active' : ''}`}
              onClick={() => navigateTo(item.view)}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.view === 'contacts' && !loading && (
                <span className="ml-auto text-xs opacity-60">{contacts.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="mt-auto pt-4 border-t border-white/20">
          <p className="text-xs text-[#9490A0] px-3 mb-2 truncate">{userEmail}</p>
          <button className="sidebar-link w-full text-left" onClick={() => setConfirmLogout(true)}>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content flex-1 min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-white/20 bg-white/30 backdrop-blur sticky top-0 z-20">
          <button className="btn btn-ghost p-2" onClick={() => setMobileMenuOpen(true)}>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <span className="font-semibold text-[#1A1A1A]">
            {navItems.find(n => n.view === view)?.label || 'Atinedis CRM'}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 rounded-full border-4 border-[#1D3557] border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            {view === 'dashboard' && <DashboardView contacts={contacts} />}
            {view === 'contacts' && <ContactsView contacts={contacts} onRefresh={fetchContacts} router={router} />}
            {view === 'pipeline' && <PipelineView contacts={contacts} onRefresh={fetchContacts} />}
            {view === 'companies' && <CompaniesView contacts={contacts} router={router} />}
          </>
        )}
      </main>

      {/* Mobile bottom nav */}
      <nav className="bottom-nav">
        {navItems.map(item => (
          <button
            key={item.view}
            className={`bottom-nav-item ${view === item.view ? 'active' : ''}`}
            onClick={() => navigateTo(item.view)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Logout confirm */}
      {confirmLogout && (
        <div className="modal-overlay" onClick={() => setConfirmLogout(false)}>
          <div className="modal-content p-6 max-w-sm text-center" onClick={e => e.stopPropagation()}>
            <p className="font-semibold text-lg mb-2">Esci dal CRM?</p>
            <p className="text-sm text-[#9490A0] mb-5">Verrai reindirizzato alla pagina di login.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmLogout(false)} className="btn btn-ghost flex-1">Annulla</button>
              <button onClick={logout} className="btn btn-primary flex-1">Esci</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
