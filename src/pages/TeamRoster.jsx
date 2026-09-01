import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function TeamRoster({ session }) {
  const [athletes, setAthletes] = useState([])
  const [name, setName] = useState('')
  const [bib, setBib] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadRoster()
  }, [])

  async function loadRoster() {
    setLoading(true)
    const { data } = await supabase
      .from('team_athletes')
      .select('*')
      .order('name', { ascending: true })
    if (data) setAthletes(data)
    setLoading(false)
  }

  async function addOne(e) {
    e.preventDefault()
    if (!name.trim()) return
    await supabase.from('team_athletes').insert({
      coach_id: session.user.id,
      name: name.trim(),
      bib: bib.trim() || null,
    })
    setName('')
    setBib('')
    loadRoster()
  }

  async function addBulk(e) {
    e.preventDefault()
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) return
    const rows = lines.map((line) => {
      const [n, b] = line.split(',').map((p) => p.trim())
      return { coach_id: session.user.id, name: n, bib: b || null }
    })
    await supabase.from('team_athletes').insert(rows)
    setBulkText('')
    loadRoster()
  }

  async function removeAthlete(id) {
    await supabase.from('team_athletes').delete().eq('id', id)
    loadRoster()
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link to="/" className="text-sm text-gray-500 underline">
        &larr; All races
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-1">Team roster</h1>
      <p className="text-sm text-gray-500 mb-6">
        Build this once, then pick from it when setting up each race.
      </p>

      <form onSubmit={addOne} className="flex gap-2 mb-3">
        <input
          type="text"
          placeholder="Athlete name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <input
          type="text"
          placeholder="Bib (optional)"
          value={bib}
          onChange={(e) => setBib(e.target.value)}
          className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <button className="bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium">
          Add
        </button>
      </form>

      <details className="mb-8">
        <summary className="text-sm text-gray-500 cursor-pointer">
          Or paste a whole list at once
        </summary>
        <form onSubmit={addBulk} className="mt-2 space-y-2">
          <textarea
            placeholder={'One per line, e.g.\nJordan Smith, 101\nAlex Lee, 102'}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={5}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button className="bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium">
            Add list
          </button>
        </form>
      </details>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : athletes.length === 0 ? (
        <p className="text-sm text-gray-400">No athletes on your roster yet.</p>
      ) : (
        <ul className="space-y-1">
          {athletes.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between border-b border-gray-100 py-2 text-sm"
            >
              <span>
                {a.name}
                {a.bib && <span className="text-gray-400 ml-2">#{a.bib}</span>}
              </span>
              <button
                onClick={() => removeAthlete(a.id)}
                className="text-gray-400 hover:text-red-600 text-xs"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
