import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { loadMyRaces, deleteRace, splitRaces } from '../lib/loadMyRaces'
import RaceRow from '../components/RaceRow'

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
  const [teams, setTeams] = useState([])
  const [selectedTeamId, setSelectedTeamId] = useState('none')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [now, setNow] = useState(Date.now())
  const navigate = useNavigate()

  useEffect(() => {
    load()
  }, [])

  // Re-check the 24-hour cutoff every minute so a race drops off the top
  // section on its own, even if the screen stays open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  async function load() {
    setLoading(true)
    const result = await loadMyRaces(session.user.id)
    setTeams(result.teams)
    setRaces(result.races)
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
        .insert({
          name: name.trim(),
          coach_id: session.user.id,
          join_code: generateJoinCode(),
          team_id: selectedTeamId === 'none' ? null : selectedTeamId,
        })
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

  async function handleDelete(race) {
    const { cancelled, error } = await deleteRace(race)
    if (cancelled) return
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

  const { top, upcoming, older } = splitRaces(races, now)
  const recent = older.slice(0, 3)

  function row(r, variant) {
    return (
      <RaceRow
        key={r.id}
        race={r}
        teams={teams}
        userId={session.user.id}
        variant={variant}
        onDelete={handleDelete}
        onCopy={copyCode}
        copiedId={copiedId}
      />
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Your races</h1>
        <div className="flex items-center gap-4">
          <Link to="/join" className="text-sm text-gray-700 underline">
            Join a race
          </Link>
          <button onClick={signOut} className="text-sm text-gray-700 underline">
            Sign out
          </button>
        </div>
      </div>

      <form onSubmit={createRace} className="flex flex-wrap gap-2 mb-2">
        <input
          type="text"
          placeholder="New race name (e.g. Duncan Invitational - Varsity Boys)"
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
        <button className="bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium">
          Create
        </button>
      </form>
      {error && <p className="text-sm text-red-600 mb-6">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-700 mt-6">Loading...</p>
      ) : races.length === 0 ? (
        <p className="text-sm text-gray-700 mt-6">No races yet. Create one above.</p>
      ) : (
        <div className="mt-6 space-y-6">
          {top.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-red-600 mb-2">
                Live &amp; just finished
              </h2>
              <ul className="space-y-2">
                {top.map((r) => row(r, r.completed_at ? 'justFinished' : 'live'))}
              </ul>
            </section>
          )}

          {upcoming.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">
                Upcoming
              </h2>
              <ul className="space-y-2">{upcoming.map((r) => row(r, 'upcoming'))}</ul>
            </section>
          )}

          {older.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Recent results
                </h2>
                <Link to="/races/completed" className="text-xs text-gray-700 underline">
                  View all completed races ({older.length}) →
                </Link>
              </div>
              <ul className="space-y-2">{recent.map((r) => row(r, 'done'))}</ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
