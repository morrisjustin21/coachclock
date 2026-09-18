import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { formatTime, downloadCSV } from '../lib/csv'
import { enqueue, dequeue, getQueued, clearQueue } from '../lib/offlineQueue'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const CHECKPOINT_PRESETS = ['1000m', '2000m', '3000m', '4000m', '1mi', '2mi', '3mi', 'Finish']

export default function RacePage({ session }) {
  const { raceId } = useParams()
  const [race, setRace] = useState(null)
  const [team, setTeam] = useState(null)
  const [teamAthletes, setTeamAthletes] = useState([])
  const [raceAthletes, setRaceAthletes] = useState([])
  const [checkpoints, setCheckpoints] = useState([])
  const [splits, setSplits] = useState([])
  const [isParticipant, setIsParticipant] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showReport, setShowReport] = useState(false)
  const [showCheckin, setShowCheckin] = useState(false)

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
        ? query.eq('team_id', data.team_id) // whole team's shared roster for this race's team
        : query.is('team_id', null).eq('coach_id', session.user.id) // solo race - just your untagged athletes
      const { data: rosterRows } = await query
      if (rosterRows) setTeamAthletes(rosterRows)
    }
  }

  async function loadParticipation() {
    if (!session) return

    const { data: raceRow } = await supabase.from('races').select('team_id').eq('id', raceId).maybeSingle()

    const { data: raceCoachRow } = await supabase
      .from('race_coaches')
      .select('id')
      .eq('race_id', raceId)
      .eq('coach_id', session.user.id)
      .maybeSingle()

    let isTeamMember = false
    if (raceRow?.team_id) {
      const { data: teamMemberRow } = await supabase
        .from('team_members')
        .select('id')
        .eq('team_id', raceRow.team_id)
        .eq('coach_id', session.user.id)
        .maybeSingle()
      isTeamMember = !!teamMemberRow
    }

    setIsParticipant(!!raceCoachRow || isTeamMember)
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

      {canRecord && race.status !== 'setup' && (
        <button
          onClick={() => setShowCheckin((v) => !v)}
          className="text-xs text-gray-500 underline mb-4"
        >
          {showCheckin ? '← Back to race' : 'Check-in sheet'}
        </button>
      )}

      {showCheckin && canRecord && race.status !== 'setup' ? (
        <RaceCheckin raceAthletes={raceAthletes} />
      ) : (
        <>
          {isOwner && race.status === 'setup' && (
            <RaceSetup race={race} teamAthletes={teamAthletes} onStarted={loadAll} session={session} />
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
              team={team}
              raceAthletes={raceAthletes}
              checkpoints={checkpoints}
              splits={splits}
              onBack={() => setShowReport(false)}
            />
          )}
        </>
      )}
    </div>
  )
}

function SortableRosterRow({ item, index, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 'auto',
    position: 'relative',
  }

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2 px-3 py-2 text-sm bg-white">
      <span className="text-gray-400 w-5">{index + 1}</span>
      <button
        {...attributes}
        {...listeners}
        className="text-gray-400 cursor-grab active:cursor-grabbing px-1 touch-none"
        aria-label="Drag to reorder"
      >
        ⠿
      </button>
      <span className="flex-1">{item.name}</span>
      <button onClick={() => onRemove(item.key)} className="text-gray-400 hover:text-red-600 px-1" aria-label="Remove">
        ✕
      </button>
    </li>
  )
}

