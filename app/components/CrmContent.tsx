'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface Contact {
  id: string
  name: string
  email: string
  phone: string
  company: string
  notes: string
  created_at: string
}

export default function CrmContent() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [checked, setChecked] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', notes: '' })

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      console.log('SESSION:', session)
      if (!session) {
        window.location.replace('/login')
        return
      }
      setChecked(true)
      fetchContacts()
    }
    init()
  }, [])

  async function fetchContacts() {
    const { data } = await supabase.from('contacts').select('*').order('created_at', { ascending: false })
    setContacts(data || [])
    setLoading(false)
  }

  async function addContact() {
    if (!form.name) return
    await supabase.from('contacts').insert([form])
    setForm({ name: '', email: '', phone: '', company: '', notes: '' })
    setShowForm(false)
    fetchContacts()
  }

  async function deleteContact(id: string) {
    await supabase.from('contacts').delete().eq('id', id)
    fetchContacts()
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.replace('/login')
  }

  if (!checked) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-500">Verifica accesso...</p>
    </div>
  )

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">CRM</h1>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">+ Nuovo Contatto</button>
            <button onClick={handleLogout} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Esci</button>
          </div>
        </div>

        {showForm && (
          <div className="bg-white rounded-xl shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Nuovo Contatto</h2>
            <div className="grid grid-cols-2 gap-4">
              <input className="border rounded-lg p-2" placeholder="Nome *" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Telefono" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
              <input className="border rounded-lg p-2" placeholder="Azienda" value={form.company} onChange={e => setForm({...form, company: e.target.value})} />
              <textarea className="border rounded-lg p-2 col-span-2" placeholder="Note" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={addContact} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Salva</button>
              <button onClick={() => setShowForm(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300">Annulla</button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Caricamento...</p>
        ) : contacts.length === 0 ? (
          <p className="text-gray-500">Nessun contatto ancora. Aggiungine uno!</p>
        ) : (
          <div className="grid gap-4">
            {contacts.map(contact => (
              <div key={contact.id} className="bg-white rounded-xl shadow p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">{contact.name}</h3>
                    {contact.company && <p className="text-blue-600">{contact.company}</p>}
                    {contact.email && <p className="text-gray-600">📧 {contact.email}</p>}
                    {contact.phone && <p className="text-gray-600">📞 {contact.phone}</p>}
                    {contact.notes && <p className="text-gray-500 mt-2 text-sm">{contact.notes}</p>}
                  </div>
                  <button onClick={() => deleteContact(contact.id)} className="text-red-400 hover:text-red-600 text-sm">Elimina</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}