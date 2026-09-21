import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { formatTime } from '../lib/csv'
import { enqueue, dequeue, getQueued, clearQueue } from '../lib/offlineQueue'

const EVENT_PRESETS = [
  { label: '100m', distance: 100, lap: 100 },
  { label: '200m', distance: 200, lap: 200 },
  { label: '400m', distance: 400, lap: 400 },
  { label: '800m', distance: 800, lap: 400 },
  { label: '1600m', distance: 1600, lap: 400 },
  { label: '3200m', distance: 3200, lap: 400 },
  { label: 'Mile (1609m)', distance: 1609, lap: 400 },
]

function parseGoalTime(str) {
  if (!str || !str.trim()) return null
  const parts = str.trim().split(':').map((p) => Number(p))
  if (parts.some((p) => Number.isNaN(p))) return null
  let seconds = 0
  if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
  else if (parts.length === 2) seconds = parts[0] * 60 + parts[1]
  else if (parts.length === 1) seconds = parts[0]
  else return null
  return Math.round(seconds * 1000)
}

function playTapConfirmation() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.12)
  } catch {
    // Web Audio unavailable - fail silently, tap still records fine
  }
  if (navigator.vibrate) navigator.vibrate(40)
}

function computeElapsed(raceLike) {
  if (!raceLike) return 0
  const base = raceLike.accumulated_ms || 0
  if (raceLike.running && raceLike.started_at) {
    return base + (Date.now() - new Date(raceLike.started_at).getTime())
  }
  return base
}

export default function TrackPage({ session }) {
  const { trackRaceId } = useParams()
  const [race, setRace] = useState(null)
  const [team, setTeam] = useState(null)
  const [rosterAthletes, setRosterAthletes] = useState([])
  const [raceAthletes, setRaceAthletes] = useState([])
  const [checkpoints, setCheckpoints] = useState([])
  const [splits, setSplits] = useState([])
  const [loading, setLoading] = useState(true)

  const isOwner = session && race && race.coach_id === session.user.id

  useEffect(() => {
    loadAll()

    const channel = supabase
      .channel(`track-race-${trackRaceId}`)
      .on('postgres_changes', { event: '*', schema: 'coaches_clock', table: 'track_splits', filter: `track_race_id=eq.${trackRaceId}` }, () => loadSplits())
      .on('postgres_changes', { event: '*', schema: 'coaches_clock', table: 'track_race_athletes', filter: `track_race_id=eq.${trackRaceId}` }, () => loadRaceAthletes())
      .on('postgres_changes', { event: '*', schema: 'coaches_clock', table: 'track_checkpoints', filter: `track_race_id=eq.${trackRaceId}` }, () => loadCheckpoints())
      .on('postgres_changes', { event: '*', schema: 'coaches_clock', table: 'track_races', filter: `id=eq.${trackRaceId}` }, () => loadRace())
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [trackRaceId])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadRace(), loadRaceAthletes(), loadCheckpoints(), loadSplits()])
    setLoading(false)
  }

  async function loadRace() {
    const { data } = await supabase.from('track_races').select('*').eq('id', trackRaceId).single()
    setRace(data)

    if (data?.team_id) {
      const { data: teamRow } = await supabase.from('teams').select('id, name, photo_url').eq('id', data.team_id).maybeSingle()
      setTeam(teamRow || null)
    } else {
      setTeam(null)
    }

    if (data && data.coach_id === session?.user?.id) {
      let query = supabase.from('track_athletes').select('*').order('name', { ascending: true })
      query = data.team_id ? query.eq('team_id', data.team_id) : query.is('team_id', null).eq('coach_id', session.user.id)
      const { data: rosterRows } = await query
      if (rosterRows) setRosterAthletes(rosterRows)
    }
  }

  async function loadRaceAthletes() {
    const { data } = await supabase
      .from('track_race_athletes')
      .select('*')
      .eq('track_race_id', trackRaceId)
      .order('sort_order', { ascending: true })
    if (data) setRaceAthletes(data)
  }

  async function loadCheckpoints() {
    const { data } = await supabase
      .from('track_checkpoints')
      .select('*')
      .eq('track_race_id', trackRaceId)
      .order('sort_order', { ascending: true })
    if (data) setCheckpoints(data)
  }

  async function loadSplits() {
    const { data } = await supabase
      .from('track_splits')
      .select('*')
      .eq('track_race_id', trackRaceId)
      .order('recorded_time_ms', { ascending: true })
    if (data) setSplits(data)
  }

  if (loading || !race) return <p className="text-center py-8 text-sm text-gray-500">Loading...</p>

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <Link to="/track" className="text-sm text-gray-500 underline">
        &larr; All track races
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-1">{race.name}</h1>

      {isOwner && race.status === 'setup' && (
        <TrackSetup race={race} rosterAthletes={rosterAthletes} onStarted={loadAll} />
      )}

      {race.status !== 'setup' && (
        <TrackLive race={race} raceAthletes={raceAthletes} checkpoints={checkpoints} splits={splits} isOwner={isOwner} />
      )}
    </div>
  )
}

