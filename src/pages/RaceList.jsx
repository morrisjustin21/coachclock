import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I to avoid confusion
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export default function RaceList({ session }) {
  const [races, setRaces] = useState([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    loadRaces()
  }, [])

  async function loadRaces() {
    setLoading(true)
    const { data, error } = await supabase
      .from('races')
      .select('*')
      .eq('coach_id', session.user.id)
      .order('created_at', { ascending: false })
    if (!error) setRaces(data)
    setLoading(false)
  }

  async function createRace(e) {
    e.preventDefault()
    if (!name.trim()) return
    setError('')

    // Try a couple of times in the rare case of a join code collision
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase
        .from('races')
        .insert({ name: name.trim(), coach_id: session.user.id, join_code: generateJoinCode() })
        .select()
        .single()

      if (!error) {
        setName('')
        navigate(`/race/${data.id}`)
        return
      }
      if (!String(error.message).toLowerCase().includes('join_code')) {
        setError(error.message)
        return
      }
      // otherwise loop and retry with a fresh code
    }
    setError('Could not create race after a few attempts. Please try again.')
  }

  async function deleteRace(race) {
    const confirmed = window.confirm(
      `Delete "${race.name}"? This permanently removes its roster and all recorded times.`
    )
    if (!confirmed) return
    const { error } = await supabase.from('races').delete().eq('id', race.id)
    if (error) {
      setError(error.message)
      return
    }
    setRaces((prev) => prev.filter((r) => r.id !== race.id))
  }

  async function copyCode(race) {
    try {
      await navigator.clipboard.writeText(race.join_code)
      setCopiedId(race.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // Clipboard API can fail on some browsers/permissions - fail silently, code is shown anyway
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Your races</h1>
        <div className="flex items-center gap-4">
          <Link to="/join" className="text-sm text-gray-500 underline">
            Join a race
          </Link>
          <Link to="/roster" className="text-sm text-gray-500 underline">
            Team roster
          </Link>
          <button onClick={signOut} className="text-sm text-gray-500 underline">
            Sign out
          </button>
        </div>
      </div>

      <form onSubmit={createRace} className="flex gap-2 mb-2">
        <input
          type="text"
          placeholder="New race name (e.g. Duncan Invitational - Varsity Boys)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <button className="bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium">
          Create
        </button>
      </form>
      {error && <p className="text-sm text-red-600 mb-6">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : races.length === 0 ? (
        <p className="text-sm text-gray-500">No races yet. Create one above.</p>
      ) : (
        <ul className="space-y-2">
          {races.map((r) => (
            <li key={r.id} className="border border-gray-200 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <Link to={`/race/${r.id}`} className="flex-1 block hover:opacity-70">
                  <div className="font-medium text-sm">{r.name}</div>
                  <div className="text-xs text-gray-500">
                    {new Date(r.created_at).toLocaleDateString()} · {r.status}
                  </div>
                </Link>
                <button
                  onClick={() => deleteRace(r)}
                  className="text-gray-400 hover:text-red-600 text-sm px-2"
                  aria-label={`Delete ${r.name}`}
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
                <span className="text-xs text-gray-400">Join code:</span>
                <span className="text-xs font-mono font-semibold tracking-wider">{r.join_code}</span>
                <button
                  onClick={() => copyCode(r)}
                  className="text-xs text-gray-500 underline ml-1"
                >
                  {copiedId === r.id ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