function RaceSetup({ race, teamAthletes, onStarted, session }) {
  const [roster, setRoster] = useState([]) // { key, team_athlete_id, name, bib }
  const [oneOffName, setOneOffName] = useState('')
  const [checkpointList, setCheckpointList] = useState([]) // { key, label }
  const [customCheckpoint, setCustomCheckpoint] = useState('')
  const [starting, setStarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [predictedTimes, setPredictedTimes] = useState({}) // team_athlete_id -> { time, raceId }

  useEffect(() => {
    loadPredictedOrder()
  }, [])

  async function loadPredictedOrder() {
    if (!session) return

    const { data: races } = await supabase
      .from('races')
      .select('id, created_at')
      .eq('coach_id', session.user.id)
      .order('created_at', { ascending: false })
    if (!races || races.length === 0) return

    const raceIds = races.map((r) => r.id)
    const raceRecency = {}
    races.forEach((r, i) => {
      raceRecency[r.id] = i // 0 = most recent
    })

    const [{ data: pastAthletes }, { data: pastCheckpoints }, { data: pastSplits }] = await Promise.all([
      supabase.from('athletes').select('id, race_id, team_athlete_id').in('race_id', raceIds),
      supabase.from('checkpoints').select('id, race_id, sort_order').in('race_id', raceIds),
      supabase.from('splits').select('athlete_id, race_id, checkpoint_id, recorded_time_ms').in('race_id', raceIds),
    ])
    if (!pastAthletes || !pastCheckpoints || !pastSplits) return

    // Find each past race's final checkpoint (highest sort_order)
    const lastCheckpointByRace = {}
    const lastSortOrderByRace = {}
    pastCheckpoints.forEach((cp) => {
      if (lastSortOrderByRace[cp.race_id] === undefined || cp.sort_order > lastSortOrderByRace[cp.race_id]) {
        lastSortOrderByRace[cp.race_id] = cp.sort_order
        lastCheckpointByRace[cp.race_id] = cp.id
      }
    })

    // Map each race-specific athlete row back to the team roster athlete it came from
    const athleteRowToTeamId = {}
    pastAthletes.forEach((a) => {
      athleteRowToTeamId[a.id] = a.team_athlete_id
    })

    const finishSplits = pastSplits.filter((s) => s.checkpoint_id === lastCheckpointByRace[s.race_id])

    const predicted = {}
    finishSplits.forEach((s) => {
      const teamId = athleteRowToTeamId[s.athlete_id]
      if (!teamId) return
      const existing = predicted[teamId]
      if (!existing || raceRecency[s.race_id] < raceRecency[existing.raceId]) {
        predicted[teamId] = { time: s.recorded_time_ms, raceId: s.race_id }
      }
    })

    setPredictedTimes(predicted)
  }

  // Insert a new roster entry into its predicted-order position based on past
  // finish times, without disturbing any positions the coach has manually
  // dragged already. Athletes with no race history go to the end.
  function insertByPredictedOrder(list, item) {
    const newTime = predictedTimes[item.team_athlete_id]?.time
    if (newTime == null) return [...list, item]
    let insertIndex = list.length
    for (let i = 0; i < list.length; i++) {
      const t = predictedTimes[list[i].team_athlete_id]?.time
      if (t == null || t > newTime) {
        insertIndex = i
        break
      }
    }
    const next = [...list]
    next.splice(insertIndex, 0, item)
    return next
  }

  function isSelected(teamAthleteId) {
    return roster.some((r) => r.team_athlete_id === teamAthleteId)
  }

  const allTeamSelected = teamAthletes.length > 0 && teamAthletes.every((a) => isSelected(a.id))

  function toggleSelectAll() {
    if (allTeamSelected) {
      setRoster(roster.filter((r) => r.team_athlete_id === null))
    } else {
      const missing = teamAthletes
        .filter((a) => !isSelected(a.id))
        .map((a) => ({ key: a.id, team_athlete_id: a.id, name: a.name, bib: a.bib }))
        // Add fastest-known-first so they slot in relative to each other correctly
        .sort((a, b) => {
          const ta = predictedTimes[a.team_athlete_id]?.time
          const tb = predictedTimes[b.team_athlete_id]?.time
          if (ta == null && tb == null) return 0
          if (ta == null) return 1
          if (tb == null) return -1
          return ta - tb
        })
      let next = roster
      missing.forEach((item) => {
        next = insertByPredictedOrder(next, item)
      })
      setRoster(next)
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleRosterDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setRoster((prev) => {
      const oldIndex = prev.findIndex((r) => r.key === active.id)
      const newIndex = prev.findIndex((r) => r.key === over.id)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  function toggleTeamAthlete(a) {
    if (isSelected(a.id)) {
      setRoster(roster.filter((r) => r.team_athlete_id !== a.id))
    } else {
      setRoster(insertByPredictedOrder(roster, { key: a.id, team_athlete_id: a.id, name: a.name, bib: a.bib }))
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
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-gray-700">Team roster</h2>
            <button onClick={toggleSelectAll} className="text-xs text-gray-500 underline">
              {allTeamSelected ? 'Deselect all' : 'Select all'}
            </button>
          </div>
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
        <p className="text-xs text-gray-400 mb-2">
          {Object.keys(predictedTimes).length > 0
            ? 'Auto-sorted by each runner\'s most recent finish time — drag the ⠿ handle to adjust'
            : 'Drag the ⠿ handle to reorder'}
        </p>
      )}
      {roster.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRosterDragEnd}>
          <SortableContext items={roster.map((r) => r.key)} strategy={verticalListSortingStrategy}>
            <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-6 overflow-hidden">
              {roster.map((r, i) => (
                <SortableRosterRow key={r.key} item={r} index={i} onRemove={remove} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
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
  if (navigator.vibrate) navigator.vibrate(40) // no-op on iOS Safari, works on most Android browsers
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
      setActiveCheckpointId(sortedCheckpoints[0].id)
    }
  }, [checkpoints.length])

  // Personal bests per team_athlete_id + checkpoint label, drawn from every other race
  // in this athlete's history (same team if the race belongs to one, else same coach).
  // Loaded once so PR checks stay purely client-side - no network dependency mid-tap.
  const [personalBests, setPersonalBests] = useState({})

  useEffect(() => {
    loadPersonalBests()
  }, [race.id])

  async function loadPersonalBests() {
    let pastRacesQuery = supabase.from('races').select('id').neq('id', race.id)
    pastRacesQuery = race.team_id
      ? pastRacesQuery.eq('team_id', race.team_id)
      : pastRacesQuery.eq('coach_id', race.coach_id)
    const { data: pastRaces } = await pastRacesQuery
    if (!pastRaces || pastRaces.length === 0) {
      setPersonalBests({})
      return
    }
    const raceIds = pastRaces.map((r) => r.id)

    const [{ data: pastAthletes }, { data: pastCheckpoints }, { data: pastSplits }] = await Promise.all([
      supabase.from('athletes').select('id, team_athlete_id').in('race_id', raceIds),
      supabase.from('checkpoints').select('id, label').in('race_id', raceIds),
      supabase.from('splits').select('athlete_id, checkpoint_id, recorded_time_ms').in('race_id', raceIds),
    ])
    if (!pastAthletes || !pastCheckpoints || !pastSplits) return

    const teamIdByAthleteRow = {}
    pastAthletes.forEach((a) => {
      teamIdByAthleteRow[a.id] = a.team_athlete_id
    })
    const labelByCheckpoint = {}
    pastCheckpoints.forEach((cp) => {
      labelByCheckpoint[cp.id] = cp.label
    })

    const bests = {}
    pastSplits.forEach((s) => {
      const teamAthleteId = teamIdByAthleteRow[s.athlete_id]
      const label = labelByCheckpoint[s.checkpoint_id]
      if (!teamAthleteId || !label) return
      const key = `${teamAthleteId}|${label}`
      if (bests[key] == null || s.recorded_time_ms < bests[key]) {
        bests[key] = s.recorded_time_ms
      }
    })
    setPersonalBests(bests)
  }

  const teamAthleteIdByRaceRow = {}
  raceAthletes.forEach((a) => {
    teamAthleteIdByRaceRow[a.id] = a.team_athlete_id
  })

  function isNewPR(split, checkpointLabel) {
    const teamAthleteId = teamAthleteIdByRaceRow[split.athlete_id]
    if (!teamAthleteId || !checkpointLabel) return false
    const best = personalBests[`${teamAthleteId}|${checkpointLabel}`]
    return best != null && split.recorded_time_ms < best
  }

  const queueKey = `splits-${race.id}`
  const [localPendingSplits, setLocalPendingSplits] = useState(() => getQueued(queueKey).map((q) => q.payload))
  const [removedIds, setRemovedIds] = useState(new Set())
  const [queueCount, setQueueCount] = useState(() => getQueued(queueKey).length)

  // Drop any locally-held tap once the server confirms it (it'll now appear in `splits`)
  useEffect(() => {
    const confirmedIds = new Set(splits.map((s) => s.id))
    setLocalPendingSplits((prev) => prev.filter((p) => !confirmedIds.has(p.id)))
  }, [splits])

  // Retry anything still queued: on mount, whenever connectivity returns, and every
  // few seconds as a fallback in case the 'online' event doesn't fire reliably.
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
          const { error } = await supabase
            .from('splits')
            .upsert(item.payload, { onConflict: 'id', ignoreDuplicates: true })
          ok = !error
        } else if (item.action === 'delete') {
          const { error } = await supabase.from('splits').delete().eq('id', item.payload.id)
          ok = !error
        }
        if (ok) dequeue(queueKey, item.id)
      } catch {
        // still offline or request failed - leave it queued, next flush will retry
      }
    }
    setQueueCount(getQueued(queueKey).length)
  }

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
    setLocalPendingSplits([])
    setRemovedIds(new Set())
    clearQueue(queueKey)
    setQueueCount(0)

    await supabase.from('races').update({ running: false, started_at: null, accumulated_ms: 0 }).eq('id', race.id)
    await supabase.from('splits').delete().eq('race_id', race.id)
  }

  const activeCheckpoint = sortedCheckpoints.find((c) => c.id === activeCheckpointId)
  const activeIndex = sortedCheckpoints.findIndex((c) => c.id === activeCheckpointId)
  const prevCheckpoint = activeIndex > 0 ? sortedCheckpoints[activeIndex - 1] : null

  const splitsForActive = splits.filter((s) => s.checkpoint_id === activeCheckpointId)
  const confirmedAthleteIdsActive = new Set(splitsForActive.map((s) => s.athlete_id))
  const visibleConfirmed = splitsForActive.filter((s) => !removedIds.has(s.id))
  const visiblePending = localPendingSplits.filter(
    (p) => p.checkpoint_id === activeCheckpointId && !confirmedAthleteIdsActive.has(p.athlete_id)
  )
  const finishedInOrder = [...visibleConfirmed, ...visiblePending].sort(
    (a, b) => a.recorded_time_ms - b.recorded_time_ms
  )
  const finishedAthleteIds = new Set(finishedInOrder.map((s) => s.athlete_id))

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

  function recordFinish(athlete) {
    if (!localRace.running || !activeCheckpoint) return
    const time = computeElapsed(localRace)
    playTapConfirmation()

    const splitRow = {
      id: crypto.randomUUID(),
      race_id: race.id,
      athlete_id: athlete.id,
      checkpoint_id: activeCheckpoint.id,
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

    const stillQueuedAsInsert = getQueued(queueKey).some(
      (q) => q.action === 'insert' && q.payload.id === last.id
    )
    if (stillQueuedAsInsert) {
      // Never actually left the device yet - just cancel it, nothing to undo server-side
      dequeue(queueKey, last.id)
    } else {
      // Already sent (or sent before we can be sure) - hide it now and queue a delete
      setRemovedIds((prev) => new Set(prev).add(last.id))
      enqueue(queueKey, { id: `delete-${last.id}`, action: 'delete', payload: { id: last.id } })
      flushQueueNow()
    }
    setQueueCount(getQueued(queueKey).length)
  }

  function checkpointCount(cp) {
    return splits.filter((s) => s.checkpoint_id === cp.id).length
  }

  const [linkCopied, setLinkCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const resultsUrl = typeof window !== 'undefined' ? window.location.href : ''
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(resultsUrl)}`

  async function copyResultsLink() {
    try {
      await navigator.clipboard.writeText(resultsUrl)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div>
      {isOwner && (
        <div className="space-y-2 mb-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 flex items-center gap-2">
            <span className="text-xs text-gray-500">Coach join code:</span>
            <span className="text-sm font-mono font-semibold tracking-wider">{race.join_code}</span>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 flex items-center gap-2">
            <span className="text-xs text-gray-500">Results link for parents &amp; fans:</span>
            <button onClick={copyResultsLink} className="text-xs text-gray-700 underline ml-auto">
              {linkCopied ? 'Copied!' : 'Copy link'}
            </button>
            <button onClick={() => setShowQr((v) => !v)} className="text-xs text-gray-700 underline">
              {showQr ? 'Hide QR' : 'QR code'}
            </button>
          </div>
          {showQr && (
            <div className="flex justify-center py-2">
              <img src={qrSrc} alt="QR code linking to live race results" width={180} height={180} />
            </div>
          )}
          <p className="text-xs text-gray-400 px-1">
            Anyone with this link or QR code can view live results — no account needed, and they can't record times.
          </p>
        </div>
      )}

      <div className="text-center py-4">
        <div className="text-5xl font-semibold tabular-nums">{formatTime(elapsed)}</div>
      </div>

      {canRecord && (
        <div className="flex gap-2 justify-center mb-4">
          <button onClick={handleStartStop} className="min-w-[100px] border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium">
            {localRace.running ? 'Stop' : elapsed > 0 ? 'Resume' : 'Start'}
          </button>
          {isOwner && (
            <button
              onClick={resetRace}
              className="border border-red-300 text-red-600 rounded-lg px-4 py-2 text-sm font-medium"
            >
              Reset race
            </button>
          )}
        </div>
      )}

      {sortedCheckpoints.length > 1 && (
        <div className="flex gap-2 overflow-x-auto mb-4 pb-1">
          {sortedCheckpoints.map((cp) => (
            <button
              key={cp.id}
              onClick={() => setActiveCheckpointId(cp.id)}
              className={`whitespace-nowrap text-sm font-semibold px-4 py-2 rounded-full border-2 ${
                cp.id === activeCheckpointId
                  ? 'bg-gray-900 text-white border-gray-900 shadow-md'
                  : 'border-gray-300 text-gray-600'
              }`}
            >
              {cp.label} ({checkpointCount(cp)}/{raceAthletes.length})
            </button>
          ))}
        </div>
      )}

      {canRecord && (
        <>
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
          <p className="text-xs text-gray-400 mb-2">Tap a name below as each runner reaches this point</p>

          {queueCount > 0 && (
            <div className="flex items-center justify-between bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mb-3 text-xs text-yellow-800">
              <span>
                {queueCount} tap{queueCount === 1 ? '' : 's'} waiting to sync — nothing is lost, will send
                automatically once you have signal
              </span>
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
                <td className="py-2">
                  {s.label}
                  {isNewPR(s, activeCheckpoint?.label) && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                      PR
                    </span>
                  )}
                </td>
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

// ---- Split Sheet report helpers -------------------------------------------------

// Cumulative + segment time for one athlete, across whichever checkpoints they
// actually reached. `totalMs` is the cumulative time at the furthest checkpoint
// they have a recorded split for (their finish, if they finished).
function computeAthleteSegments(athleteRowId, sortedCheckpoints, splits) {
  const cumulativeByCheckpoint = {}
  splits.forEach((s) => {
    if (s.athlete_id === athleteRowId) cumulativeByCheckpoint[s.checkpoint_id] = s.recorded_time_ms
  })
  let prevCumulative = 0
  let totalMs = null
  const segments = sortedCheckpoints.map((cp) => {
    const cumulative = cumulativeByCheckpoint[cp.id]
    if (cumulative == null) return { checkpointId: cp.id, cumulative: null, segment: null }
    const segment = cumulative - prevCumulative
    prevCumulative = cumulative
    totalMs = cumulative
    return { checkpointId: cp.id, cumulative, segment }
  })
  return { segments, totalMs }
}

// Builds the column layout for however many checkpoints this particular race used -
// the report always mirrors whatever the coach actually set up for that race, not a
// fixed mile1/mile2/finish assumption.
function buildSplitSheetColumns(sortedCheckpoints) {
  const n = sortedCheckpoints.length
  const cols = []
  sortedCheckpoints.forEach((cp, i) => {
    if (i === 0) {
      cols.push({ i, kind: 'split', groupLabel: cp.label, sub: 'Split' })
    } else if (i === n - 1) {
      cols.push({ i, kind: 'split', groupLabel: cp.label, sub: 'Split' })
      cols.push({ i, kind: 'diff', groupLabel: cp.label, sub: `${i}–${i + 1} Diff` })
    } else {
      cols.push({ i, kind: 'time', groupLabel: cp.label, sub: 'Time' })
      cols.push({ i, kind: 'split', groupLabel: cp.label, sub: 'Split' })
      cols.push({ i, kind: 'diff', groupLabel: cp.label, sub: `${i}–${i + 1} Diff` })
    }
  })
  return cols
}

function cellForColumn(col, segments) {
  const seg = segments[col.i]
  if (!seg) return null
  if (col.kind === 'time') return seg.cumulative
  if (col.kind === 'split') return seg.segment
  if (col.kind === 'diff') {
    const prevSeg = segments[col.i - 1]
    if (seg.segment == null || !prevSeg || prevSeg.segment == null) return null
    return seg.segment - prevSeg.segment
  }
  return null
}

// Gender lives on team_athletes, not on the race-specific `athletes` rows, so it's
// looked up separately here rather than assumed to be on the roster already
// loaded for the race (a non-owner coach viewing the report may not have that).
function useGenderMap(raceAthletes) {
  const [map, setMap] = useState({})
  const ids = [...new Set(raceAthletes.map((a) => a.team_athlete_id).filter(Boolean))].sort().join(',')
  useEffect(() => {
    if (!ids) {
      setMap({})
      return
    }
    supabase
      .from('team_athletes')
      .select('id, gender')
      .in('id', ids.split(','))
      .then(({ data }) => {
        const m = {}
        ;(data || []).forEach((r) => {
          m[r.id] = r.gender
        })
        setMap(m)
      })
  }, [ids])
  return map
}

// PR (all-time best), SB (best this season) and previous-race total time, per
// athlete, drawn from every other race in their history (same team if this race
// belongs to one, else same coach) - same source pattern used for PR badges in
// RaceLive, just aggregated to a per-race total instead of a per-checkpoint one.
function useSplitSheetHistory(race) {
  const [history, setHistory] = useState({})
  useEffect(() => {
    load()
  }, [race.id])

  async function load() {
    let pastRacesQuery = supabase.from('races').select('id, created_at').neq('id', race.id)
    pastRacesQuery = race.team_id
      ? pastRacesQuery.eq('team_id', race.team_id)
      : pastRacesQuery.eq('coach_id', race.coach_id)
    const { data: pastRaces } = await pastRacesQuery
    if (!pastRaces || pastRaces.length === 0) {
      setHistory({})
      return
    }
    const raceIds = pastRaces.map((r) => r.id)
    const dateByRace = {}
    pastRaces.forEach((r) => {
      dateByRace[r.id] = r.created_at
    })

    const [{ data: pastAthletes }, { data: pastCheckpoints }, { data: pastSplits }] = await Promise.all([
      supabase.from('athletes').select('id, race_id, team_athlete_id').in('race_id', raceIds),
      supabase.from('checkpoints').select('id, race_id, sort_order').in('race_id', raceIds),
      supabase.from('splits').select('athlete_id, checkpoint_id, recorded_time_ms').in('race_id', raceIds),
    ])
    if (!pastAthletes || !pastCheckpoints || !pastSplits) return

    const sortOrderByCheckpoint = {}
    pastCheckpoints.forEach((cp) => {
      sortOrderByCheckpoint[cp.id] = cp.sort_order
    })

    // Furthest checkpoint reached = that athlete's total time for that past race.
    const totalByAthleteRow = {}
    pastSplits.forEach((s) => {
      const sortOrder = sortOrderByCheckpoint[s.checkpoint_id]
      if (sortOrder == null) return
      const cur = totalByAthleteRow[s.athlete_id]
      if (!cur || sortOrder > cur.sortOrder) {
        totalByAthleteRow[s.athlete_id] = { sortOrder, ms: s.recorded_time_ms }
      }
    })

    const byTeamAthlete = {}
    pastAthletes.forEach((a) => {
      const total = totalByAthleteRow[a.id]
      if (!a.team_athlete_id || !total) return
      const list = byTeamAthlete[a.team_athlete_id] || (byTeamAthlete[a.team_athlete_id] = [])
      list.push({ raceId: a.race_id, date: dateByRace[a.race_id], totalMs: total.ms })
    })
    Object.values(byTeamAthlete).forEach((list) => list.sort((x, y) => new Date(x.date) - new Date(y.date)))
    setHistory(byTeamAthlete)
  }

  return history
}

function referenceTimes(history, teamAthleteId, currentRaceDate) {
  const list = teamAthleteId ? history[teamAthleteId] : null
  if (!list || list.length === 0) return { pr: null, sb: null, prevRace: null }
  const pr = Math.min(...list.map((e) => e.totalMs))
  const currentYear = new Date(currentRaceDate).getFullYear()
  const seasonEntries = list.filter((e) => new Date(e.date).getFullYear() === currentYear)
  const sb = seasonEntries.length ? Math.min(...seasonEntries.map((e) => e.totalMs)) : null
  const before = list.filter((e) => new Date(e.date) < new Date(currentRaceDate))
  const prevRace = before.length ? before[before.length - 1].totalMs : null
  return { pr, sb, prevRace }
}

function groupSortedByFinishTime(rows) {
  const finishers = rows.filter((r) => r.totalMs != null).sort((a, b) => a.totalMs - b.totalMs)
  const others = rows.filter((r) => r.totalMs == null)
  return { finishers, all: [...finishers, ...others] }
}

function fmtDiff(ms) {
  if (ms == null) return { text: '—', cls: 'text-gray-300' }
  if (ms === 0) return { text: formatTime(0), cls: 'text-gray-400' }
  const sign = ms < 0 ? '-' : '+'
  return { text: `${sign}${formatTime(Math.abs(ms))}`, cls: ms < 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold' }
}

function downloadSplitSheetCSV(race, columns, groups) {
  const headerSub = ['Name', ...columns.map((c) => `${c.groupLabel} ${c.sub}`), 'Total', 'PR', 'PR Diff', 'Season Best', 'SB Diff', 'Prev Race', 'Prev Race Diff']
  const lines = [headerSub.join(',')]
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  groups.forEach((group) => {
    lines.push(esc(`-- ${group.label} --`))
    group.rows.all.forEach(({ athlete, segments, totalMs, refs }) => {
      const cells = columns.map((col) => {
        const v = cellForColumn(col, segments)
        return v == null ? '' : formatTime(v)
      })
      const diffPR = refs.pr != null && totalMs != null ? totalMs - refs.pr : null
      const diffSB = refs.sb != null && totalMs != null ? totalMs - refs.sb : null
      const diffPrev = refs.prevRace != null && totalMs != null ? totalMs - refs.prevRace : null
      const row = [
        athlete.name,
        ...cells,
        totalMs == null ? '' : formatTime(totalMs),
        refs.pr == null ? '' : formatTime(refs.pr),
        diffPR == null ? '' : fmtDiff(diffPR).text,
        refs.sb == null ? '' : formatTime(refs.sb),
        diffSB == null ? '' : fmtDiff(diffSB).text,
        refs.prevRace == null ? '' : formatTime(refs.prevRace),
        diffPrev == null ? '' : fmtDiff(diffPrev).text,
      ]
      lines.push(row.map(esc).join(','))
    })
    if (group.rows.finishers.length) {
      const top5 = group.rows.finishers.slice(0, 5)
      const avg = top5.reduce((sum, r) => sum + r.totalMs, 0) / top5.length
      const spread = top5.length > 1 ? top5[top5.length - 1].totalMs - top5[0].totalMs : null
      // Blank filler lines up the value with the Total column; PR/SB/Prev cells are left off.
      lines.push([`Team Avg (top ${top5.length})`, ...columns.map(() => ''), formatTime(avg)].map(esc).join(','))
      if (spread != null) {
        lines.push([`Top ${top5.length} spread`, ...columns.map(() => ''), formatTime(spread)].map(esc).join(','))
      }
    }
  })
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${race.name} - split sheet.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function RaceReport({ race, team, raceAthletes, checkpoints, splits, onBack }) {
  const sortedCheckpoints = [...checkpoints].sort((a, b) => a.sort_order - b.sort_order)
  const columns = buildSplitSheetColumns(sortedCheckpoints)
  const genderMap = useGenderMap(raceAthletes)
  const history = useSplitSheetHistory(race)

  const rowsAll = raceAthletes.map((a) => {
    const { segments, totalMs } = computeAthleteSegments(a.id, sortedCheckpoints, splits)
    const gender = a.team_athlete_id ? genderMap[a.team_athlete_id] : null
    const refs = referenceTimes(history, a.team_athlete_id, race.created_at)
    return { athlete: a, segments, totalMs, gender, refs }
  })

  const girls = groupSortedByFinishTime(rowsAll.filter((r) => r.gender === 'F'))
  const boys = groupSortedByFinishTime(rowsAll.filter((r) => r.gender === 'M'))
  const unassigned = groupSortedByFinishTime(rowsAll.filter((r) => r.gender !== 'F' && r.gender !== 'M'))

  const groups = [
    { label: 'Girls', rows: girls },
    { label: 'Boys', rows: boys },
    { label: 'Unassigned', rows: unassigned },
  ].filter((g) => g.rows.all.length > 0)

  return (
    <div>
      <style>{`
        @page { size: landscape; margin: 10mm 8mm; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          table.split-sheet thead { display: table-header-group; }
          table.split-sheet tr { page-break-inside: avoid; }
          .split-squad { page-break-inside: auto; }
        }
      `}</style>

      <button onClick={onBack} className="text-sm text-gray-500 underline mb-4 print:hidden">
        &larr; Back to race
      </button>

      <div className="flex items-center justify-between mb-4 print:hidden">
        <h2 className="text-lg font-semibold">Full report</h2>
        <div className="flex items-center gap-3">
          <button onClick={() => window.print()} className="text-xs text-gray-500 underline">
            Print
          </button>
          <button onClick={() => downloadSplitSheetCSV(race, columns, groups)} className="text-xs text-gray-500 underline">
            Download CSV
          </button>
        </div>
      </div>

      {/* Letterhead - team name/photo come straight from this race's Team page */}
      <div className="flex items-center gap-3 border-b-2 border-gray-900 pb-2 mb-4 print:pb-2 print:mb-3">
        {team?.photo_url && (
          <img src={team.photo_url} alt="" className="w-10 h-10 print:w-9 print:h-9 rounded-full object-cover border border-gray-200" />
        )}
        <div>
          <div className="text-base font-extrabold leading-tight">{team ? team.name : race.name}</div>
          <div className="text-xs text-gray-500">
            Split Sheet Report
            {team && <> · {race.name}</>} ·{' '}
            {new Date(race.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </div>

      {groups.map((group) => (
        <div key={group.label} className="split-squad mb-6 print:mb-4">
          <h3 className="inline-block text-xs font-bold uppercase tracking-wide bg-gray-900 text-white px-2 py-1 mb-2">
            {group.label}
          </h3>
          <div className="overflow-x-auto print:overflow-visible">
            <table className="split-sheet text-[10px] print:text-[8.5px] border-collapse w-full">
              <thead>
                <tr>
                  <th rowSpan={2} className="text-left align-bottom py-1 px-1 border border-gray-300 bg-gray-100">
                    Name
                  </th>
                  {(() => {
                    const groupedHeaders = []
                    let i = 0
                    while (i < columns.length) {
                      const label = columns[i].groupLabel
                      let span = 1
                      while (i + span < columns.length && columns[i + span].groupLabel === label && columns[i + span].i === columns[i].i) {
                        span++
                      }
                      groupedHeaders.push({ label, span })
                      i += span
                    }
                    return groupedHeaders.map((h, idx) => (
                      <th key={idx} colSpan={h.span} className="py-1 px-1 border border-gray-300 bg-gray-200 uppercase text-[9px] print:text-[7.5px] tracking-wide">
                        {h.label}
                      </th>
                    ))
                  })()}
                  <th rowSpan={2} className="py-1 px-1 border border-gray-300 bg-gray-100 align-bottom">
                    Total
                  </th>
                  <th colSpan={2} className="py-1 px-1 border border-gray-300 bg-gray-200 uppercase text-[9px] print:text-[7.5px] tracking-wide">
                    PR
                  </th>
                  <th colSpan={2} className="py-1 px-1 border border-gray-300 bg-gray-200 uppercase text-[9px] print:text-[7.5px] tracking-wide">
                    Season Best
                  </th>
                  <th colSpan={2} className="py-1 px-1 border border-gray-300 bg-gray-200 uppercase text-[9px] print:text-[7.5px] tracking-wide">
                    Prev Race
                  </th>
                </tr>
                <tr>
                  {columns.map((c, idx) => (
                    <th key={idx} className="py-1 px-1 border border-gray-300 bg-gray-100 font-normal text-gray-500 text-[9px] print:text-[7.5px]">
                      {c.sub}
                    </th>
                  ))}
                  <th className="py-1 px-1 border border-gray-300 bg-gray-100 font-normal text-gray-500 text-[9px] print:text-[7.5px]">Time</th>
                  <th className="py-1 px-1 border border-gray-300 bg-gray-100 font-normal text-gray-500 text-[9px] print:text-[7.5px]">Diff</th>
                  <th className="py-1 px-1 border border-gray-300 bg-gray-100 font-normal text-gray-500 text-[9px] print:text-[7.5px]">Time</th>
                  <th className="py-1 px-1 border border-gray-300 bg-gray-100 font-normal text-gray-500 text-[9px] print:text-[7.5px]">Diff</th>
                  <th className="py-1 px-1 border border-gray-300 bg-gray-100 font-normal text-gray-500 text-[9px] print:text-[7.5px]">Time</th>
                  <th className="py-1 px-1 border border-gray-300 bg-gray-100 font-normal text-gray-500 text-[9px] print:text-[7.5px]">Diff</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.all.map(({ athlete, segments, totalMs, refs }) => {
                  const diffPR = refs.pr != null && totalMs != null ? totalMs - refs.pr : null
                  const diffSB = refs.sb != null && totalMs != null ? totalMs - refs.sb : null
                  const diffPrev = refs.prevRace != null && totalMs != null ? totalMs - refs.prevRace : null
                  const isNewPR = totalMs != null && (refs.pr == null || totalMs < refs.pr)
                  const prDiff = fmtDiff(diffPR)
                  const sbDiff = fmtDiff(diffSB)
                  const prevDiff = fmtDiff(diffPrev)
                  return (
                    <tr key={athlete.id}>
                      <td className="py-0.5 px-1 border border-gray-200 font-medium whitespace-nowrap">{athlete.name}</td>
                      {columns.map((col, idx) => {
                        const v = cellForColumn(col, segments)
                        if (col.kind === 'diff') {
                          const d = fmtDiff(v)
                          return (
                            <td key={idx} className={`py-0.5 px-1 border border-gray-200 text-right tabular-nums ${d.cls}`}>
                              {d.text}
                            </td>
                          )
                        }
                        return (
                          <td key={idx} className="py-0.5 px-1 border border-gray-200 text-right tabular-nums text-gray-600">
                            {v == null ? '—' : formatTime(v)}
                          </td>
                        )
                      })}
                      <td className={`py-0.5 px-1 border border-gray-200 text-right tabular-nums font-semibold ${isNewPR ? 'bg-yellow-100' : ''}`}>
                        {totalMs == null ? '—' : formatTime(totalMs)}
                      </td>
                      <td className="py-0.5 px-1 border border-gray-200 text-right tabular-nums text-gray-600">
                        {refs.pr == null ? '—' : formatTime(refs.pr)}
                      </td>
                      <td className={`py-0.5 px-1 border border-gray-200 text-right tabular-nums ${prDiff.cls}`}>{prDiff.text}</td>
                      <td className="py-0.5 px-1 border border-gray-200 text-right tabular-nums text-gray-600">
                        {refs.sb == null ? '—' : formatTime(refs.sb)}
                      </td>
                      <td className={`py-0.5 px-1 border border-gray-200 text-right tabular-nums ${sbDiff.cls}`}>{sbDiff.text}</td>
                      <td className="py-0.5 px-1 border border-gray-200 text-right tabular-nums text-gray-600">
                        {refs.prevRace == null ? '—' : formatTime(refs.prevRace)}
                      </td>
                      <td className={`py-0.5 px-1 border border-gray-200 text-right tabular-nums ${prevDiff.cls}`}>{prevDiff.text}</td>
                    </tr>
                  )
                })}
                {group.rows.finishers.length > 0 &&
                  (() => {
                    const top5 = group.rows.finishers.slice(0, 5)
                    const avg = top5.reduce((sum, r) => sum + r.totalMs, 0) / top5.length
                    const spread = top5.length > 1 ? top5[top5.length - 1].totalMs - top5[0].totalMs : null
                    const totalCols = columns.length + 1 + 6 // checkpoint cols + Total + PR/SB/Prev (2 each) - all columns after Name
                    return (
                      <>
                        <tr className="bg-gray-50 font-semibold border-t-2 border-gray-900">
                          <td className="py-0.5 px-1 border border-gray-200">Team Avg (top {top5.length})</td>
                          <td colSpan={totalCols} className="py-0.5 px-1 border border-gray-200 text-right tabular-nums">
                            {formatTime(avg)}
                          </td>
                        </tr>
                        {spread != null && (
                          <tr className="bg-gray-50 font-semibold">
                            <td className="py-0.5 px-1 border border-gray-200">Top {top5.length} spread</td>
                            <td colSpan={totalCols} className="py-0.5 px-1 border border-gray-200 text-right tabular-nums">
                              {formatTime(spread)}
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })()}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function checkinState(a) {
  if (a.checked_out_at) return 'out'
  if (a.checked_in_at) return 'in'
  return 'none'
}

function RaceCheckin({ raceAthletes }) {
  const [rows, setRows] = useState(raceAthletes)

  useEffect(() => {
    setRows(raceAthletes)
  }, [raceAthletes])

  const inCount = rows.filter((a) => checkinState(a) === 'in').length
  const outCount = rows.filter((a) => checkinState(a) === 'out').length
  const noneCount = rows.length - inCount - outCount

  async function cycle(athlete) {
    const state = checkinState(athlete)
    const now = new Date().toISOString()
    let update

    if (state === 'none') {
      update = { checked_in_at: now, checked_out_at: null }
    } else if (state === 'in') {
      update = { checked_out_at: now }
    } else {
      update = { checked_in_at: null, checked_out_at: null }
    }

    setRows((prev) => prev.map((a) => (a.id === athlete.id ? { ...a, ...update } : a)))
    await supabase.from('athletes').update(update).eq('id', athlete.id)
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Check-in sheet</h2>
      <p className="text-sm text-gray-500 mb-4">
        Tap a name to cycle: not here → checked in → checked out. Tap again to reset.
      </p>

      <div className="flex gap-4 text-sm mb-4">
        <span className="text-gray-500">
          <span className="font-semibold text-gray-900">{inCount}</span> in
        </span>
        <span className="text-gray-500">
          <span className="font-semibold text-gray-900">{outCount}</span> out
        </span>
        <span className="text-gray-500">
          <span className="font-semibold text-gray-900">{noneCount}</span> not yet
        </span>
      </div>

      <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        {rows.map((a) => {
          const state = checkinState(a)
          return (
            <li key={a.id}>
              <button onClick={() => cycle(a)} className="w-full flex items-center justify-between px-3 py-3 text-sm hover:bg-gray-50">
                <span>{a.name}</span>
                {state === 'none' && <span className="text-xs text-gray-400">Not here</span>}
                {state === 'in' && (
                  <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                    In {new Date(a.checked_in_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
                {state === 'out' && (
                  <span className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                    Out {new Date(a.checked_out_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
