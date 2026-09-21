import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function TrackList({ session }) {
  const [races, setRaces] = useState([])
  const [teams, setTeams] = useState([])
  const [selectedTeamId, setSelectedTeamId] = useState('none')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    loadRaces()
  }, [])

  async function loadRaces() {
    setLoading(true)

    const { data: memberships } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('coach_id', session.user.id)
    const teamIds = (memberships || []).map((m) => m.team_id)

    let myTeams = []
    if (teamIds.length > 0) {
      const { data: teamRows } = await supabase
        .from('teams')
        .select('id, name')
        .in('id', teamIds)
        .order('name', { ascending: true })
      myTeams = teamRows || []
    }
    setTeams(myTeams)

    const { data: ownRaces } = await supabase
      .from('track_races')
      .select('*')
      .eq('coach_id', session.user.id)
      .order('created_at', { ascending: false })

    let combined = ownRaces || []

    if (teamIds.length > 0) {
      const { data: teamRaces } = await supabase
        .from('track_races')
        .select('*')
        .in('team_id', teamIds)
        .order('created_at', { ascending: false })
      const existingIds = new Set(combined.map((r) => r.id))
      combined = [...combined, ...(teamRaces || []).filter((r) => !existingIds.has(r.id))]
      combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }

    setRaces(combined)
    setLoading(false)
  }

  async function createRace(e) {
    e.preventDefault()
    if (!name.trim()) return
    setError('')

    const { data, error } = await supabase
      .from('track_races')
      .insert({
        name: name.trim(),
        coach_id: session.user.id,
        team_id: selectedTeamId === 'none' ? null : selectedTeamId,
        event_label: '',
        event_distance_m: 0,
      })
      .select()
      .single()

    if (error) {
      setError(error.message)
      return
    }
    setName('')
    navigate(`/track/${data.id}`)
  }

  async function deleteRace(race) {
    const confirmed = window.confirm(
      `Delete "${race.name}"? This permanently removes its athletes and all recorded times.`
    )
    if (!confirmed) return
    const { error } = await supabase.from('track_races').delete().eq('id', race.id)
    if (error) {
      setError(error.message)
      return
    }
    setRaces((prev) => prev.filter((r) => r.id !== race.id))
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Track</h1>
        <Link to="/track/roster" className="text-sm text-gray-500 underline">
          Track roster
        </Link>
      </div>

      <form onSubmit={createRace} className="flex flex-wrap gap-2 mb-2">
        <input
          type="text"
          placeholder="New race name (e.g. Duncan Relays - Boys 1600m)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        {teams.length > 0 && (
          <select
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="none">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <button className="bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium">Create</button>
      </form>
      {error && <p className="text-sm text-red-600 mb-6">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : races.length === 0 ? (
        <p className="text-sm text-gray-500">No track races yet. Create one above.</p>
      ) : (
        <ul className="space-y-2">
          {races.map((r) => (
            <li key={r.id} className="border border-gray-200 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <Link to={`/track/${r.id}`} className="flex-1 block hover:opacity-70">
                  <div className="font-medium text-sm flex items-center gap-2">
                    {r.name}
                    {r.team_id && (
                      <span className="text-[10px] uppercase tracking-wide text-gray-400 border border-gray-200 rounded-full px-1.5 py-0.5">
                        {teams.find((t) => t.id === r.team_id)?.name || 'Team'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(r.created_at).toLocaleDateString()}
                    {r.event_label && <> · {r.event_label}</>} · {r.status}
                  </div>
                </Link>
                {r.coach_id === session.user.id && (
                  <button
                    onClick={() => deleteRace(r)}
                    className="text-gray-400 hover:text-red-600 text-sm px-2"
                    aria-label={`Delete ${r.name}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
