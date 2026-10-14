import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadMyRaces, deleteRace } from '../lib/loadMyRaces'
import RaceRow from '../components/RaceRow'

// Jan-Jul = Spring <year>, Aug-Dec = Fall <year>
function seasonOf(iso) {
  const d = new Date(iso)
  return `${d.getMonth() >= 7 ? 'Fall' : 'Spring'} ${d.getFullYear()}`
}

export default function CompletedRaces({ session }) {
  const [races, setRaces] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    loadMyRaces(session.user.id).then((result) => {
      setTeams(result.teams)
      setRaces(result.races)
      setLoading(false)
    })
  }, [])

  async function handleDelete(race) {
    const { cancelled, error } = await deleteRace(race)
    if (cancelled) return
    if (error) {
      setError(error.message)
      return
    }
    setRaces((prev) => prev.filter((r) => r.id !== race.id))
  }

  const q = search.trim().toLowerCase()
  const completed = races
    .filter((r) => r.completed_at)
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))

  // Group by season, newest season first (Map keeps insertion order)
  const groups = new Map()
  completed.forEach((r) => {
    const key = seasonOf(r.completed_at)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  })

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link to="/" className="text-sm text-gray-700 underline">
        ← Back to races
      </Link>
      <h1 className="text-xl font-semibold mt-3 mb-4">Completed races</h1>

      <input
        type="text"
        placeholder="Search by race name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
      />
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-700">Loading...</p>
      ) : completed.length === 0 ? (
        <p className="text-sm text-gray-700">
          {q ? 'No completed races match that search.' : 'No completed races yet.'}
        </p>
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([season, list], i) => (
            <details key={season} open={i === 0 || !!q} className="group">
              <summary className="cursor-pointer text-sm font-semibold text-gray-900 mb-2">
                {season} <span className="text-gray-600 font-normal">({list.length})</span>
              </summary>
              <ul className="space-y-2 mt-2">
                {list.map((r) => (
                  <RaceRow
                    key={r.id}
                    race={r}
                    teams={teams}
                    userId={session.user.id}
                    variant="done"
                    onDelete={handleDelete}
                    onCopy={() => {}}
                  />
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
