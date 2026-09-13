import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { formatTime } from '../lib/csv'
import { enqueue, dequeue, getQueued, clearQueue } from '../lib/offlineQueue'

const CHECKPOINT_PRESETS = ['1000m', '2000m', '3000m', '4000m', '1mi', '2mi', '3mi', 'Finish']

export default function WorkoutPage({ session }) {
  const { workoutId } = useParams()
  const [workout, setWorkout] = useState(null)
  const [team, setTeam] = useState(null)
  const [teamAthletes, setTeamAthletes] = useState([])
  const [workoutAthletes, setWorkoutAthletes] = useState([])
  const [reps, setReps] = useState([]) // used as either "reps" (intervals) or "checkpoints" (continuous)
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

    if (data?.team_id) {
      const { data: teamRow } = await supabase
        .from('teams')
        .select('id, name, photo_url')
        .eq('id', data.team_id)
        .maybeSingle()
      setTeam(teamRow || null)
    } else {
      setTeam(null)
    }

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

      {workout.status !== 'setup' && workout.mode === 'continuous' && (
        <ContinuousWorkoutLive
          workout={workout}
          team={team}
          workoutAthletes={workoutAthletes}
          checkpoints={reps}
          splits={splits}
          isOwner={isOwner}
        />
      )}

      {workout.status !== 'setup' && workout.mode !== 'continuous' && (
        <IntervalWorkoutLive
          workout={workout}
          team={team}
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

  const [checkpointList, setCheckpointList] = useState([])
  const [customCheckpoint, setCustomCheckpoint] = useState('')

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

  function addPresetCheckpoint(e) {
    const label = e.target.value
    if (!label) return
    setCheckpointList([...checkpointList, { key: `cp-${Date.now()}`, label }])
    e.target.value = ''
  }

  function addCustomCheckpoint(e) {
    e.preventDefault()
    if (!customCheckpoint.trim()) return
    setCheckpointList([...checkpointList, { key: `cp-${Date.now()}`, label: customCheckpoint.trim() }])
    setCustomCheckpoint('')
  }

  function moveCheckpoint(index, dir) {
    const next = [...checkpointList]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setCheckpointList(next)
  }

  function removeCheckpoint(key) {
    setCheckpointList(checkpointList.filter((c) => c.key !== key))
  }

  async function startWorkout() {
    if (selected.size === 0 && oneOffs.length === 0) return
    if (workout.mode === 'continuous' && checkpointList.length === 0) return
    setStarting(true)

    const athleteRows = [
      ...teamAthletes
        .filter((a) => selected.has(a.id))
        .map((a) => ({ workout_id: workout.id, team_athlete_id: a.id, name: a.name, bib: a.bib })),
      ...oneOffs.map((o) => ({ workout_id: workout.id, team_athlete_id: null, name: o.name, bib: null })),
    ]
    await supabase.from('workout_athletes').insert(athleteRows)

    if (workout.mode === 'continuous') {
      const checkpointRows = checkpointList.map((c, i) => ({
        workout_id: workout.id,
        rep_number: i + 1,
        label: c.label,
      }))
      await supabase.from('workout_reps').insert(checkpointRows)
    } else if (workout.planned_reps && workout.planned_reps > 0) {
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

  const canStart =
    (selected.size > 0 || oneOffs.length > 0) && (workout.mode !== 'continuous' || checkpointList.length > 0)

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

      <form onSubmit={addOneOff} className="flex gap-2 mb-6">
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
        <ul className="text-sm text-gray-600 mb-6 space-y-1">
          {oneOffs.map((o) => (
            <li key={o.key}>{o.name}</li>
          ))}
        </ul>
      )}

      {workout.mode === 'continuous' && (
        <>
          <h2 className="text-sm font-medium text-gray-700 mb-2">Checkpoints</h2>
          <p className="text-xs text-gray-500 mb-2">Add each spot on the course you'll record a split, in order.</p>
          <div className="flex gap-2 mb-3">
            <select
              onChange={addPresetCheckpoint}
              defaultValue=""
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Add a common checkpoint...
              </option>
              {CHECKPOINT_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <form onSubmit={addCustomCheckpoint} className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder="Or type a custom checkpoint name"
              value={customCheckpoint}
              onChange={(e) => setCustomCheckpoint(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium">Add</button>
          </form>

          {checkpointList.length > 0 && (
            <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-6">
              {checkpointList.map((c, i) => (
                <li key={c.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="text-gray-400 w-5">{i + 1}</span>
                  <span className="flex-1">{c.label}</span>
                  <button onClick={() => moveCheckpoint(i, -1)} disabled={i === 0} className="text-gray-400 disabled:opacity-30 px-1">
                    ↑
                  </button>
                  <button
                    onClick={() => moveCheckpoint(i, 1)}
                    disabled={i === checkpointList.length - 1}
                    className="text-gray-400 disabled:opacity-30 px-1"
                  >
                    ↓
                  </button>
                  <button onClick={() => removeCheckpoint(c.key)} className="text-gray-400 hover:text-red-600 px-1">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <button
        onClick={startWorkout}
        disabled={!canStart || starting}
        className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
      >
        {starting ? 'Starting...' : 'Start workout'}
      </button>
    </div>
  )
}

function computeElapsed(clockLike) {
  if (!clockLike) return 0
  const base = clockLike.accumulated_ms || 0
  if (clockLike.running && clockLike.started_at) {
    return base + (Date.now() - new Date(clockLike.started_at).getTime())
  }
  return base
}

function IntervalWorkoutLive({ workout, team, workoutAthletes, reps, splits, isOwner }) {
  const sortedReps = [...reps].sort((a, b) => a.rep_number - b.rep_number)
  const [activeRepId, setActiveRepId] = useState(null)
  const rafRef = useRef(null)
  const printRef = useRef(null)

  useEffect(() => {
    function fitToPage() {
      const el = printRef.current
      if (!el) return
      el.style.transform = 'none'
      el.style.width = '100%'
      const naturalHeight = el.scrollHeight
      const availableHeightPx = (8.5 - 0.8) * 96
      if (naturalHeight > availableHeightPx) {
        const scale = availableHeightPx / naturalHeight
        el.style.transform = `scale(${scale})`
        el.style.transformOrigin = 'top left'
        el.style.width = `${100 / scale}%`
      }
    }
    function resetFit() {
      const el = printRef.current
      if (!el) return
      el.style.transform = 'none'
      el.style.width = '100%'
    }
    window.addEventListener('beforeprint', fitToPage)
    window.addEventListener('afterprint', resetFit)
    return () => {
      window.removeEventListener('beforeprint', fitToPage)
      window.removeEventListener('afterprint', resetFit)
    }
  }, [])

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
      <style>{`
        @media print {
          @page { size: letter landscape; margin: 0.4in; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {sortedReps.length > 1 && (
        <div className="flex gap-2 overflow-x-auto mb-4 pb-1 print:hidden">
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
          className="w-full bg-gray-900 text-white rounded-lg py-3 text-sm font-medium mb-4 print:hidden"
        >
          Start Rep 1
        </button>
      ) : (
        <div className="print:hidden">
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
              {hasMorePlannedReps ? `Start next rep` : 'Add another rep'}
            </button>
          )}
        </div>
      )}

      {sortedReps.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-gray-700 print:hidden">All reps so far</h2>
            <button onClick={() => window.print()} className="text-xs text-gray-500 underline print:hidden">
              Print report
            </button>
          </div>

          <div ref={printRef}>
            <div className="hidden print:flex items-center gap-3 border-b-2 border-gray-900 pb-2 mb-3">
              {team?.photo_url && <img src={team.photo_url} alt="" className="w-9 h-9 rounded object-cover" />}
              <div>
                <div className="text-base font-extrabold leading-tight">{team ? team.name : workout.name}</div>
                <div className="text-xs text-gray-600">
                  {team && <>{workout.name} · </>}
                  {new Date(workout.created_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                  {workout.rep_label && <> · {workout.rep_label}</>}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto print:overflow-visible">
              <table className="text-sm print:text-[8.5px] border-collapse w-full">
                <thead>
                  <tr>
                    <th className="text-left py-2 print:py-1 pr-4 print:pr-2 sticky left-0 bg-white print:static">
                      Athlete
                    </th>
                    {sortedReps.map((r) => (
                      <th
                        key={r.id}
                        className="text-right py-2 print:py-1 px-2 print:px-1.5 text-xs print:text-[7.5px] font-normal text-gray-400 border-l border-gray-100 print:border-gray-200"
                      >
                        {r.rep_number}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {workoutAthletes.map((a, i) => (
                    <tr
                      key={a.id}
                      className={`border-t border-gray-100 print:border-gray-200 ${i % 2 === 1 ? 'print:bg-gray-50' : ''}`}
                    >
                      <td className="py-2 print:py-0.5 pr-4 print:pr-2 font-medium sticky left-0 bg-white print:static print:bg-transparent">
                        {a.name}
                      </td>
                      {sortedReps.map((r) => {
                        const s = splits.find((sp) => sp.rep_id === r.id && sp.athlete_id === a.id)
                        return (
                          <td
                            key={r.id}
                            className="py-2 print:py-0.5 px-2 print:px-1.5 text-right tabular-nums border-l border-gray-100 print:border-gray-200"
                          >
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
        </div>
      )}
    </div>
  )
}

function buildContinuousReportRows(checkpoints, workoutAthletes, splits) {
  const sortedCheckpoints = [...checkpoints].sort((a, b) => a.rep_number - b.rep_number)
  const byAthlete = {}
  splits.forEach((s) => {
    if (!byAthlete[s.athlete_id]) byAthlete[s.athlete_id] = {}
    byAthlete[s.athlete_id][s.rep_id] = s
  })

  const rows = workoutAthletes.map((athlete) => {
    const times = byAthlete[athlete.id] || {}
    let prevCumulative = 0
    const cells = sortedCheckpoints.map((cp) => {
      const split = times[cp.id]
      const cumulative = split ? split.recorded_time_ms : null
      const segment = cumulative != null ? cumulative - prevCumulative : null
      if (cumulative != null) prevCumulative = cumulative
      return { checkpointId: cp.id, label: cp.label, cumulative, segment }
    })
    return { athlete, cells }
  })

  const lastCp = sortedCheckpoints[sortedCheckpoints.length - 1]
  rows.sort((a, b) => {
    const aLast = lastCp ? a.cells.find((c) => c.checkpointId === lastCp.id)?.cumulative : null
    const bLast = lastCp ? b.cells.find((c) => c.checkpointId === lastCp.id)?.cumulative : null
    if (aLast != null && bLast != null) return aLast - bLast
    if (aLast != null) return -1
    if (bLast != null) return 1
    return 0
  })

  return { sortedCheckpoints, rows }
}

function ContinuousWorkoutLive({ workout, team, workoutAthletes, checkpoints, splits, isOwner }) {
  const sortedCheckpoints = [...checkpoints].sort((a, b) => a.rep_number - b.rep_number)
  const [activeCheckpointId, setActiveCheckpointId] = useState(null)
  const [showReport, setShowReport] = useState(false)
  const rafRef = useRef(null)
  const printRef = useRef(null)

  useEffect(() => {
    if (!activeCheckpointId && sortedCheckpoints.length > 0) {
      setActiveCheckpointId(sortedCheckpoints[0].id)
    }
  }, [checkpoints.length])

  const [localWorkout, setLocalWorkout] = useState(workout)
  const [elapsed, setElapsed] = useState(computeElapsed(workout))

  useEffect(() => {
    setLocalWorkout(workout)
  }, [workout.running, workout.started_at, workout.accumulated_ms])

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    setElapsed(computeElapsed(localWorkout))
    if (localWorkout.running) {
      function loop() {
        setElapsed(computeElapsed(localWorkout))
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [localWorkout.running, localWorkout.started_at, localWorkout.accumulated_ms])

  useEffect(() => {
    function fitToPage() {
      const el = printRef.current
      if (!el) return
      el.style.transform = 'none'
      el.style.width = '100%'
      const naturalHeight = el.scrollHeight
      const availableHeightPx = (11 - 0.8) * 96
      if (naturalHeight > availableHeightPx) {
        const scale = availableHeightPx / naturalHeight
        el.style.transform = `scale(${scale})`
        el.style.transformOrigin = 'top left'
        el.style.width = `${100 / scale}%`
      }
    }
    function resetFit() {
      const el = printRef.current
      if (!el) return
      el.style.transform = 'none'
      el.style.width = '100%'
    }
    window.addEventListener('beforeprint', fitToPage)
    window.addEventListener('afterprint', resetFit)
    return () => {
      window.removeEventListener('beforeprint', fitToPage)
      window.removeEventListener('afterprint', resetFit)
    }
  }, [showReport])

  const [pendingSplits, setPendingSplits] = useState([])
  const [removedIds, setRemovedIds] = useState(new Set())

  const queueKey = `workout-continuous-${workout.id}`
  const [queueCount, setQueueCount] = useState(() => getQueued(queueKey).length)

  useEffect(() => {
    setPendingSplits(getQueued(queueKey).map((q) => q.payload))
    flushQueueNow()
  }, [])

  useEffect(() => {
    const confirmedIds = new Set(splits.map((s) => s.id))
    setPendingSplits((prev) => prev.filter((p) => !confirmedIds.has(p.id)))
  }, [splits])

  useEffect(() => {
    const interval = setInterval(flushQueueNow, 8000)
    window.addEventListener('online', flushQueueNow)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online', flushQueueNow)
    }
  }, [])

  async function flushQueueNow() {
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
    if (!localWorkout.running) {
      const started_at = new Date().toISOString()
      setLocalWorkout((prev) => ({ ...prev, running: true, started_at }))
      await supabase.from('workouts').update({ running: true, started_at }).eq('id', workout.id)
    } else {
      const elapsedNow = computeElapsed(localWorkout)
      setLocalWorkout((prev) => ({ ...prev, running: false, started_at: null, accumulated_ms: elapsedNow }))
      await supabase
        .from('workouts')
        .update({ running: false, started_at: null, accumulated_ms: elapsedNow })
        .eq('id', workout.id)
    }
  }

  async function resetWorkout() {
    const confirmed = window.confirm(
      'Reset this workout? This clears the clock and deletes every recorded time at every checkpoint. This cannot be undone.'
    )
    if (!confirmed) return
    setLocalWorkout((prev) => ({ ...prev, running: false, started_at: null, accumulated_ms: 0 }))
    setPendingSplits([])
    setRemovedIds(new Set())
    clearQueue(queueKey)
    setQueueCount(0)
    await supabase.from('workouts').update({ running: false, started_at: null, accumulated_ms: 0 }).eq('id', workout.id)
    await supabase.from('workout_splits').delete().eq('workout_id', workout.id)
  }

  async function finishWorkout() {
    const confirmed = window.confirm('Finish this workout? Times stay saved, but can no longer be recorded.')
    if (!confirmed) return
    await supabase.from('workouts').update({ status: 'finished' }).eq('id', workout.id)
  }

  const activeCheckpoint = sortedCheckpoints.find((c) => c.id === activeCheckpointId)
  const activeIndex = sortedCheckpoints.findIndex((c) => c.id === activeCheckpointId)
  const prevCheckpoint = activeIndex > 0 ? sortedCheckpoints[activeIndex - 1] : null

  const splitsForActive = splits.filter((s) => s.rep_id === activeCheckpointId)
  const confirmedAthleteIds = new Set(splitsForActive.map((s) => s.athlete_id))
  const visibleConfirmed = splitsForActive.filter((s) => !removedIds.has(s.id))
  const visiblePending = pendingSplits.filter(
    (p) => p.rep_id === activeCheckpointId && !confirmedAthleteIds.has(p.athlete_id)
  )
  const finishedInOrder = [...visibleConfirmed, ...visiblePending].sort(
    (a, b) => a.recorded_time_ms - b.recorded_time_ms
  )
  const finishedAthleteIds = new Set(finishedInOrder.map((s) => s.athlete_id))

  let waiting = workoutAthletes.filter((a) => !finishedAthleteIds.has(a.id))
  if (prevCheckpoint) {
    const prevTimes = {}
    splits
      .filter((s) => s.rep_id === prevCheckpoint.id)
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
    if (!localWorkout.running || !activeCheckpoint) return
    const time = computeElapsed(localWorkout)
    const splitRow = {
      id: crypto.randomUUID(),
      workout_id: workout.id,
      rep_id: activeCheckpoint.id,
      athlete_id: athlete.id,
      label: athlete.name,
      recorded_time_ms: time,
    }
    setPendingSplits((prev) => [...prev, splitRow])
    enqueue(queueKey, { id: splitRow.id, action: 'insert', payload: splitRow })
    setQueueCount(getQueued(queueKey).length)
    flushQueueNow()
  }

  function undoLast() {
    if (finishedInOrder.length === 0) return
    const last = finishedInOrder[finishedInOrder.length - 1]
    setPendingSplits((prev) => prev.filter((p) => p.id !== last.id))

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

  function checkpointCount(cp) {
    return splits.filter((s) => s.rep_id === cp.id).length
  }

  if (showReport) {
    const { sortedCheckpoints: reportCheckpoints, rows } = buildContinuousReportRows(checkpoints, workoutAthletes, splits)
    return (
      <div>
        <style>{`
          @media print {
            @page { size: letter portrait; margin: 0.4in; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        `}</style>
        <button onClick={() => setShowReport(false)} className="text-sm text-gray-500 underline mb-4 print:hidden">
          &larr; Back to workout
        </button>
        <div className="flex items-center justify-between mb-4 print:hidden">
          <h2 className="text-lg font-semibold">Full report</h2>
          <button onClick={() => window.print()} className="text-xs text-gray-500 underline">
            Print
          </button>
        </div>

        <div ref={printRef}>
          <div className="hidden print:flex items-center gap-3 border-b-2 border-gray-900 pb-2 mb-3">
            {team?.photo_url && <img src={team.photo_url} alt="" className="w-9 h-9 rounded object-cover" />}
            <div>
              <div className="text-base font-extrabold leading-tight">{team ? team.name : workout.name}</div>
              <div className="text-xs text-gray-600">
                {team && <>{workout.name} · </>}
                {new Date(workout.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto print:overflow-visible">
            <table className="text-sm print:text-[7.5px] border-collapse w-full">
              <thead>
                <tr>
                  <th className="text-left py-2 print:py-1 pr-4 print:pr-2 sticky left-0 bg-white print:static">#</th>
                  <th className="text-left py-2 print:py-1 pr-4 print:pr-2 sticky left-0 bg-white print:static">Runner</th>
                  {reportCheckpoints.map((cp) => (
                    <th
                      key={cp.id}
                      colSpan={2}
                      className="text-center py-2 print:py-1 px-2 print:px-1 border-l border-gray-200 uppercase print:tracking-wide text-gray-500 print:text-[6.5px] font-semibold"
                    >
                      {cp.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="sticky left-0 bg-white print:static"></th>
                  <th className="sticky left-0 bg-white print:static"></th>
                  {reportCheckpoints.map((cp) => (
                    <>
                      <th key={`${cp.id}-time`} className="text-xs print:text-[6.5px] font-normal text-gray-400 px-2 print:px-1 border-l border-gray-200">
                        Time
                      </th>
                      <th key={`${cp.id}-split`} className="text-xs print:text-[6.5px] font-normal text-gray-400 px-2 print:px-1">
                        Split
                      </th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ athlete, cells }, i) => (
                  <tr key={athlete.id} className={`border-t border-gray-100 print:border-gray-200 ${i % 2 === 1 ? 'print:bg-gray-50' : ''}`}>
                    <td className="py-2 print:py-0.5 pr-4 print:pr-2 text-gray-400 sticky left-0 bg-white print:static print:bg-transparent">
                      {i + 1}
                    </td>
                    <td className="py-2 print:py-0.5 pr-4 print:pr-2 font-medium sticky left-0 bg-white print:static print:bg-transparent">
                      {athlete.name}
                    </td>
                    {cells.map((c) => (
                      <>
                        <td key={`${c.checkpointId}-time`} className="text-right tabular-nums px-2 print:px-1 border-l border-gray-100 print:border-gray-200">
                          {formatTime(c.cumulative)}
                        </td>
                        <td key={`${c.checkpointId}-split`} className="text-right tabular-nums px-2 print:px-1 text-gray-500">
                          {formatTime(c.segment)}
                        </td>
                      </>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="text-center py-4">
        <div className="text-5xl font-semibold tabular-nums">{formatTime(elapsed)}</div>
      </div>

      {isOwner && (
        <div className="flex gap-2 justify-center mb-4">
          <button onClick={handleStartStop} className="min-w-[100px] border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium">
            {localWorkout.running ? 'Stop' : elapsed > 0 ? 'Resume' : 'Start'}
          </button>
          <button onClick={resetWorkout} className="border border-red-300 text-red-600 rounded-lg px-4 py-2 text-sm font-medium">
            Reset
          </button>
          <button onClick={finishWorkout} className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium">
            Finish
          </button>
        </div>
      )}

      {sortedCheckpoints.length > 1 && (
        <div className="flex gap-2 overflow-x-auto mb-4 pb-1">
          {sortedCheckpoints.map((cp) => (
            <button
              key={cp.id}
              onClick={() => setActiveCheckpointId(cp.id)}
              className={`whitespace-nowrap text-sm font-semibold px-4 py-2 rounded-full border-2 ${
                cp.id === activeCheckpointId ? 'bg-gray-900 text-white border-gray-900 shadow-md' : 'border-gray-300 text-gray-600'
              }`}
            >
              {cp.label} ({checkpointCount(cp)}/{workoutAthletes.length})
            </button>
          ))}
        </div>
      )}

      <div className="bg-gray-900 text-white rounded-lg px-4 py-3 mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-300">Recording at</div>
          <div className="text-2xl font-bold leading-tight">{activeCheckpoint?.label || '—'}</div>
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
          <li className="px-3 py-3 text-sm text-gray-400">Everyone has come through.</li>
        ) : (
          waiting.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => recordFinish(a)}
                disabled={!localWorkout.running}
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

      <button onClick={() => setShowReport(true)} className="w-full border border-gray-300 rounded-lg py-2 text-sm font-medium">
        View full report (splits + times)
      </button>
    </div>
  )
}
