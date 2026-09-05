import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function Workouts({ session }) {
  const [workouts, setWorkouts] = useState([])
  const [teams, setTeams] = useState([])
  const [name, setName] = useState('')
  const [repLabel, setRepLabel] = useState('')
  const [plannedReps, setPlannedReps] = useState('')
  const [selectedTeamId, setSelectedTeamId] = useState('none')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    loadWorkouts()
  }, [])

  async function loadWorkouts() {
    setLoading(true)

    const { data: memberships } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('coach_id', session.user.id)
    const teamIds = (memberships || []).map((m) => m.team_id)

    if (teamIds.length > 0) {
      const { data: teamRows } = await supabase
        .from('teams')
        .select('id, name')
        .in('id', teamIds)
        .order('name', { ascending: true })
      setTeams(teamRows || [])
    }

    const { data } = await supabase
      .from('workouts')
      .select('*')
      .eq('coach_id', session.user.id)
      .order('created_at', { ascending: false })
    setWorkouts(data || [])
    setLoading(false)
  }

  async function createWorkout(e) {
    e.preventDefault()
    if (!name.trim()) return
    setError('')

    const { data, error } = await supabase
      .from('workouts')
      .insert({
        coach_id: session.user.id,
        team_id: selectedTeamId === 'none' ? null : selectedTeamId,
        name: name.trim(),
        rep_label: repLabel.trim() || null,
        planned_reps: plannedReps ? parseInt(plannedReps, 10) : null,
      })
      .select()
      .single()

    if (error) {
      setError(error.message)
      return
    }

    navigate(`/workout/${data.id}`)
  }

  async function deleteWorkout(workout) {
    const confirmed = window.confirm(`Delete "${workout.name}"? This permanently removes all recorded rep times.`)
    if (!confirmed) return
    const { error } = await supabase.from('workouts').delete().eq('id', workout.id)
    if (error) {
      setError(error.message)
      return
    }
    setWorkouts((prev) => prev.filter((w) => w.id !== workout.id))
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link to="/" className="text-sm text-gray-500 underline">
        &larr; All races
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-1">Practice</h1>
      <p className="text-sm text-gray-500 mb-6">
        Time interval repeats at practice. Give it a rep count for a structured workout (e.g. "6x800m"), or
        leave it blank to add reps as you go.
      </p>

      <form onSubmit={createWorkout} className="space-y-2 mb-8 border border-gray-200 rounded-lg p-4">
        <input
          type="text"
          placeholder="Workout name (e.g. Tuesday intervals)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Rep label (optional, e.g. 800m)"
            value={repLabel}
            onChange={(e) => setRepLabel(e.target.value)}
            className="flex-1 min-w-[140px] border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="number"
            min="1"
            placeholder="# of reps (optional)"
            value={plannedReps}
            onChange={(e) => setPlannedReps(e.target.value)}
            className="w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm"
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
        </div>
        <button className="bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium">
          Start setup
        </button>
      </form>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : workouts.length === 0 ? (
        <p className="text-sm text-gray-500">No workouts yet.</p>
      ) : (
        <ul className="space-y-2">
          {workouts.map((w) => (
            <li key={w.id} className="flex items-center gap-2 border border-gray-200 rounded-lg px-4 py-3">
              <Link to={`/workout/${w.id}`} className="flex-1 hover:opacity-70">
                <div className="font-medium text-sm">
                  {w.name}
                  {w.rep_label && <span className="text-gray-400 font-normal"> · {w.rep_label}</span>}
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(w.created_at).toLocaleDateString()} · {w.status}
                  {w.planned_reps ? ` · ${w.planned_reps} reps planned` : ' · freeform'}
                </div>
              </Link>
              <button
                onClick={() => deleteWorkout(w)}
                className="text-gray-400 hover:text-red-600 text-sm px-2"
                aria-label={`Delete ${w.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
