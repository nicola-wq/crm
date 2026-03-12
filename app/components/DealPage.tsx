'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const STAGES = ['Qualificato', 'Appuntamento fissato', 'Ingresso', 'Preventivo', 'Vendita', 'Non convertito']
const ENVIRONMENTS = ['Cucina', 'Soggiorno', 'Camera da letto', 'Cameretta', 'Tavoli e sedie', 'Altro']
const PROB_OPTIONS = [0, 25, 50, 75, 90, 100]
const TIMELINES = ['Entro 3 mesi', 'Tra 3 mesi e 6 mesi', 'Oltre 6 mesi']
const PROB_COLORS: Record<number, string> = {
  0: 'bg-gray-100 text-gray-500', 25: 'bg-red-100 text-red-700',
  50: 'bg-orange-100 text-orange-700', 75: 'bg-yellow-100 text-yellow-700',
  90: 'bg-blue-100 text-blue-700', 100: 'bg-green-100 text-green-700'
}

interface Deal {
  id: string; title: string; contact_name: string; phone: string; email: string
  origin: string; environment: string; entry_date: string; appointment_date: string
  estimate: number; project_timeline: string; stage: string; created_at: string; sale_date?: string
  probability: number | null; is_lead: boolean; lead_stage: string; lead_viewed_at?: string
}
interface Note { id: string; deal_id: string; text: string; created_at: string; created_by: string }
interface Task { id: string; deal_id: string; title: string; done: boolean; auto: boolean; due_date: string; created_at: string; created_by: string }
interface Attachment { id: string; deal_id: string; file_name: string; file_url: string; file_type: string; created_at: string; created_by: string }
interface ActivityLog { id: string; deal_id: string; type: string; from_value: string; to_value: string; note: string; created_at: string; created_by: string }

type TimelineItem =
  | { type: 'note'; data: Note }
  | { type: 'task'; data: Task }
  | { type: 'attachment'; data: Attachment }
  | { type: 'stage_change'; data: ActivityLog }

function formatDate(dateStr: string) {
  if (!dateStr) return '-'
  const parts = dateStr.split('-')
  if (parts.length === 3) return `${parseInt(parts[2])}/${parseInt(parts[1])}/${parts[0]}`
  return '-'
}
function formatDateTime(dateStr: string) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
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

