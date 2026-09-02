import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { formatTime, downloadCSV, downloadReportCSV, buildReportRows } from '../lib/csv'

const CHECKPOINT_PRESETS = ['1000m', '2000m', '3000m', '4000m', '1mi', '2mi', '3mi', 'Finish']

export default function RacePage({ session }) {
  const { raceId } = useParams()
  const [race, setRace] = useState(null)
  const [teamAthletes, setTeamAthletes] = useState([])
  const [raceAthletes, setRaceAthletes] = useState([])
  const [checkpoints, setCheckpoints] = useState([])
  const [splits, setSplits] = useState([])
  const [isParticipant, setIsParticipant] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showReport, setShowReport] = useState(false)

  const isOwner = session && race && race.coach_id === session.user.id
  const canRecord = isOwner || isParticipant

  useEffect(() => {
    loadAll()

    const channel = supabase
      .channel(`race-${raceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'coaches_clock', table: 'splits', filter: `race_id=eq.${raceId}` },
        () => loadSplits()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'coaches_clock', table: 'athletes', filter: `race_id=eq.${raceId}` },
        () => loadRaceAthletes()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'coaches_clock', table: 'checkpoints', filter: `race_id=eq.${raceId}` },
        () => loadCheckpoints()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'coaches_clock', table: 'races', filter: `id=eq.${raceId}` },
        () => loadRace()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [raceId])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadRace(), loadRaceAthletes(), loadCheckpoints(), loadSplits(), loadParticipation()])
    setLoading(false)
  }

  async function loadRace() {
    const { data } = await supabase.from('races').select('*').eq('id', raceId).single()
    setRace(data)
    if (data && data.coach_id === session?.user?.id) {
      const { data: team } = await supabase
        .from('team_athletes')
        .select('*')
        .order('name', { ascending: true })
      if (team) setTeamAthletes(team)
    }
  }

  async function loadParticipation() {
    if (!session) return
    const { data } = await supabase
      .from('race_coaches')
      .select('id')
      .eq('race_id', raceId)
      .eq('coach_id', session.user.id)
      .maybeSingle()
    setIsParticipant(!!data)
  }

  async function loadRaceAthletes() {
    const { data } = await supabase
      .from('athletes')
      .select('*')
      .eq('race_id', raceId)
      .order('sort_order', { ascending: true })
    if (data) setRaceAthletes(data)
  }

  async function loadCheckpoints() {
    const { data } = await supabase
      .from('checkpoints')
      .select('*')
      .eq('race_id', raceId)
      .order('sort_order', { ascending: true })
    if (data) setCheckpoints(data)
  }

  async function loadSplits() {
    const { data } = await supabase
      .from('splits')
      .select('*')
      .eq('race_id', raceId)
      .order('recorded_time_ms', { ascending: true })
    if (data) setSplits(data)
  }

  if (loading || !race) return <p className="text-center py-8 text-sm text-gray-500">Loading...</p>

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      {session && (
        <Link to="/" className="text-sm text-gray-500 underline">
          &larr; All races
        </Link>
      )}
      <h1 className="text-xl font-semibold mt-2 mb-1">{race.name}</h1>

      {isOwner && race.status === 'setup' && (
        <RaceSetup race={race} teamAthletes={teamAthletes} onStarted={loadAll} />
      )}

      {race.status !== 'setup' && !showReport && (
        <RaceLive
          race={race}
          raceAthletes={raceAthletes}
          checkpoints={checkpoints}
          splits={splits}
          isOwner={isOwner}
          canRecord={canRecord}
          session={session}
          onViewReport={() => setShowReport(true)}
        />
      )}

      {race.status !== 'setup' && showReport && (
        <RaceReport
          race={race}
          raceAthletes={raceAthletes}
          checkpoints={checkpoints}
          splits={splits}
          onBack={() => setShowReport(false)}
        />
      )}
    </div>
  )
}

function RaceSetup({ race, teamAthletes, onStarted }) {
  const [roster, setRoster] = useState([]) // { key, team_athlete_id, name, bib }
  const [oneOffName, setOneOffName] = useState('')
  const [checkpointList, setCheckpointList] = useState([]) // { key, label }
  const [customCheckpoint, setCustomCheckpoint] = useState('')
  const [starting, setStarting] = useState(false)
  const [copied, setCopied] = useState(false)

  function isSelected(teamAthleteId) {
    return roster.some((r) => r.team_athlete_id === teamAthleteId)
  }

  function toggleTeamAthlete(a) {
    if (isSelected(a.id)) {
      setRoster(roster.filter((r) => r.team_athlete_id !== a.id))
    } else {
      setRoster([...roster, { key: a.id, team_athlete_id: a.id, name: a.name, bib: a.bib }])
    }
  }

  function addOneOff(e) {
    e.preventDefault()
    if (!oneOffName.trim()) return
    setRoster([
      ...roster,
      { key: `oneoff-${Date.now()}`, team_athlete_id: null, name: oneOffName.trim(), bib: null },
    ])
    setOneOffName('')
  }

  function move(index, dir) {
    const next = [...roster]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setRoster(next)
  }

  function remove(key) {
    setRoster(roster.filter((r) => r.key !== key))
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

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(race.join_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  async function startRace() {
    if (roster.length === 0) return
    setStarting(true)

    const athleteRows = roster.map((r, i) => ({
      race_id: race.id,
      team_athlete_id: r.team_athlete_id,
      name: r.name,
      bib: r.bib,
      sort_order: i,
    }))

    // Default to a single Finish checkpoint if the coach didn't set any up -
    // keeps the simple single-coach case friction-free.
    const checkpointRows =
      checkpointList.length > 0
        ? checkpointList.map((c, i) => ({ race_id: race.id, label: c.label, sort_order: i }))
        : [{ race_id: race.id, label: 'Finish', sort_order: 0 }]

    await supabase.from('athletes').insert(athleteRows)
    await supabase.from('checkpoints').insert(checkpointRows)
    await supabase.from('races').update({ status: 'live' }).eq('id', race.id)
    setStarting(false)
    onStarted()
  }

  return (
    <div>
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-6 flex items-center gap-2">
        <span className="text-xs text-gray-500">Share this code so other coaches can join:</span>
        <span className="text-sm font-mono font-semibold tracking-wider">{race.join_code}</span>
        <button onClick={copyCode} className="text-xs text-gray-500 underline ml-auto">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        Pick who's running this race, then arrange your expected finish order.
      </p>

      {teamAthletes.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-medium text-gray-700 mb-2">Team roster</h2>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
            {teamAthletes.map((a) => (
              <label key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                <input type="checkbox" checked={isSelected(a.id)} onChange={() => toggleTeamAthlete(a)} />
                <span>
                  {a.name}
                  {a.bib && <span className="text-gray-400 ml-2">#{a.bib}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={addOneOff} className="flex gap-2 mb-6">
        <input
          type="text"
          placeholder="Add a runner not on your roster"
          value={oneOffName}
          onChange={(e) => setOneOffName(e.target.value)}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <button className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium">Add</button>
      </form>

      <h2 className="text-sm font-medium text-gray-700 mb-2">Expected finish order ({roster.length})</h2>
      {roster.length === 0 ? (
        <p className="text-sm text-gray-400 mb-6">Select athletes above to build the order.</p>
      ) : (
        <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-6">
          {roster.map((r, i) => (
            <li key={r.key} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="text-gray-400 w-5">{i + 1}</span>
              <span className="flex-1">{r.name}</span>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-400 disabled:opacity-30 px-1" aria-label="Move up">
                ↑
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === roster.length - 1}
                className="text-gray-400 disabled:opacity-30 px-1"
                aria-label="Move down"
              >
                ↓
              </button>
              <button onClick={() => remove(r.key)} className="text-gray-400 hover:text-red-600 px-1" aria-label="Remove">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="text-sm font-medium text-gray-700 mb-2">Checkpoints</h2>
      <p className="text-xs text-gray-500 mb-2">
        Optional. Add a checkpoint for every spot on the course a coach will be timing from, in
        order. Leave empty for a simple single finish-line race.
      </p>
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
              <button
                onClick={() => moveCheckpoint(i, -1)}
                disabled={i === 0}
                className="text-gray-400 disabled:opacity-30 px-1"
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                onClick={() => moveCheckpoint(i, 1)}
                disabled={i === checkpointList.length - 1}
                className="text-gray-400 disabled:opacity-30 px-1"
                aria-label="Move down"
              >
                ↓
              </button>
              <button
                onClick={() => removeCheckpoint(c.key)}
                className="text-gray-400 hover:text-red-600 px-1"
                aria-label="Remove"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={startRace}
        disabled={roster.length === 0 || starting}
        className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
      >
        {starting ? 'Starting...' : 'Start race'}
      </button>
    </div>
  )
}

function computeElapsed(raceLike) {
  if (!raceLike) return 0
  const base = raceLike.accumulated_ms || 0
  if (raceLike.running && raceLike.started_at) {
    return base + (Date.now() - new Date(raceLike.started_at).getTime())
  }
  return base
}

function RaceLive({ race, raceAthletes, checkpoints, splits, isOwner, canRecord, session, onViewReport }) {
  const sortedCheckpoints = [...checkpoints].sort((a, b) => a.sort_order - b.sort_order)
  const [activeCheckpointId, setActiveCheckpointId] = useState(null)
  const rafRef = useRef(null)

  // Local optimistic mirror of the shared race clock, so the device that
  // clicked Start/Stop/Reset feels instant while other devices sync via realtime.
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
    if (!activeCheckpointId && sortedCheckpoints.length > 0) {
      setActiveCheckpointId(sortedCheckpoints[sortedCheckpoints.length - 1].id)
    }
  }, [checkpoints.length])

  const [pendingSplits, setPendingSplits] = useState([]) // { id, athlete_id, checkpoint_id, label, recorded_time_ms }
  const [removedIds, setRemovedIds] = useState(new Set())
  const inFlightRef = useRef({}) // tempId -> { cancelled, realId }

  async function handleStartStop() {
    if (!localRace.running) {
      const started_at = new Date().toISOString()
      setLocalRace((prev) => ({ ...prev, running: true, started_at }))
      await supabase.from('races').update({ running: true, started_at }).eq('id', race.id)
    } else {
      const elapsedNow = computeElapsed(localRace)
      setLocalRace((prev) => ({ ...prev, running: false, started_at: null, accumulated_ms: elapsedNow }))
      await supabase
        .from('races')
        .update({ running: false, started_at: null, accumulated_ms: elapsedNow })
        .eq('id', race.id)
    }
  }

  async function resetRace() {
    const confirmed = window.confirm(
      'Reset this race? This clears the clock and permanently deletes every recorded time at every checkpoint. This cannot be undone.'
    )
    if (!confirmed) return

    setLocalRace((prev) => ({ ...prev, running: false, started_at: null, accumulated_ms: 0 }))
    setPendingSplits([])
    setRemovedIds(new Set())
    inFlightRef.current = {}

    await supabase.from('races').update({ running: false, started_at: null, accumulated_ms: 0 }).eq('id', race.id)
    await supabase.from('splits').delete().eq('race_id', race.id)
  }

  const activeCheckpoint = sortedCheckpoints.find((c) => c.id === activeCheckpointId)
  const activeIndex = sortedCheckpoints.findIndex((c) => c.id === activeCheckpointId)
  const prevCheckpoint = activeIndex > 0 ? sortedCheckpoints[activeIndex - 1] : null

  const splitsForActive = splits.filter((s) => s.checkpoint_id === activeCheckpointId)
  const confirmedAthleteIdsActive = new Set(splitsForActive.map((s) => s.athlete_id))
  const visibleConfirmed = splitsForActive.filter((s) => !removedIds.has(s.id))
  const visiblePending = pendingSplits.filter(
    (p) => p.checkpoint_id === activeCheckpointId && !confirmedAthleteIdsActive.has(p.athlete_id)
  )
  const finishedInOrder = [...visibleConfirmed, ...visiblePending].sort(
    (a, b) => a.recorded_time_ms - b.recorded_time_ms
  )
  const finishedAthleteIds = new Set(finishedInOrder.map((s) => s.athlete_id))

  // Order the waiting list by whoever already reached the previous checkpoint first;
  // runners with no prior-checkpoint time yet fall back to the original predicted order.
  let waiting = raceAthletes.filter((a) => !finishedAthleteIds.has(a.id))
  if (prevCheckpoint) {
    const prevTimes = {}
    splits
      .filter((s) => s.checkpoint_id === prevCheckpoint.id)
      .forEach((s) => {
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

  async function recordFinish(athlete) {
    if (!localRace.running || !activeCheckpoint) return
    const time = computeElapsed(localRace)
    const tempId = `pending-${athlete.id}-${Date.now()}`
    inFlightRef.current[tempId] = { cancelled: false, realId: null }
    setPendingSplits((prev) => [
      ...prev,
      {
        id: tempId,
        athlete_id: athlete.id,
        checkpoint_id: activeCheckpoint.id,
        label: athlete.name,
        recorded_time_ms: time,
      },
    ])

    const { data, error } = await supabase
      .from('splits')
      .insert({
        race_id: race.id,
        athlete_id: athlete.id,
        checkpoint_id: activeCheckpoint.id,
        label: athlete.name,
        recorded_time_ms: time,
      })
      .select()
      .single()

    const flight = inFlightRef.current[tempId]

    if (error) {
      setPendingSplits((prev) => prev.filter((p) => p.id !== tempId))
      delete inFlightRef.current[tempId]
      return
    }

    if (flight?.cancelled) {
      await supabase.from('splits').delete().eq('id', data.id)
      setPendingSplits((prev) => prev.filter((p) => p.id !== tempId))
      delete inFlightRef.current[tempId]
      return
    }

    if (flight) flight.realId = data.id
  }

  async function undoLast() {
    if (finishedInOrder.length === 0) return
    const last = finishedInOrder[finishedInOrder.length - 1]

    if (String(last.id).startsWith('pending-')) {
      const flight = inFlightRef.current[last.id]
      setPendingSplits((prev) => prev.filter((p) => p.id !== last.id))
      if (flight?.realId) {
        await supabase.from('splits').delete().eq('id', flight.realId)
        delete inFlightRef.current[last.id]
      } else if (flight) {
        flight.cancelled = true
      }
    } else {
      setRemovedIds((prev) => new Set(prev).add(last.id))
      const { error } = await supabase.from('splits').delete().eq('id', last.id)
      if (error) {
        setRemovedIds((prev) => {
          const next = new Set(prev)
          next.delete(last.id)
          return next
        })
      }
    }
  }

  function checkpointCount(cp) {
    return splits.filter((s) => s.checkpoint_id === cp.id).length
  }

  return (
    <div>
      {isOwner && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 mb-4 flex items-center gap-2">
          <span className="text-xs text-gray-500">Join code:</span>
          <span className="text-sm font-mono font-semibold tracking-wider">{race.join_code}</span>
        </div>
      )}

      <div className="text-center py-4">
        <div className="text-5xl font-semibold tabular-nums">{formatTime(elapsed)}</div>
      </div>

      {isOwner && (
        <div className="flex gap-2 justify-center mb-4">
          <button onClick={handleStartStop} className="min-w-[100px] border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium">
            {localRace.running ? 'Stop' : elapsed > 0 ? 'Resume' : 'Start'}
          </button>
          <button
            onClick={resetRace}
            className="border border-red-300 text-red-600 rounded-lg px-4 py-2 text-sm font-medium"
          >
            Reset race
          </button>
        </div>
      )}

      {sortedCheckpoints.length > 1 && (
        <div className="flex gap-2 overflow-x-auto mb-4 pb-1">
          {sortedCheckpoints.map((cp) => (
            <button
              key={cp.id}
              onClick={() => setActiveCheckpointId(cp.id)}
              className={`whitespace-nowrap text-xs px-3 py-1.5 rounded-full border ${
                cp.id === activeCheckpointId
                  ? 'bg-gray-900 text-white border-gray-900 font-medium'
                  : 'border-gray-300 text-gray-500'
              }`}
            >
              {cp.label} ({checkpointCount(cp)}/{raceAthletes.length})
            </button>
          ))}
        </div>
      )}

      {canRecord && (
        <>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-gray-700">
              Recording at: {activeCheckpoint?.label || '—'}
            </h2>
            <button
              onClick={undoLast}
              disabled={finishedInOrder.length === 0}
              className="text-xs text-gray-500 underline disabled:opacity-40"
            >
              Undo
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-2">Tap a name below as each runner reaches this point</p>

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
                    {a.bib && <span className="text-gray-400 ml-2">#{a.bib}</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}

      {!canRecord && session && (
        <p className="text-xs text-gray-400 mb-4">
          Helping time this race?{' '}
          <Link to="/join" className="underline">
            Enter the join code
          </Link>{' '}
          to record times.
        </p>
      )}

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-gray-700">
          {activeCheckpoint?.label || 'Results'} ({finishedInOrder.length})
        </h2>
        {finishedInOrder.length > 0 && (
          <button onClick={() => downloadCSV(`${race.name} - ${activeCheckpoint?.label}`, finishedInOrder)} className="text-xs text-gray-500 underline">
            Export CSV
          </button>
        )}
      </div>

      {finishedInOrder.length === 0 ? (
        <p className="text-sm text-gray-400 mb-6">No times recorded yet at this checkpoint.</p>
      ) : (
        <table className="w-full text-sm mb-6">
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

      <button onClick={onViewReport} className="w-full border border-gray-300 rounded-lg py-2 text-sm font-medium">
        View full report (splits + finish times)
      </button>

      {!session && (
        <p className="text-xs text-gray-400 mt-6">Live results — this page updates automatically as finishers are recorded.</p>
      )}
    </div>
  )
}

function RaceReport({ race, raceAthletes, checkpoints, splits, onBack }) {
  const { sortedCheckpoints, rows } = buildReportRows(checkpoints, raceAthletes, splits)

  return (
    <div>
      <button onClick={onBack} className="text-sm text-gray-500 underline mb-4">
        &larr; Back to race
      </button>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Full report</h2>
        <button
          onClick={() => downloadReportCSV(race.name, checkpoints, raceAthletes, splits)}
          className="text-xs text-gray-500 underline"
        >
          Download CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left py-2 pr-4 sticky left-0 bg-white">Runner</th>
              {sortedCheckpoints.map((cp) => (
                <th key={cp.id} colSpan={2} className="text-center py-2 px-2 border-l border-gray-100">
                  {cp.label}
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky left-0 bg-white"></th>
              {sortedCheckpoints.map((cp) => (
                <>
                  <th key={`${cp.id}-time`} className="text-xs font-normal text-gray-400 px-2 border-l border-gray-100">
                    Time
                  </th>
                  <th key={`${cp.id}-split`} className="text-xs font-normal text-gray-400 px-2">
                    Split
                  </th>
                </>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ athlete, checkpointCells }) => (
              <tr key={athlete.id} className="border-t border-gray-100">
                <td className="py-2 pr-4 font-medium sticky left-0 bg-white">{athlete.name}</td>
                {checkpointCells.map((c) => (
                  <>
                    <td key={`${c.checkpointId}-time`} className="text-right tabular-nums px-2 border-l border-gray-100">
                      {formatTime(c.cumulative)}
                    </td>
                    <td key={`${c.checkpointId}-split`} className="text-right tabular-nums px-2 text-gray-500">
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
  )
}
