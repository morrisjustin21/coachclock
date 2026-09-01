import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { formatTime, downloadCSV } from '../lib/csv'

export default function RacePage({ session }) {
  const { raceId } = useParams()
  const [race, setRace] = useState(null)
  const [teamAthletes, setTeamAthletes] = useState([])
  const [raceAthletes, setRaceAthletes] = useState([])
  const [splits, setSplits] = useState([])
  const [loading, setLoading] = useState(true)

  const isOwner = session && race && race.coach_id === session.user.id

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
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [raceId])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadRace(), loadRaceAthletes(), loadSplits()])
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

  async function loadRaceAthletes() {
    const { data } = await supabase
      .from('athletes')
      .select('*')
      .eq('race_id', raceId)
      .order('sort_order', { ascending: true })
    if (data) setRaceAthletes(data)
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

      {race.status !== 'setup' && (
        <RaceLive race={race} raceAthletes={raceAthletes} splits={splits} isOwner={isOwner} />
      )}
    </div>
  )
}

function RaceSetup({ race, teamAthletes, onStarted }) {
  const [roster, setRoster] = useState([]) // { key, team_athlete_id, name, bib }
  const [oneOffName, setOneOffName] = useState('')
  const [starting, setStarting] = useState(false)

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

  async function startRace() {
    if (roster.length === 0) return
    setStarting(true)
    const rows = roster.map((r, i) => ({
      race_id: race.id,
      team_athlete_id: r.team_athlete_id,
      name: r.name,
      bib: r.bib,
      sort_order: i,
    }))
    await supabase.from('athletes').insert(rows)
    await supabase.from('races').update({ status: 'live' }).eq('id', race.id)
    setStarting(false)
    onStarted()
  }

  return (
    <div>
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

function RaceLive({ race, raceAthletes, splits, isOwner }) {
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef(null)
  const rafRef = useRef(null)

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  function tick() {
    setElapsed(Date.now() - startTimeRef.current)
    rafRef.current = requestAnimationFrame(tick)
  }

  const [pendingSplits, setPendingSplits] = useState([])
  const [removedIds, setRemovedIds] = useState(new Set())
  const inFlightRef = useRef({}) // tempId -> { cancelled, realId }

  function handleStartStop() {
    if (!running) {
      startTimeRef.current = Date.now()
      setRunning(true)
      tick()
    } else {
      setRunning(false)
      cancelAnimationFrame(rafRef.current)
    }
  }

  // Merge confirmed splits from the server with any taps still in flight,
  // minus anything just undone, so the tap list and results update the
  // instant you click, without waiting on any round trip to the database.
  const confirmedAthleteIds = new Set(splits.map((s) => s.athlete_id))
  const visibleConfirmed = splits.filter((s) => !removedIds.has(s.id))
  const visiblePending = pendingSplits.filter((p) => !confirmedAthleteIds.has(p.athlete_id))
  const finishedInOrder = [...visibleConfirmed, ...visiblePending].sort(
    (a, b) => a.recorded_time_ms - b.recorded_time_ms
  )
  const finishedAthleteIds = new Set(finishedInOrder.map((s) => s.athlete_id))
  const waiting = raceAthletes.filter((a) => !finishedAthleteIds.has(a.id))

  async function recordFinish(athlete) {
    if (!running) return
    const time = Date.now() - startTimeRef.current
    const tempId = `pending-${athlete.id}-${Date.now()}`
    inFlightRef.current[tempId] = { cancelled: false, realId: null }
    setPendingSplits((prev) => [
      ...prev,
      { id: tempId, athlete_id: athlete.id, label: athlete.name, recorded_time_ms: time },
    ])

    const { data, error } = await supabase
      .from('splits')
      .insert({
        race_id: race.id,
        athlete_id: athlete.id,
        label: athlete.name,
        recorded_time_ms: time,
      })
      .select()
      .single()

    const flight = inFlightRef.current[tempId]

    if (error) {
      // Insert failed - drop the optimistic entry so the runner reappears in the waiting list
      setPendingSplits((prev) => prev.filter((p) => p.id !== tempId))
      delete inFlightRef.current[tempId]
      return
    }

    if (flight?.cancelled) {
      // Undo was pressed before this save finished - delete the row that just
      // landed so the runner doesn't silently reappear a moment later.
      await supabase.from('splits').delete().eq('id', data.id)
      setPendingSplits((prev) => prev.filter((p) => p.id !== tempId))
      delete inFlightRef.current[tempId]
      return
    }

    // Save succeeded and wasn't cancelled - record its real id in case Undo
    // is pressed before realtime delivers the confirmed row from the server.
    if (flight) flight.realId = data.id
  }

  async function undoLast() {
    if (finishedInOrder.length === 0) return
    const last = finishedInOrder[finishedInOrder.length - 1]

    if (String(last.id).startsWith('pending-')) {
      const flight = inFlightRef.current[last.id]
      // Remove from view immediately either way
      setPendingSplits((prev) => prev.filter((p) => p.id !== last.id))
      if (flight?.realId) {
        // The save already finished - delete the confirmed row now
        await supabase.from('splits').delete().eq('id', flight.realId)
        delete inFlightRef.current[last.id]
      } else if (flight) {
        // Still saving - mark it so it gets deleted the moment it lands
        flight.cancelled = true
      }
    } else {
      // Already-confirmed finish - hide it immediately, then delete for real
      setRemovedIds((prev) => new Set(prev).add(last.id))
      const { error } = await supabase.from('splits').delete().eq('id', last.id)
      if (error) {
        // Delete failed - bring it back
        setRemovedIds((prev) => {
          const next = new Set(prev)
          next.delete(last.id)
          return next
        })
      }
    }
  }

  return (
    <div>
      {isOwner && (
        <>
          <div className="text-center py-4">
            <div className="text-5xl font-semibold tabular-nums">{formatTime(elapsed)}</div>
          </div>
          <div className="flex gap-2 justify-center mb-2">
            <button onClick={handleStartStop} className="min-w-[100px] border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium">
              {running ? 'Stop' : 'Start'}
            </button>
            <button
              onClick={undoLast}
              disabled={finishedInOrder.length === 0}
              className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              Undo
            </button>
          </div>
          <p className="text-xs text-gray-400 text-center mb-6">Tap a name below as each runner crosses the line</p>
        </>
      )}

      {isOwner && (
        <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-6">
          {waiting.length === 0 ? (
            <li className="px-3 py-3 text-sm text-gray-400">Everyone has finished.</li>
          ) : (
            waiting.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => recordFinish(a)}
                  disabled={!running}
                  className="w-full text-left px-3 py-3 text-sm hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  {a.name}
                  {a.bib && <span className="text-gray-400 ml-2">#{a.bib}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-gray-700">Results ({finishedInOrder.length})</h2>
        {finishedInOrder.length > 0 && (
          <button onClick={() => downloadCSV(race.name, finishedInOrder)} className="text-xs text-gray-500 underline">
            Export CSV
          </button>
        )}
      </div>

      {finishedInOrder.length === 0 ? (
        <p className="text-sm text-gray-400">No finishers recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
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

      {!isOwner && (
        <p className="text-xs text-gray-400 mt-6">Live results — this page updates automatically as finishers are recorded.</p>
      )}
    </div>
  )
}