function TrackSetup({ race, rosterAthletes, onStarted }) {
  const [presetIdx, setPresetIdx] = useState(4) // default 1600m
  const [customDistance, setCustomDistance] = useState('')
  const [customLap, setCustomLap] = useState('400')
  const [isCustom, setIsCustom] = useState(false)

  const [selectedIds, setSelectedIds] = useState(new Set())
  const [goalInputs, setGoalInputs] = useState({}) // track_athlete_id -> "m:ss" string

  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  function toggleAthlete(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function startRace(e) {
    e.preventDefault()
    setError('')

    const distance = isCustom ? Number(customDistance) : EVENT_PRESETS[presetIdx].distance
    const lapLength = isCustom ? Number(customLap) : EVENT_PRESETS[presetIdx].lap
    const eventLabel = isCustom ? `${distance}m` : EVENT_PRESETS[presetIdx].label

    if (!distance || distance <= 0) {
      setError('Enter a valid event distance.')
      return
    }
    if (!lapLength || lapLength <= 0) {
      setError('Enter a valid lap length.')
      return
    }
    if (selectedIds.size === 0) {
      setError('Select at least one athlete.')
      return
    }

    setStarting(true)

    // Build checkpoint distances: every full lap, then the finish (which may fall
    // short of a full lap - that's fine, it's still labeled by its real distance).
    const distances = []
    let d = lapLength
    while (d < distance) {
      distances.push(d)
      d += lapLength
    }
    if (distances.length === 0 || distances[distances.length - 1] !== distance) distances.push(distance)

    const checkpointRows = distances.map((dist, i) => ({
      track_race_id: race.id,
      label: dist === distance ? 'Finish' : `${Math.round(dist)}m`,
      distance_m: dist,
      sort_order: i,
    }))

    const { error: cpError } = await supabase.from('track_checkpoints').insert(checkpointRows)
    if (cpError) {
      setError(cpError.message)
      setStarting(false)
      return
    }

    const athleteRows = Array.from(selectedIds).map((id, i) => {
      const athlete = rosterAthletes.find((a) => a.id === id)
      return {
        track_race_id: race.id,
        track_athlete_id: id,
        name: athlete?.name || 'Athlete',
        goal_time_ms: parseGoalTime(goalInputs[id]),
        sort_order: i,
      }
    })

    const { error: athError } = await supabase.from('track_race_athletes').insert(athleteRows)
    if (athError) {
      setError(athError.message)
      setStarting(false)
      return
    }

    const { error: raceError } = await supabase
      .from('track_races')
      .update({ event_label: eventLabel, event_distance_m: distance, lap_length_m: lapLength, status: 'live' })
      .eq('id', race.id)

    setStarting(false)
    if (raceError) {
      setError(raceError.message)
      return
    }
    onStarted()
  }

  return (
    <form onSubmit={startRace} className="space-y-5">
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">Event</label>
        <div className="flex flex-wrap gap-2">
          {EVENT_PRESETS.map((p, i) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setIsCustom(false)
                setPresetIdx(i)
              }}
              className={`text-sm px-3 py-1.5 rounded-full border ${
                !isCustom && presetIdx === i ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setIsCustom(true)}
            className={`text-sm px-3 py-1.5 rounded-full border ${
              isCustom ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600'
            }`}
          >
            Custom
          </button>
        </div>
        {isCustom && (
          <div className="flex gap-2 mt-2">
            <input
              type="number"
              placeholder="Distance (m)"
              value={customDistance}
              onChange={(e) => setCustomDistance(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Lap length (m)"
              value={customLap}
              onChange={(e) => setCustomLap(e.target.value)}
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">Athletes in this race</label>
        {rosterAthletes.length === 0 ? (
          <p className="text-sm text-gray-400">
            No athletes on your track roster yet.{' '}
            <Link to="/track/roster" className="underline">
              Add some
            </Link>
            .
          </p>
        ) : (
          <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100">
            {rosterAthletes.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleAthlete(a.id)} />
                <span className="flex-1 text-sm">{a.name}</span>
                {selectedIds.has(a.id) && (
                  <input
                    type="text"
                    placeholder="Goal (m:ss)"
                    value={goalInputs[a.id] || ''}
                    onChange={(e) => setGoalInputs((prev) => ({ ...prev, [a.id]: e.target.value }))}
                    className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-xs"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-400 mt-1">Goal time is optional - only athletes with one get a live pace panel.</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        disabled={starting}
        className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
      >
        {starting ? 'Starting...' : 'Start race'}
      </button>
    </form>
  )
}

// Original even-split target time at a given checkpoint, per the athlete's goal.
function originalTargetCumulative(checkpoint, goalMs, totalDistance) {
  if (!goalMs || !totalDistance) return null
  return (goalMs * checkpoint.distance_m) / totalDistance
}

function TrackLive({ race, raceAthletes, checkpoints, splits, isOwner }) {
  const sortedCheckpoints = [...checkpoints].sort((a, b) => a.sort_order - b.sort_order)
  const [activeCheckpointId, setActiveCheckpointId] = useState(null)
  const rafRef = useRef(null)

  const [localRace, setLocalRace] = useState(race)
  const [elapsed, setElapsed] = useState(computeElapsed(race))

  useEffect(() => {
    setLocalRace(race)
  }, [race.running, race.started_at, race.accumulated_ms])

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    setElapsed(computeElapsed(localRace))
    if (localRace.running) {
      function loop() {
        setElapsed(computeElapsed(localRace))
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [localRace.running, localRace.started_at, localRace.accumulated_ms])

  useEffect(() => {
    if (!activeCheckpointId && sortedCheckpoints.length > 0) setActiveCheckpointId(sortedCheckpoints[0].id)
  }, [checkpoints.length])

  const queueKey = `track-splits-${race.id}`
  const [localPendingSplits, setLocalPendingSplits] = useState(() => getQueued(queueKey).map((q) => q.payload))
  const [removedIds, setRemovedIds] = useState(new Set())
  const [queueCount, setQueueCount] = useState(() => getQueued(queueKey).length)

  useEffect(() => {
    const confirmedIds = new Set(splits.map((s) => s.id))
    setLocalPendingSplits((prev) => prev.filter((p) => !confirmedIds.has(p.id)))
  }, [splits])

  useEffect(() => {
    flushQueueNow()
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
          const { error } = await supabase.from('track_splits').upsert(item.payload, { onConflict: 'id', ignoreDuplicates: true })
          ok = !error
        } else if (item.action === 'delete') {
          const { error } = await supabase.from('track_splits').delete().eq('id', item.payload.id)
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
    if (!localRace.running) {
      const started_at = new Date().toISOString()
      setLocalRace((prev) => ({ ...prev, running: true, started_at }))
      await supabase.from('track_races').update({ running: true, started_at }).eq('id', race.id)
    } else {
      const elapsedNow = computeElapsed(localRace)
      setLocalRace((prev) => ({ ...prev, running: false, started_at: null, accumulated_ms: elapsedNow }))
      await supabase.from('track_races').update({ running: false, started_at: null, accumulated_ms: elapsedNow }).eq('id', race.id)
    }
  }

  async function resetRace() {
    const confirmed = window.confirm('Reset this race? This clears the clock and permanently deletes every recorded time. This cannot be undone.')
    if (!confirmed) return

    setLocalRace((prev) => ({ ...prev, running: false, started_at: null, accumulated_ms: 0 }))
    setLocalPendingSplits([])
    setRemovedIds(new Set())
    clearQueue(queueKey)
    setQueueCount(0)

    await supabase.from('track_races').update({ running: false, started_at: null, accumulated_ms: 0 }).eq('id', race.id)
    await supabase.from('track_splits').delete().eq('track_race_id', race.id)
  }

  const activeCheckpoint = sortedCheckpoints.find((c) => c.id === activeCheckpointId)
  const activeIndex = sortedCheckpoints.findIndex((c) => c.id === activeCheckpointId)
  const prevCheckpoint = activeIndex > 0 ? sortedCheckpoints[activeIndex - 1] : null

  const splitsForActive = splits.filter((s) => s.checkpoint_id === activeCheckpointId)
  const confirmedAthleteIdsActive = new Set(splitsForActive.map((s) => s.athlete_id))
  const visibleConfirmed = splitsForActive.filter((s) => !removedIds.has(s.id))
  const visiblePending = localPendingSplits.filter((p) => p.checkpoint_id === activeCheckpointId && !confirmedAthleteIdsActive.has(p.athlete_id))
  const finishedInOrder = [...visibleConfirmed, ...visiblePending].sort((a, b) => a.recorded_time_ms - b.recorded_time_ms)
  const finishedAthleteIds = new Set(finishedInOrder.map((s) => s.athlete_id))

  let waiting = raceAthletes.filter((a) => !finishedAthleteIds.has(a.id))
  if (prevCheckpoint) {
    const prevTimes = {}
    splits.filter((s) => s.checkpoint_id === prevCheckpoint.id).forEach((s) => {
      prevTimes[s.athlete_id] = s.recorded_time_ms
    })
    waiting = [...waiting].sort((a, b) => {
      const aHas = prevTimes[a.id] != null
      const bHas = prevTimes[b.id] != null
      if (aHas && bHas) return prevTimes[a.id] - prevTimes[b.id]
      if (aHas) return -1
      if (bHas) return 1
      return a.sort_order - b.sort_order
    })
  }

  function recordFinish(athlete) {
    if (!localRace.running || !activeCheckpoint) return
    const time = computeElapsed(localRace)
    playTapConfirmation()

    const splitRow = {
      id: crypto.randomUUID(),
      track_race_id: race.id,
      athlete_id: athlete.id,
      checkpoint_id: activeCheckpoint.id,
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

  function checkpointCount(cp) {
    return splits.filter((s) => s.checkpoint_id === cp.id).length
  }

  // --- Goal pace panel -----------------------------------------------------------
  const allVisibleSplits = [...splits.filter((s) => !removedIds.has(s.id)), ...localPendingSplits]
  const checkpointById = {}
  sortedCheckpoints.forEach((c) => {
    checkpointById[c.id] = c
  })

  const goalRows = raceAthletes
    .filter((a) => a.goal_time_ms)
    .map((athlete) => {
      const athleteSplits = allVisibleSplits
        .filter((s) => s.athlete_id === athlete.id)
        .map((s) => ({ ...s, cp: checkpointById[s.checkpoint_id] }))
        .filter((s) => s.cp)
        .sort((a, b) => a.cp.sort_order - b.cp.sort_order)

      const last = athleteSplits[athleteSplits.length - 1]
      const lastCumulativeMs = last ? last.recorded_time_ms : 0
      const lastDistanceM = last ? last.cp.distance_m : 0

      const nextCheckpoint = sortedCheckpoints.find((c) => c.distance_m > lastDistanceM)
      const totalDistance = race.event_distance_m

      const finished = lastDistanceM >= totalDistance
      if (finished) {
        const diff = lastCumulativeMs - athlete.goal_time_ms
        return { athlete, finished: true, diff }
      }

      if (!nextCheckpoint) return { athlete, finished: false, noNextCheckpoint: true }

      const remainingTime = athlete.goal_time_ms - lastCumulativeMs
      const remainingDistance = totalDistance - lastDistanceM
      const goalReachable = remainingTime > 0

      const requiredSegmentMs = goalReachable ? (remainingTime / remainingDistance) * (nextCheckpoint.distance_m - lastDistanceM) : null

      const prevTargetCumulative = last ? originalTargetCumulative(last.cp, athlete.goal_time_ms, totalDistance) : 0
      const nextTargetCumulative = originalTargetCumulative(nextCheckpoint, athlete.goal_time_ms, totalDistance)
      const originalTargetSegmentMs = nextTargetCumulative - (prevTargetCumulative || 0)

      // Flag unrealistic if the pace now needed is meaningfully faster than their
      // best actual lap so far this race (more than 3s quicker), or if the goal
      // is already out of reach given the clock.
      const actualSegments = athleteSplits.map((s, i) => (i === 0 ? s.recorded_time_ms : s.recorded_time_ms - athleteSplits[i - 1].recorded_time_ms))
      const bestActualSegmentMs = actualSegments.length ? Math.min(...actualSegments) : null
      const unrealistic = !goalReachable || (bestActualSegmentMs != null && requiredSegmentMs != null && requiredSegmentMs < bestActualSegmentMs - 3000)

      return {
        athlete,
        finished: false,
        nextCheckpoint,
        requiredSegmentMs,
        originalTargetSegmentMs,
        goalReachable,
        unrealistic,
      }
    })

  return (
    <div>
      <div className="text-center py-4">
        <div className="text-5xl font-semibold tabular-nums">{formatTime(elapsed)}</div>
        {race.event_label && <div className="text-xs text-gray-400 mt-1">{race.event_label}</div>}
      </div>

      {isOwner && (
        <div className="flex gap-2 justify-center mb-4">
          <button onClick={handleStartStop} className="min-w-[100px] border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium">
            {localRace.running ? 'Stop' : elapsed > 0 ? 'Resume' : 'Start'}
          </button>
          <button onClick={resetRace} className="border border-red-300 text-red-600 rounded-lg px-4 py-2 text-sm font-medium">
            Reset race
          </button>
        </div>
      )}

      {goalRows.length > 0 && (
        <div className="mb-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Goal pace</h2>
          <ul className="space-y-2">
            {goalRows.map((row) => (
              <li key={row.athlete.id} className="border border-gray-200 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>{row.athlete.name}</span>
                  <span className="text-xs text-gray-400">Goal {formatTime(row.athlete.goal_time_ms)}</span>
                </div>
                {row.finished ? (
                  <div className={`text-xs mt-1 ${row.diff <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {row.diff <= 0 ? `Hit goal, ${formatTime(Math.abs(row.diff))} to spare` : `Missed goal by ${formatTime(row.diff)}`}
                  </div>
                ) : row.noNextCheckpoint ? (
                  <div className="text-xs text-gray-400 mt-1">No checkpoints remaining</div>
                ) : (
                  <div className={`text-xs mt-1 ${row.unrealistic ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                    {row.goalReachable ? (
                      <>
                        Needs <span className="font-semibold">{formatTime(row.requiredSegmentMs)}</span> to {row.nextCheckpoint.label}
                        {row.originalTargetSegmentMs != null && (
                          <span className="text-gray-400"> (target was {formatTime(row.originalTargetSegmentMs)})</span>
                        )}
                        {row.unrealistic && <span className="block">Faster than anything they've run so far this race</span>}
                      </>
                    ) : (
                      'Goal time already out of reach at current pace'
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
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
              {cp.label} ({checkpointCount(cp)}/{raceAthletes.length})
            </button>
          ))}
        </div>
      )}

      {isOwner && (
        <>
          <div className="bg-gray-900 text-white rounded-lg px-4 py-3 mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-300">Recording at</div>
              <div className="text-2xl font-bold leading-tight">{activeCheckpoint?.label || '—'}</div>
            </div>
            <button onClick={undoLast} disabled={finishedInOrder.length === 0} className="text-xs text-gray-300 underline disabled:opacity-40">
              Undo
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-2">Tap a name below as each runner reaches this point</p>

          {queueCount > 0 && (
            <div className="flex items-center justify-between bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mb-3 text-xs text-yellow-800">
              <span>{queueCount} tap{queueCount === 1 ? '' : 's'} waiting to sync — nothing is lost, will send automatically once you have signal</span>
              <button onClick={flushQueueNow} className="underline whitespace-nowrap ml-2">
                Retry now
              </button>
            </div>
          )}

          <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-6">
            {waiting.length === 0 ? (
              <li className="px-3 py-3 text-sm text-gray-400">Everyone has come through.</li>
            ) : (
              waiting.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => recordFinish(a)}
                    disabled={!localRace.running}
                    className="w-full text-left px-3 py-3 text-sm hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    {a.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-gray-700">
          {activeCheckpoint?.label || 'Results'} ({finishedInOrder.length})
        </h2>
      </div>
      <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        {finishedInOrder.length === 0 ? (
          <li className="px-3 py-3 text-sm text-gray-400">No times yet.</li>
        ) : (
          finishedInOrder.map((s, i) => {
            const athlete = raceAthletes.find((a) => a.id === s.athlete_id)
            return (
              <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>
                  <span className="text-gray-400 mr-2">{i + 1}.</span>
                  {athlete?.name || 'Athlete'}
                </span>
                <span className="tabular-nums font-medium">{formatTime(s.recorded_time_ms)}</span>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
