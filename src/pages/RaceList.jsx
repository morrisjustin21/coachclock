import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function RaceList({ session }) {
  const [races, setRaces] = useState([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    loadRaces()
  }, [])

  async function loadRaces() {
    setLoading(true)
    const { data, error } = await supabase
      .from('races')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error) setRaces(data)
    setLoading(false)
  }

  async function createRace(e) {
    e.preventDefault()
    if (!name.trim()) return
    setError('')
    const { data, error } = await supabase
      .from('races')
      .insert({ name: name.trim(), coach_id: session.user.id })
      .select()
      .single()
    if (error) {
      setError(error.message)
      return
    }
    setName('')
    navigate(`/race/${data.id}`)
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Your races</h1>
        <div className="flex items-center gap-4">
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
            <li key={r.id}>
              <Link
                to={`/race/${r.id}`}
                className="block border border-gray-200 rounded-lg px-4 py-3 hover:bg-gray-50"
              >
                <div className="font-medium text-sm">{r.name}</div>
                <div className="text-xs text-gray-500">
                  {new Date(r.created_at).toLocaleDateString()} · {r.status}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
