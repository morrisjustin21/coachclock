import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { formatTime } from '../lib/csv'
import { enqueue, dequeue, getQueued, clearQueue } from '../lib/offlineQueue'

export default function WorkoutPage({ session }) {
  const { workoutId } = useParams()
  const [workout, setWorkout] = useState(null)
  const [teamAthletes, setTeamAthletes] = useState([])
  const [workoutAthletes, setWorkoutAthletes] = useState([])
  const [reps, setReps] = useState([])
  const [splits, setSplits] = useState([])
  const [loading, setLoading] = useState(true)

  const isOwner = session && workout && workout.coach_id === session.user.id

  useEffect(() => {
    loadAll()

    const channel = supabase
      .channel(`workout-${workoutId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'coaches_clock', table: 'workout_splits', filter: `workout_id=eq.${workoutId}` },
        () => loadSplits()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'coaches_clock', table: 'workout_reps', filter: `workout_id=eq.${workoutId}` },
        () => loadReps()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'coaches_clock', table: 'workouts', filter: `id=eq.${workoutId}` },
        () => loadWorkout()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [workoutId])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadWorkout(), loadWorkoutAthletes(), loadReps(), loadSplits()])
    setLoading(false)
  }

  async function loadWorkout() {
    const { data } = await supabase.from('workouts').select('*').eq('id', workoutId).single()
    setWorkout(data)
    if (data && data.coach_id === session?.user?.id) {
      let query = supabase.from('team_athletes').select('*').order('name', { ascending: true })
      query = data.team_id
        ? query.eq('team_id', data.team_id)
        : query.is('team_id', null).eq('coach_id', session.user.id)
      const { data: rosterRows } = await query
      if (rosterRows) setTeamAthletes(rosterRows)
    }
  }

  async function loadWorkoutAthletes() {
    const { data } = await supabase
      .from('workout_athletes')
      .select('*')
      .eq('workout_id', workoutId)
      .order('name', { ascending: true })
    if (data) setWorkoutAthletes(data)
  }

  async function loadReps() {
    const { data } = await supabase
      .from('workout_reps')
      .select('*')
      .eq('workout_id', workoutId)
      .order('rep_number', { ascending: true })
    if (data) setReps(data)
  }

  async function loadSplits() {
    const { data } = await supabase
      .from('workout_splits')
      .select('*')
      .eq('workout_id', workoutId)
      .order('recorded_time_ms', { ascending: true })
    if (data) setSplits(data)
  }

  if (loading || !workout) return <p className="text-center py-8 text-sm text-gray-500">Loading...</p>

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <Link to="/workouts" className="text-sm text-gray-500 underline">
        &larr; All workouts
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-1">{workout.name}</h1>

      {isOwner && workout.status === 'setup' && (
        <WorkoutSetup workout={workout} teamAthletes={teamAthletes} onStarted={loadAll} />
      )}

      {workout.status !== 'setup' && (
        <WorkoutLive
          workout={workout}
          workoutAthletes={workoutAthletes}
          reps={reps}
          splits={splits}
          isOwner={isOwner}
        />
      )}
    </div>
  )
}

function WorkoutSetup({ workout, teamAthletes, onStarted }) {
  const [selected, setSelected] = useState(new Set())
  const [oneOffName, setOneOffName] = useState('')
  const [oneOffs, setOneOffs] = useState([])
  const [starting, setStarting] = useState(false)

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === teamAthletes.length) setSelected(new Set())
    else setSelected(new Set(teamAthletes.map((a) => a.id)))
  }

  function addOneOff(e) {
    e.preventDefault()
    if (!oneOffName.trim()) return
    setOneOffs([...oneOffs, { key: `oneoff-${Date.now()}`, name: oneOffName.trim() }])
    setOneOffName('')
  }

  async function startWorkout() {
    if (selected.size === 0 && oneOffs.length === 0) return
    setStarting(true)

    const rows = [
      ...teamAthletes
        .filter((a) => selected.has(a.id))
        .map((a) => ({ workout_id: workout.id, team_athlete_id: a.id, name: a.name, bib: a.bib })),
      ...oneOffs.map((o) => ({ workout_id: workout.id, team_athlete_id: null, name: o.name, bib: null })),
    ]

    await supabase.from('workout_athletes').insert(rows)

    if (workout.planned_reps && workout.planned_reps > 0) {
      const repRows = Array.from({ length: workout.planned_reps }, (_, i) => ({
        workout_id: workout.id,
        rep_number: i + 1,
        label: workout.rep_label ? `Rep ${i + 1} (${workout.rep_label})` : `Rep ${i + 1}`,
      }))
      await supabase.from('workout_reps').insert(repRows)
    }

    await supabase.from('workouts').update({ status: 'live' }).eq('id', workout.id)
    setStarting(false)
    onStarted()
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">Pick who's doing this workout.</p>

      {teamAthletes.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-gray-700">Roster</h2>
            <button onClick={toggleAll} className="text-xs text-gray-500 underline">
              {selected.size === teamAthletes.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
            {teamAthletes.map((a) => (
              <label key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                <span>{a.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={addOneOff} className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Add someone not on your roster"
          value={oneOffName}
          onChange={(e) => setOneOffName(e.target.value)}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <button className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium">Add</button>
      </form>

      {oneOffs.length > 0 && (
        <ul className="text-sm text-gray-600 mb-4 space-y-1">
          {oneOffs.map((o) => (
            <li key={o.key}>{o.name}</li>
          ))}
        </ul>
      )}

      <button
        onClick={startWorkout}
        disabled={(selected.size === 0 && oneOffs.length === 0) || starting}
        className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
      >
        {starting ? 'Starting...' : 'Start workout'}
      </button>
    </div>
  )
}

function computeElapsed(repLike) {
  if (!repLike) return 0
  const base = repLike.accumulated_ms || 0
  if (repLike.running && repLike.started_at) {
    return base + (Date.now() - new Date(repLike.started_at).getTime())
  }
  return base
}

function WorkoutLive({ workout, workoutAthletes, reps, splits, isOwner }) {
  const sortedReps = [...reps].sort((a, b) => a.rep_number - b.rep_number)
  const [activeRepId, setActiveRepId] = useState(null)
  const rafRef = useRef(null)

  useEffect(() => {
    if (sortedReps.length > 0 && (!activeRepId || !sortedReps.some((r) => r.id === activeRepId))) {
      setActiveRepId(sortedReps[sortedReps.length - 1].id)
    }
  }, [reps.length])

  const activeRep = sortedReps.find((r) => r.id === activeRepId)
  const activeIndex = sortedReps.findIndex((r) => r.id === activeRepId)
  const prevRep = activeIndex > 0 ? sortedReps[activeIndex - 1] : null

  const [localRep, setLocalRep] = useState(activeRep)
  const [elapsed, setElapsed] = useState(computeElapsed(activeRep))

  useEffect(() => {
    setLocalRep(activeRep)
  }, [activeRep?.running, activeRep?.started_at, activeRep?.accumulated_ms, activeRepId])

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    setElapsed(computeElapsed(localRep))
    if (localRep?.running) {
      function loop() {
        setElapsed(computeElapsed(localRep))
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [localRep?.running, localRep?.started_at, localRep?.accumulated_ms])

  const queueKey = activeRepId ? `workout-splits-${activeRepId}` : null
  const [localPendingSplits, setLocalPendingSplits] = useState(
    () => (queueKey ? getQueued(queueKey).map((q) => q.payload) : [])
  )
  const [removedIds, setRemovedIds] = useState(new Set())
  const [queueCount, setQueueCount] = useState(() => (queueKey ? getQueued(queueKey).length : 0))

  useEffect(() => {
    if (!queueKey) return
    setLocalPendingSplits(getQueued(queueKey).map((q) => q.payload))
    setQueueCount(getQueued(queueKey).length)
    flushQueueNow()
  }, [queueKey])

  useEffect(() => {
    const confirmedIds = new Set(splits.map((s) => s.id))
    setLocalPendingSplits((prev) => prev.filter((p) => !confirmedIds.has(p.id)))
  }, [splits])

  useEffect(() => {
    if (!queueKey) return
    const interval = setInterval(flushQueueNow, 8000)
    window.addEventListener('online', flushQueueNow)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online', flushQueueNow)
    }
  }, [queueKey])

  async function flushQueueNow() {
    if (!queueKey) return
    const items = getQueued(queueKey)
    for (const item of items) {
      try {
        let ok = false
        if (item.action === 'insert') {
          const { error } = await supabase
            .from('workout_splits')
            .upsert(item.payload, { onConflict: 'id', ignoreDuplicates: true })
          ok = !error
        } else if (item.action === 'delete') {
          const { error } = await supabase.from('workout_splits').delete().eq('id', item.payload.id)
          ok = !error
        }
        if (ok) dequeue(queueKey, item.id)
      } catch {
        // still offline - next flush will retry
      }
    }
    setQueueCount(getQueued(queueKey).length)
  }

  async function handleStartStop() {
    if (!activeRep) return
    if (!localRep.running) {
      const started_at = new Date().toISOString()
      setLocalRep((prev) => ({ ...prev, running: true, started_at }))
      await supabase.from('workout_reps').update({ running: true, started_at }).eq('id', activeRep.id)
    } else {
      const elapsedNow = computeElapsed(localRep)
      setLocalRep((prev) => ({ ...prev, running: false, started_at: null, accumulated_ms: elapsedNow }))
      await supabase
        .from('workout_reps')
        .update({ running: false, started_at: null, accumulated_ms: elapsedNow })
        .eq('id', activeRep.id)
    }
  }

  async function startNextRep() {
    const nextNumber = sortedReps.length + 1
    const label = workout.rep_label ? `Rep ${nextNumber} (${workout.rep_label})` : `Rep ${nextNumber}`
    const { data } = await supabase
      .from('workout_reps')
      .insert({ workout_id: workout.id, rep_number: nextNumber, label })
      .select()
      .single()
    if (data) setActiveRepId(data.id)
  }

  function goToRep(repId) {
    setActiveRepId(repId)
    setRemovedIds(new Set())
  }

  async function finishWorkout() {
    const confirmed = window.confirm('Finish this workout? You can still view results after, but reps can no longer be recorded.')
    if (!confirmed) return
    await supabase.from('workouts').update({ status: 'finished' }).eq('id', workout.id)
  }

  const splitsForActive = splits.filter((s) => s.rep_id === activeRepId)
  const confirmedAthleteIds = new Set(splitsForActive.map((s) => s.athlete_id))
  const visibleConfirmed = splitsForActive.filter((s) => !removedIds.has(s.id))
  const visiblePending = localPendingSplits.filter(
    (p) => p.rep_id === activeRepId && !confirmedAthleteIds.has(p.athlete_id)
  )
  const finishedInOrder = [...visibleConfirmed, ...visiblePending].sort(
    (a, b) => a.recorded_time_ms - b.recorded_time_ms
  )
  const finishedIds = new Set(finishedInOrder.map((s) => s.athlete_id))

  let waiting = workoutAthletes.filter((a) => !finishedIds.has(a.id))
  if (prevRep) {
    const prevTimes = {}
    splits
      .filter((s) => s.rep_id === prevRep.id)
      .forEach((s) => {
        prevTimes[s.athlete_id] = s.recorded_time_ms
      })
    waiting = [...waiting].sort((a, b) => {
      const aHas = prevTimes[a.id] != null
      const bHas = prevTimes[b.id] != null
      if (aHas && bHas) return prevTimes[a.id] - prevTimes[b.id]
      if (aHas) return -1
      if (bHas) return 1
      return 0
    })
  }

  function recordFinish(athlete) {
    if (!localRep?.running || !activeRep) return
    const time = computeElapsed(localRep)
    const splitRow = {
      id: crypto.randomUUID(),
      workout_id: workout.id,
      rep_id: activeRep.id,
      athlete_id: athlete.id,
      label: athlete.name,
      recorded_time_ms: time,
    }
    setLocalPendingSplits((prev) => [...prev, splitRow])
    enqueue(queueKey, { id: splitRow.id, action: 'insert', payload: splitRow })
    setQueueCount(getQueued(queueKey).length)
    flushQueueNow()
  }

  function undoLast() {
    if (finishedInOrder.length === 0) return
    const last = finishedInOrder[finishedInOrder.length - 1]
    setLocalPendingSplits((prev) => prev.filter((p) => p.id !== last.id))

    const stillQueuedAsInsert = getQueued(queueKey).some((q) => q.action === 'insert' && q.payload.id === last.id)
    if (stillQueuedAsInsert) {
      dequeue(queueKey, last.id)
    } else {
      setRemovedIds((prev) => new Set(prev).add(last.id))
      enqueue(queueKey, { id: `delete-${last.id}`, action: 'delete', payload: { id: last.id } })
      flushQueueNow()
    }
    setQueueCount(getQueued(queueKey).length)
  }

  const isLastPlannedRep = workout.planned_reps && activeIndex === workout.planned_reps - 1
  const hasMorePlannedReps = workout.planned_reps && sortedReps.length < workout.planned_reps

  return (
    <div>
      {sortedReps.length > 1 && (
        <div className="flex gap-2 overflow-x-auto mb-4 pb-1">
          {sortedReps.map((r) => (
            <button
              key={r.id}
              onClick={() => goToRep(r.id)}
              className={`whitespace-nowrap text-sm font-semibold px-4 py-2 rounded-full border-2 ${
                r.id === activeRepId ? 'bg-gray-900 text-white border-gray-900 shadow-md' : 'border-gray-300 text-gray-600'
              }`}
            >
              {r.label} ({splits.filter((s) => s.rep_id === r.id).length}/{workoutAthletes.length})
            </button>
          ))}
        </div>
      )}

      {!activeRep ? (
        <button
          onClick={startNextRep}
          className="w-full bg-gray-900 text-white rounded-lg py-3 text-sm font-medium mb-4"
        >
          Start Rep 1
        </button>
      ) : (
        <>
          <div className="text-center py-4">
            <div className="text-5xl font-semibold tabular-nums">{formatTime(elapsed)}</div>
          </div>

          {isOwner && (
            <div className="flex gap-2 justify-center mb-4">
              <button
                onClick={handleStartStop}
                className="min-w-[100px] border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium"
              >
                {localRep?.running ? 'Stop' : elapsed > 0 ? 'Resume' : 'Start'}
              </button>
              <button onClick={finishWorkout} className="border border-red-300 text-red-600 rounded-lg px-4 py-2 text-sm font-medium">
                Finish workout
              </button>
            </div>
          )}

          <div className="bg-gray-900 text-white rounded-lg px-4 py-3 mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-300">Current rep</div>
              <div className="text-2xl font-bold leading-tight">{activeRep.label}</div>
            </div>
            <button
              onClick={undoLast}
              disabled={finishedInOrder.length === 0}
              className="text-xs text-gray-300 underline disabled:opacity-40"
            >
              Undo
            </button>
          </div>

          {queueCount > 0 && (
            <div className="flex items-center justify-between bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mb-3 text-xs text-yellow-800">
              <span>{queueCount} tap{queueCount === 1 ? '' : 's'} waiting to sync</span>
              <button onClick={flushQueueNow} className="underline whitespace-nowrap ml-2">
                Retry now
              </button>
            </div>
          )}

          <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-4">
            {waiting.length === 0 ? (
              <li className="px-3 py-3 text-sm text-gray-400">Everyone has finished this rep.</li>
            ) : (
              waiting.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => recordFinish(a)}
                    disabled={!localRep?.running}
                    className="w-full text-left px-3 py-3 text-sm hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    {a.name}
                  </button>
                </li>
              ))
            )}
          </ul>

          {finishedInOrder.length > 0 && (
            <table className="w-full text-sm mb-4">
              <tbody>
                {finishedInOrder.map((s, i) => (
                  <tr key={s.id} className="border-b border-gray-100">
                    <td className="py-2 text-gray-400 w-8">{i + 1}</td>
                    <td className="py-2">{s.label}</td>
                    <td className="py-2 text-right tabular-nums font-medium">{formatTime(s.recorded_time_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {isOwner && (!workout.planned_reps || hasMorePlannedReps || isLastPlannedRep) && (
            <button onClick={startNextRep} className="w-full border border-gray-300 rounded-lg py-2 text-sm font-medium mb-6">
              {hasMorePlannedReps ? `Start ${sortedReps[sortedReps.length - 1]?.label ? 'next rep' : 'Rep 1'}` : 'Add another rep'}
            </button>
          )}
        </>
      )}

      {sortedReps.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-gray-700 mb-2">All reps so far</h2>
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left py-2 pr-4 sticky left-0 bg-white">Athlete</th>
                  {sortedReps.map((r) => (
                    <th key={r.id} className="text-right py-2 px-2 text-xs font-normal text-gray-400">
                      {r.rep_number}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workoutAthletes.map((a) => (
                  <tr key={a.id} className="border-t border-gray-100">
                    <td className="py-2 pr-4 font-medium sticky left-0 bg-white">{a.name}</td>
                    {sortedReps.map((r) => {
                      const s = splits.find((sp) => sp.rep_id === r.id && sp.athlete_id === a.id)
                      return (
                        <td key={r.id} className="py-2 px-2 text-right tabular-nums">
                          {s ? formatTime(s.recorded_time_ms) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