export default function DealPage({ dealId }: { dealId: string }) {
  const router = useRouter()
  const [deal, setDeal] = useState<Deal | null>(null)
  const [editDeal, setEditDeal] = useState<Deal | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [activityLog, setActivityLog] = useState<ActivityLog[]>([])
  const [newNote, setNewNote] = useState('')
  const [newTask, setNewTask] = useState('')
  const [newTaskDue, setNewTaskDue] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [confirmDeleteNote, setConfirmDeleteNote] = useState<string | null>(null)
  const [confirmDeleteTask, setConfirmDeleteTask] = useState<string | null>(null)
  const [confirmDeleteAttachment, setConfirmDeleteAttachment] = useState<string | null>(null)
  const [confirmDeleteDeal, setConfirmDeleteDeal] = useState(false)
  const [activeTab, setActiveTab] = useState<'tutti' | 'note' | 'task' | 'allegati'>('tutti')
  const [userEmail, setUserEmail] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTaskTitle, setEditingTaskTitle] = useState('')
  const [editingTaskDue, setEditingTaskDue] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { window.location.replace('/login'); return }
      setUserEmail(session.user.email || '')
      fetchAll()
    }
    init()
  }, [dealId])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (confirmDeleteDeal) { setConfirmDeleteDeal(false); return }
      if (confirmDeleteNote) { setConfirmDeleteNote(null); return }
      if (confirmDeleteTask) { setConfirmDeleteTask(null); return }
      if (confirmDeleteAttachment) { setConfirmDeleteAttachment(null); return }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [confirmDeleteDeal, confirmDeleteNote, confirmDeleteTask, confirmDeleteAttachment])

  async function fetchAll() {
    const [{ data: d }, { data: n }, { data: t }, { data: a }, { data: al }] = await Promise.all([
      supabase.from('deals').select('*').eq('id', dealId).single(),
      supabase.from('notes').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }),
      supabase.from('attachments').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }),
      supabase.from('activity_log').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }),
    ])
    if (d) { setDeal(d); setEditDeal({ ...d }) }
    setNotes(n || [])
    setTasks(t || [])
    setAttachments(a || [])
    setActivityLog(al || [])
  }

  async function saveDeal() {
    if (!editDeal) return
    setSaving(true); setSaveError('')
    const oldStage = deal?.stage
    const prob = editDeal.stage === 'Vendita' ? (editDeal.probability ?? 100) : editDeal.probability
    const { error } = await supabase.from('deals').update({
      contact_name: editDeal.contact_name, title: editDeal.contact_name,
      phone: editDeal.phone, email: editDeal.email, origin: editDeal.origin,
      environment: editDeal.environment, entry_date: editDeal.entry_date || null,
      appointment_date: editDeal.appointment_date || null, estimate: editDeal.estimate || 0,
      project_timeline: editDeal.project_timeline, stage: editDeal.stage, probability: prob,
    }).eq('id', dealId)
    setSaving(false)
    if (error) { setSaveError(error.message); return }
    if (oldStage && oldStage !== editDeal.stage) {
      await supabase.from('activity_log').insert({
        deal_id: dealId, type: 'stage_change',
        from_value: oldStage, to_value: editDeal.stage, created_by: userEmail,
      })
    }
    setEditMode(false); fetchAll()
  }

  async function addNote() {
    if (!newNote.trim()) return
    await supabase.from('notes').insert({ deal_id: dealId, text: newNote.trim(), created_by: userEmail })
    setNewNote(''); fetchAll()
  }

  async function deleteNote(id: string) {
    await supabase.from('notes').delete().eq('id', id)
    setConfirmDeleteNote(null); fetchAll()
  }

  async function saveNoteEdit(id: string) {
    if (!editingNoteText.trim()) return
    await supabase.from('notes').update({ text: editingNoteText.trim(), created_by: userEmail }).eq('id', id)
    setEditingNoteId(null); setEditingNoteText(''); fetchAll()
  }

  async function addTask() {
    if (!newTask.trim()) return
    await supabase.from('tasks').insert({ deal_id: dealId, title: newTask.trim(), auto: false, due_date: newTaskDue || null })
    setNewTask(''); setNewTaskDue(''); fetchAll()
  }

  async function toggleTask(id: string, done: boolean) {
    await supabase.from('tasks').update({ done: !done }).eq('id', id)
    fetchAll()
  }

  async function deleteTask(id: string) {
    await supabase.from('tasks').delete().eq('id', id)
    setConfirmDeleteTask(null); fetchAll()
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const path = `${dealId}/${Date.now()}_${file.name}`
      const { data, error } = await supabase.storage.from('attachments').upload(path, file, { upsert: true })
      if (!error && data) {
        const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path)
        await supabase.from('attachments').insert({
          deal_id: dealId, file_name: file.name,
          file_url: urlData.publicUrl, file_type: file.type, created_by: userEmail,
        })
      }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    fetchAll()
  }

  async function deleteDeal() {
    await supabase.from('deals').delete().eq('id', dealId)
    router.push('/') 
  }

  async function deleteAttachment(att: Attachment) {
    const path = att.file_url.split('/attachments/')[1]
    if (path) await supabase.storage.from('attachments').remove([path])
    await supabase.from('attachments').delete().eq('id', att.id)
    setConfirmDeleteAttachment(null); fetchAll()
  }

  if (!deal) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <p className="text-gray-500">Caricamento...</p>
    </div>
  )

  const stageChanges = activityLog.filter(a => a.type === 'stage_change')

  const timeline: TimelineItem[] = [
    ...notes.map(n => ({ type: 'note' as const, data: n })),
    ...tasks.map(t => ({ type: 'task' as const, data: t })),
    ...attachments.map(a => ({ type: 'attachment' as const, data: a })),
    ...stageChanges.map(a => ({ type: 'stage_change' as const, data: a })),
  ].sort((a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime())

  const filteredTimeline = activeTab === 'tutti' ? timeline
    : activeTab === 'note' ? timeline.filter(i => i.type === 'note')
    : activeTab === 'task' ? timeline.filter(i => i.type === 'task')
    : timeline.filter(i => i.type === 'attachment')

  const isImage = (type: string) => type?.startsWith('image/')

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow px-3 sm:px-6 py-3 sm:py-4 flex items-center gap-3 sm:gap-4">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-800 flex items-center gap-1 text-sm">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Indietro
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800">{deal.contact_name || '—'}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs">{deal.stage}</span>
            {deal.probability != null && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PROB_COLORS[deal.probability] || 'bg-gray-100 text-gray-600'}`}>{deal.probability}%</span>
            )}
            {deal.estimate > 0 && <span className="text-green-600 text-sm font-semibold">€ {deal.estimate.toLocaleString()}</span>}
          </div>
        </div>
        <button onClick={() => router.push('/')} className="text-gray-400 hover:text-blue-600 transition-colors" title="Homepage">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
        </button>
      </div>

      <div className="max-w-5xl mx-auto p-3 sm:p-6 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        {/* LEFT */}
        <div className="col-span-1">
          <div className="bg-white rounded-xl shadow p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-gray-700">Informazioni</h2>
              {!editMode
                ? <button onClick={() => setEditMode(true)} className="text-xs text-blue-600 hover:underline">Modifica</button>
                : <div className="flex gap-2">
                    <button onClick={saveDeal} disabled={saving} className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">{saving ? '...' : 'Salva'}</button>
                    <button onClick={() => { setEditMode(false); setEditDeal({ ...deal }) }} className="text-xs text-gray-500 hover:underline">Annulla</button>
                  </div>
              }
            </div>
            {saveError && <p className="text-red-500 text-xs mb-2">{saveError}</p>}

            {!editMode ? (
              <div className="flex flex-col gap-2 text-sm">
                {deal.phone && <div><span className="text-gray-400 text-xs">Telefono</span><p className="text-gray-800">{deal.phone}</p></div>}
                {deal.email && <div><span className="text-gray-400 text-xs">Email</span><p className="text-gray-800">{deal.email}</p></div>}
                {deal.origin && <div><span className="text-gray-400 text-xs">Origine</span><p className="text-gray-800">{deal.origin}</p></div>}
                {deal.environment && <div><span className="text-gray-400 text-xs">Ambiente</span><p className="text-gray-800">{deal.environment}</p></div>}
                {deal.entry_date && <div><span className="text-gray-400 text-xs">Data ingresso</span><p className="text-gray-800">{formatDate(deal.entry_date)}</p></div>}
                {deal.appointment_date && <div><span className="text-gray-400 text-xs">Appuntamento</span><p className="text-gray-800">{formatDate(deal.appointment_date)}</p></div>}
                {deal.sale_date && <div><span className="text-gray-400 text-xs">Data vendita</span><p className="text-green-600 font-semibold">{formatDate(deal.sale_date)}</p></div>}
                {deal.estimate > 0 && <div><span className="text-gray-400 text-xs">Preventivo</span><p className="text-green-600 font-semibold">€ {deal.estimate.toLocaleString()}</p></div>}
                {deal.estimate > 0 && deal.probability != null && (
                  <div><span className="text-gray-400 text-xs">Valore ponderato</span><p className="text-blue-600 font-semibold">€ {Math.round(deal.estimate * deal.probability / 100).toLocaleString()}</p></div>
                )}
                {deal.project_timeline && <div><span className="text-gray-400 text-xs">Tempi progettuali</span><p className="text-gray-800">{deal.project_timeline}</p></div>}
                <div><span className="text-gray-400 text-xs">Inserito il</span><p className="text-gray-600">{formatDateTime(deal.created_at)}</p></div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 text-sm">
                <div><label className="text-xs text-gray-400">Contatto</label><input className="border rounded-lg p-2 w-full mt-1 text-sm" value={editDeal?.contact_name || ''} onChange={e => setEditDeal({ ...editDeal!, contact_name: e.target.value })} /></div>
                <div><label className="text-xs text-gray-400">Telefono</label><input className="border rounded-lg p-2 w-full mt-1 text-sm" value={editDeal?.phone || ''} onChange={e => setEditDeal({ ...editDeal!, phone: e.target.value })} /></div>
                <div><label className="text-xs text-gray-400">Email</label><input className="border rounded-lg p-2 w-full mt-1 text-sm" value={editDeal?.email || ''} onChange={e => setEditDeal({ ...editDeal!, email: e.target.value })} /></div>
                <div><label className="text-xs text-gray-400">Origine</label><input className="border rounded-lg p-2 w-full mt-1 text-sm" value={editDeal?.origin || ''} onChange={e => setEditDeal({ ...editDeal!, origin: e.target.value })} /></div>
                <div><label className="text-xs text-gray-400">Ambiente</label><EnvSelect value={editDeal?.environment || ''} onChange={v => setEditDeal({ ...editDeal!, environment: v })} /></div>
                <div><label className="text-xs text-gray-400">Data ingresso</label><input type="date" className="border rounded-lg p-2 w-full mt-1 text-sm" value={editDeal?.entry_date || ''} onChange={e => setEditDeal({ ...editDeal!, entry_date: e.target.value })} /></div>
                <div><label className="text-xs text-gray-400">Data appuntamento</label><input type="date" className="border rounded-lg p-2 w-full mt-1 text-sm" value={editDeal?.appointment_date || ''} onChange={e => setEditDeal({ ...editDeal!, appointment_date: e.target.value })} /></div>
                <div><label className="text-xs text-gray-400">Preventivo (€)</label><input type="number" className="border rounded-lg p-2 w-full mt-1 text-sm" value={editDeal?.estimate || ''} onChange={e => setEditDeal({ ...editDeal!, estimate: Number(e.target.value) })} /></div>
                <div><label className="text-xs text-gray-400">Tempi progettuali</label>
                  <select className="border rounded-lg p-2 w-full mt-1 text-sm" value={editDeal?.project_timeline || ''} onChange={e => setEditDeal({ ...editDeal!, project_timeline: e.target.value })}>
                    <option value="">—</option>
                    {TIMELINES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div><label className="text-xs text-gray-400">Fase</label>
                  <select className="border rounded-lg p-2 w-full mt-1 text-sm" value={editDeal?.stage} onChange={e => setEditDeal({ ...editDeal!, stage: e.target.value })}>
                    {STAGES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div><label className="text-xs text-gray-400">Probabilità</label>
                  <select className="border rounded-lg p-2 w-full mt-1 text-sm" value={editDeal?.probability ?? ''} onChange={e => setEditDeal({ ...editDeal!, probability: e.target.value !== '' ? Number(e.target.value) : null })}>
                    <option value="">—</option>
                    {PROB_OPTIONS.map(p => <option key={p} value={p}>{p}%</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>



          {/* Task */}
          <div className="bg-white rounded-xl shadow p-5 mt-4">
            <h2 className="font-bold text-gray-700 mb-3">Task</h2>
            <div className="flex flex-col gap-2 mb-4">
              {tasks.length === 0 && <p className="text-gray-400 text-sm">Nessun task</p>}
              {tasks.map(task => (
                <div key={task.id} className={`rounded-lg border ${task.done ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-200'}`}>
                  {editingTaskId === task.id ? (
                    <div className="flex flex-col gap-2 p-3">
                      <input
                        className="border rounded-lg p-2 text-sm w-full"
                        value={editingTaskTitle}
                        onChange={e => setEditingTaskTitle(e.target.value)}
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Escape') setEditingTaskId(null) }}
                      />
                      <input
                        type="date"
                        className="border rounded-lg p-2 text-sm w-full"
                        value={editingTaskDue}
                        onChange={e => setEditingTaskDue(e.target.value)}
                      />
                      <div className="flex gap-2 mt-1">
                        <button onClick={async () => {
                          await supabase.from('tasks').update({ title: editingTaskTitle.trim(), due_date: editingTaskDue || null }).eq('id', task.id)
                          setEditingTaskId(null)
                          fetchAll()
                        }} className="flex-1 bg-orange-500 text-white py-2 rounded-lg text-sm font-medium">Salva</button>
                        <button onClick={() => setEditingTaskId(null)} className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-lg text-sm">Annulla</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 p-2.5">
                      <input type="checkbox" checked={task.done} onChange={() => toggleTask(task.id, task.done)} className="mt-0.5 cursor-pointer flex-shrink-0" />
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setEditingTaskId(task.id); setEditingTaskTitle(task.title); setEditingTaskDue(task.due_date || '') }}>
                        <p className={`text-sm ${task.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>{task.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {task.due_date && <p className="text-xs text-orange-500">{formatDate(task.due_date)}</p>}
                          {task.auto && <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">automatico</span>}
                          {!task.done && <span className="text-xs text-gray-300">✎ modifica</span>}
                        </div>
                      </div>
                      <button onClick={() => setConfirmDeleteTask(task.id)} className="text-gray-300 hover:text-red-400 text-sm p-1 flex-shrink-0">✕</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <input className="border rounded-lg p-2 text-sm" placeholder="Nuovo task..." value={newTask} onChange={e => setNewTask(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addTask() }} />
              <div className="flex gap-2">
                <input type="date" className="border rounded-lg p-2 text-sm flex-1" value={newTaskDue} onChange={e => setNewTaskDue(e.target.value)} />
                <button onClick={addTask} className="bg-gray-800 text-white px-3 py-2 rounded-lg text-sm hover:bg-gray-900">Aggiungi</button>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — Cronologia */}
        <div className="col-span-1 sm:col-span-2">
          <div className="bg-white rounded-xl shadow p-5 mb-4">
            <h2 className="font-bold text-gray-700 mb-3">Aggiungi nota</h2>
            <textarea className="border rounded-lg p-3 w-full text-sm resize-none" rows={3}
              placeholder="Scrivi una nota..." value={newNote} onChange={e => setNewNote(e.target.value)} />
            <div className="flex items-center gap-3 mt-2">
              <button onClick={addNote} disabled={!newNote.trim()} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40">Salva nota</button>
              <div className="flex items-center gap-2">
                <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple className="hidden" onChange={uploadFile} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="flex items-center gap-1.5 border border-gray-300 text-gray-600 px-3 py-2 rounded-lg text-sm hover:bg-gray-50">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                  {uploading ? 'Caricamento...' : 'Allega file'}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-5">
            <div className="flex items-center gap-1 mb-5 border-b pb-3">
              <h2 className="font-bold text-gray-700 mr-3">Cronologia</h2>
              {(['tutti', 'note', 'task', 'allegati'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {tab === 'tutti' ? 'Tutti' : tab === 'note' ? `Note (${notes.length})` : tab === 'task' ? `Task (${tasks.length})` : `Allegati (${attachments.length})`}
                </button>
              ))}
            </div>

            {filteredTimeline.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-8">Nessun elemento</p>
            )}

            <div className="flex flex-col gap-0">
              {filteredTimeline.map((item, idx) => (
                <div key={item.data.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${
                      item.type === 'note' ? 'bg-yellow-100 text-yellow-600' :
                      item.type === 'task' ? 'bg-purple-100 text-purple-600' :
                      item.type === 'stage_change' ? 'bg-green-100 text-green-600' :
                      'bg-blue-100 text-blue-600'
                    }`}>
                      {item.type === 'note' && <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>}
                      {item.type === 'task' && <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>}
                      {item.type === 'attachment' && <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>}
                      {item.type === 'stage_change' && <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>}
                    </div>
                    {idx < filteredTimeline.length - 1 && <div className="w-0.5 bg-gray-200 flex-1 my-1" style={{minHeight:'24px'}} />}
                  </div>

                  <div className="flex-1 pb-4">
                    <p className="text-xs text-gray-400 mb-1">{formatDateTime(item.data.created_at)}</p>

                    {item.type === 'note' && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 relative group">
                        {editingNoteId === item.data.id ? (
                          <div className="flex flex-col gap-2">
                            <textarea className="border rounded-lg p-2 text-sm w-full resize-none bg-white" rows={3}
                              value={editingNoteText} onChange={e => setEditingNoteText(e.target.value)} autoFocus />
                            <div className="flex gap-2">
                              <button onClick={() => saveNoteEdit(item.data.id)} className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">Salva</button>
                              <button onClick={() => { setEditingNoteId(null); setEditingNoteText('') }} className="text-xs text-gray-500 hover:underline">Annulla</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm text-gray-800 whitespace-pre-wrap cursor-text" onClick={() => { setEditingNoteId(item.data.id); setEditingNoteText((item.data as Note).text) }}>{(item.data as Note).text}</p>
                            {(item.data as Note).created_by && <p className="text-xs text-gray-400 mt-1">{(item.data as Note).created_by}</p>}
                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                              <button onClick={() => { setEditingNoteId(item.data.id); setEditingNoteText((item.data as Note).text) }} className="text-gray-300 hover:text-blue-400 text-xs">✎</button>
                              <button onClick={() => setConfirmDeleteNote(item.data.id)} className="text-gray-300 hover:text-red-400 text-xs">✕</button>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {item.type === 'task' && (
                      <div className={`border rounded-lg p-3 relative group flex items-start gap-2 ${(item.data as Task).done ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200'}`}>
                        <input type="checkbox" checked={(item.data as Task).done} onChange={() => toggleTask(item.data.id, (item.data as Task).done)} className="mt-0.5 cursor-pointer" />
                        <div className="flex-1">
                          <p className={`text-sm ${(item.data as Task).done ? 'line-through text-gray-400' : 'text-gray-700'}`}>{(item.data as Task).title}</p>
                          <div className="flex gap-2 mt-1">
                            {(item.data as Task).due_date && <span className="text-xs text-orange-500">{formatDate((item.data as Task).due_date)}</span>}
                            {(item.data as Task).auto && <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">automatico</span>}
                          </div>
                        </div>
                        <button onClick={() => setConfirmDeleteTask(item.data.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs transition-opacity">✕</button>
                      </div>
                    )}

                    {item.type === 'attachment' && (
                      <div className="border border-gray-200 rounded-lg p-3 relative group flex items-center gap-3">
                        {isImage((item.data as Attachment).file_type) ? (
                          <img src={(item.data as Attachment).file_url} alt={(item.data as Attachment).file_name} className="w-12 h-12 object-cover rounded" />
                        ) : (
                          <div className="w-12 h-12 bg-red-50 rounded flex items-center justify-center">
                            <span className="text-xs font-bold text-red-500">PDF</span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-700 truncate">{(item.data as Attachment).file_name}</p>
                          <a href={(item.data as Attachment).file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">Apri file</a>
                          {(item.data as Attachment).created_by && <p className="text-xs text-gray-400">{(item.data as Attachment).created_by}</p>}
                        </div>
                        <button onClick={() => setConfirmDeleteAttachment(item.data.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs transition-opacity">✕</button>
                      </div>
                    )}

                    {item.type === 'stage_change' && (
                      <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-2">
                        <span className="text-xs text-gray-500">Fase cambiata:</span>
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{(item.data as ActivityLog).from_value}</span>
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">{(item.data as ActivityLog).to_value}</span>
                        {(item.data as ActivityLog).created_by && <span className="text-xs text-gray-400 ml-auto">{(item.data as ActivityLog).created_by}</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Elimina contatto + Segna NEW — in fondo */}
          <div className="flex flex-col gap-2 mt-4">
            <button onClick={() => setConfirmDeleteDeal(true)} className="w-full text-xs text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 rounded-lg py-2 transition-colors">
              Elimina contatto
            </button>
            {deal.is_lead && deal.lead_viewed_at && (
              <button onClick={async()=>{await supabase.from('deals').update({lead_viewed_at:null}).eq('id',deal.id);fetchAll()}} className="w-full text-xs text-purple-500 hover:text-purple-700 border border-purple-200 hover:border-purple-400 rounded-lg py-2 transition-colors">
                ↩ Segna come NEW
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmDeleteNote && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-bold mb-2">Elimina nota?</h3>
            <p className="text-gray-600 text-sm mb-4">L&apos;operazione è irreversibile.</p>
            <div className="flex gap-2">
              <button onClick={() => deleteNote(confirmDeleteNote)} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600">Elimina</button>
              <button onClick={() => setConfirmDeleteNote(null)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteTask && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-bold mb-2">Elimina task?</h3>
            <p className="text-gray-600 text-sm mb-4">L&apos;operazione è irreversibile.</p>
            <div className="flex gap-2">
              <button onClick={() => deleteTask(confirmDeleteTask)} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600">Elimina</button>
              <button onClick={() => setConfirmDeleteTask(null)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteDeal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-bold mb-2">Elimina contatto?</h3>
            <p className="text-gray-600 text-sm mb-4">L&apos;operazione è irreversibile. Verranno eliminate anche tutte le note, task e allegati.</p>
            <div className="flex gap-2">
              <button onClick={deleteDeal} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600">Elimina</button>
              <button onClick={() => setConfirmDeleteDeal(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteAttachment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-bold mb-2">Elimina allegato?</h3>
            <p className="text-gray-600 text-sm mb-4">L&apos;operazione è irreversibile.</p>
            <div className="flex gap-2">
              <button onClick={() => { const att = attachments.find(a => a.id === confirmDeleteAttachment); if (att) deleteAttachment(att) }} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600">Elimina</button>
              <button onClick={() => setConfirmDeleteAttachment(null)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg">Annulla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
