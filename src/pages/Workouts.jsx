import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function Workouts({ session }) {
  const [workouts, setWorkouts] = useState([])
  const [teams, setTeams] = useState([])
  const [name, setName] = useState('')
  const [mode, setMode] = useState('intervals') // 'intervals' | 'continuous'
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

    const { data: ownWorkouts } = await supabase
      .from('workouts')
      .select('*')
      .eq('coach_id', session.user.id)
      .order('created_at', { ascending: false })

    let combined = ownWorkouts || []

    if (teamIds.length > 0) {
      const { data: teamWorkouts } = await supabase
        .from('workouts')
        .select('*')
        .in('team_id', teamIds)
        .order('created_at', { ascending: false })
      const existingIds = new Set(combined.map((w) => w.id))
      combined = [...combined, ...(teamWorkouts || []).filter((w) => !existingIds.has(w.id))]
      combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }

    setWorkouts(combined)
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
        mode,
        rep_label: mode === 'intervals' ? repLabel.trim() || null : null,
        planned_reps: mode === 'intervals' && plannedReps ? parseInt(plannedReps, 10) : null,
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
    const confirmed = window.confirm(`Delete "${workout.name}"? This permanently removes all recorded times.`)
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
      <p className="text-sm text-gray-500 mb-6">Time practice sessions — interval repeats or a continuous run with splits.</p>

      <form onSubmit={createWorkout} className="space-y-3 mb-8 border border-gray-200 rounded-lg p-4">
        <input
          type="text"
          placeholder="Workout name (e.g. Tuesday intervals, 3-mile progression)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('intervals')}
            className={`flex-1 border-2 rounded-lg px-3 py-2 text-sm font-semibold ${
              mode === 'intervals' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600'
            }`}
          >
            Intervals / repeats
            <div className={`text-xs font-normal mt-0.5 ${mode === 'intervals' ? 'text-gray-300' : 'text-gray-400'}`}>
              Clock resets each rep, e.g. 6x800m
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode('continuous')}
            className={`flex-1 border-2 rounded-lg px-3 py-2 text-sm font-semibold ${
              mode === 'continuous' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600'
            }`}
          >
            Continuous run
            <div className={`text-xs font-normal mt-0.5 ${mode === 'continuous' ? 'text-gray-300' : 'text-gray-400'}`}>
              One clock with splits, e.g. a progression run
            </div>
          </button>
        </div>

        {mode === 'intervals' && (
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
          </div>
        )}

        {mode === 'continuous' && (
          <p className="text-xs text-gray-500">
            You'll add checkpoints (like mile markers) on the next screen, same as setting up a race.
          </p>
        )}

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
                <div className="font-medium text-sm flex items-center gap-2">
                  {w.name}
                  {w.rep_label && <span className="text-gray-400 font-normal"> · {w.rep_label}</span>}
                  {w.team_id && (
                    <span className="text-[10px] uppercase tracking-wide text-gray-400 border border-gray-200 rounded-full px-1.5 py-0.5">
                      {teams.find((t) => t.id === w.team_id)?.name || 'Team'}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(w.created_at).toLocaleDateString()} · {w.status} ·{' '}
                  {w.mode === 'continuous'
                    ? 'continuous run'
                    : w.planned_reps
                    ? `${w.planned_reps} reps planned`
                    : 'freeform reps'}
                </div>
              </Link>
              {w.coach_id === session.user.id && (
                <button
                  onClick={() => deleteWorkout(w)}
                  className="text-gray-400 hover:text-red-600 text-sm px-2"
                  aria-label={`Delete ${w.name}`}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
