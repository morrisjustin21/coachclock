import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { formatTime } from '../lib/csv'

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// --- Season report helpers -------------------------------------------------
// Shared by both the XC and Track season reports below. Each report finds the
// "finish" checkpoint for every race (highest sort_order for XC, greatest
// distance_m for Track), pulls each athlete's time there, then rolls that up
// per roster athlete: races run, season-best time, and most recent time.

function buildFinishCheckpointMap(checkpoints, raceKey, orderKey) {
  const map = {}
  checkpoints.forEach((cp) => {
    const rid = cp[raceKey]
    const order = cp[orderKey]
    const cur = map[rid]
    if (!cur || order > cur.order) map[rid] = { id: cp.id, order }
  })
  return map
}

function buildTotalsByParticipant(splits, raceKey, finishMap) {
  const totals = {}
  splits.forEach((s) => {
    const finish = finishMap[s[raceKey]]
    if (!finish || s.checkpoint_id !== finish.id) return
    totals[s.athlete_id] = s.recorded_time_ms
  })
  return totals
}

// rosterList: [{ id, name, gender }]
// raceList: [{ id, created_at }]
// participantList: [{ id, raceId, rosterId }]
// totalsByParticipantId: { participantRowId: ms }
function buildSeasonAggregates(rosterList, raceList, participantList, totalsByParticipantId) {
  const dateByRace = {}
  raceList.forEach((r) => {
    dateByRace[r.id] = r.created_at
  })

  const byRoster = {}
  participantList.forEach((p) => {
    const ms = totalsByParticipantId[p.id]
    if (ms == null || !p.rosterId) return
    const list = byRoster[p.rosterId] || (byRoster[p.rosterId] = [])
    list.push({ raceId: p.raceId, date: dateByRace[p.raceId], ms })
  })
  Object.values(byRoster).forEach((list) => list.sort((a, b) => new Date(a.date) - new Date(b.date)))

  return rosterList
    .map((a) => {
      const list = byRoster[a.id]
      if (!list || list.length === 0) return null
      const seasonBest = Math.min(...list.map((e) => e.ms))
      const mostRecent = list[list.length - 1]
      return {
        athlete: a,
        racesRun: list.length,
        seasonBest,
        mostRecentMs: mostRecent.ms,
        mostRecentDate: mostRecent.date,
      }
    })
    .filter(Boolean)
    .sort((x, y) => x.seasonBest - y.seasonBest)
}

function groupByGender(rows) {
  return {
    girls: rows.filter((r) => r.athlete.gender === 'F'),
    boys: rows.filter((r) => r.athlete.gender === 'M'),
    unassigned: rows.filter((r) => r.athlete.gender !== 'F' && r.athlete.gender !== 'M'),
  }
}

function fmtDiff(ms) {
  if (ms == null || Number.isNaN(ms)) return { text: '—', cls: 'text-gray-300' }
  if (ms === 0) return { text: formatTime(0), cls: 'text-gray-400' }
  const sign = ms < 0 ? '-' : '+'
  return {
    text: `${sign}${formatTime(Math.abs(ms))}`,
    cls: ms < 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold',
  }
}

function SeasonReportSquad({ label, rows }) {
  if (rows.length === 0) return null
  return (
    <div className="mb-3 last:mb-0">
      <h5 className="text-xs font-medium text-gray-600 mb-1">{label}</h5>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
            <th className="py-1 pr-2 font-normal">Runner</th>
            <th className="py-1 pr-2 font-normal text-right">Races</th>
            <th className="py-1 pr-2 font-normal text-right">Season Best</th>
            <th className="py-1 pr-2 font-normal text-right">Most Recent</th>
            <th className="py-1 pr-2 font-normal text-right">vs. Best</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = fmtDiff(r.mostRecentMs - r.seasonBest)
            return (
              <tr key={r.athlete.id} className="border-b border-gray-100">
                <td className="py-1.5 pr-2 font-medium">{r.athlete.name}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-500">{r.racesRun}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums font-medium">{formatTime(r.seasonBest)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{formatTime(r.mostRecentMs)}</td>
                <td className={`py-1.5 pr-2 text-right tabular-nums ${d.cls}`}>{d.text}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SeasonReportGroup({ title, groups }) {
  const hasRows = groups.girls.length || groups.boys.length || groups.unassigned.length
  return (
    <div className="mb-4 last:mb-0">
      {title && <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{title}</h4>}
      {!hasRows ? (
        <p className="text-sm text-gray-400 py-1">No season results yet.</p>
      ) : (
        <>
          <SeasonReportSquad label="Girls" rows={groups.girls} />
          <SeasonReportSquad label="Boys" rows={groups.boys} />
          <SeasonReportSquad label="Unassigned" rows={groups.unassigned} />
        </>
      )}
    </div>
  )
}

export default function Team({ session }) {
  const [teams, setTeams] = useState([]) // { id, name, join_code, owner_coach_id, isOwner, memberCount }
  const [activeTeamId, setActiveTeamId] = useState(null)
  const [races, setRaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [saving, setSaving] = useState(false)

  // XC/Track sub-tab. Track only appears once this team actually has track
  // activity, so a plain XC team's page stays uncluttered.
  const [subTab, setSubTab] = useState('xc')
  const [hasTrack, setHasTrack] = useState(false)
  const [trackRaces, setTrackRaces] = useState([])

  const [showXcReport, setShowXcReport] = useState(false)
  const [xcReport, setXcReport] = useState(null) // { girls, boys, unassigned }
  const [xcReportLoading, setXcReportLoading] = useState(false)

  const [showTrackReport, setShowTrackReport] = useState(false)
  const [trackReport, setTrackReport] = useState(null) // { events: [{ label, girls, boys, unassigned }] }
  const [trackReportLoading, setTrackReportLoading] = useState(false)

  const activeTeam = teams.find((t) => t.id === activeTeamId) || null

  useEffect(() => {
    loadTeams()
  }, [])

  useEffect(() => {
    if (!activeTeamId) return
    loadRaces(activeTeamId)
    loadTrackInfo(activeTeamId)
    setSubTab('xc')
    setShowXcReport(false)
    setShowTrackReport(false)
    setXcReport(null)
    setTrackReport(null)
  }, [activeTeamId])

  async function loadTeams() {
    setLoading(true)
    const { data: memberships } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('coach_id', session.user.id)

    if (!memberships || memberships.length === 0) {
      setTeams([])
      setActiveTeamId(null)
      setLoading(false)
      return
    }

    const teamIds = memberships.map((m) => m.team_id)
    const { data: teamRows } = await supabase.from('teams').select('*').in('id', teamIds)

    const withCounts = await Promise.all(
      (teamRows || []).map(async (t) => {
        const { count } = await supabase
          .from('team_members')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', t.id)
        return { ...t, isOwner: t.owner_coach_id === session.user.id, memberCount: count || 0 }
      })
    )

    setTeams(withCounts)
    setActiveTeamId((prev) => (prev && withCounts.some((t) => t.id === prev) ? prev : withCounts[0]?.id || null))
    setLoading(false)
  }

  async function loadRaces(teamId) {
    const { data } = await supabase
      .from('races')
      .select('*')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
    setRaces(data || [])
  }

  async function loadTrackInfo(teamId) {
    const [{ data: tRaces }, { count: athleteCount }] = await Promise.all([
      supabase.from('track_races').select('*').eq('team_id', teamId).order('created_at', { ascending: false }),
      supabase.from('track_athletes').select('id', { count: 'exact', head: true }).eq('team_id', teamId),
    ])
    setTrackRaces(tRaces || [])
    setHasTrack((tRaces && tRaces.length > 0) || (athleteCount || 0) > 0)
  }

  async function loadXcSeasonReport() {
    if (!activeTeam) return
    setXcReportLoading(true)

    const [{ data: roster }, { data: teamRaces }] = await Promise.all([
      supabase.from('team_athletes').select('id, name, gender').eq('team_id', activeTeam.id),
      supabase
        .from('races')
        .select('id, created_at')
        .eq('team_id', activeTeam.id)
        .order('created_at', { ascending: true }),
    ])

    if (!teamRaces || teamRaces.length === 0) {
      setXcReport({ girls: [], boys: [], unassigned: [] })
      setXcReportLoading(false)
      return
    }
    const raceIds = teamRaces.map((r) => r.id)

    const [{ data: participants }, { data: checkpoints }, { data: splits }] = await Promise.all([
      supabase.from('athletes').select('id, race_id, team_athlete_id').in('race_id', raceIds),
      supabase.from('checkpoints').select('id, race_id, sort_order').in('race_id', raceIds),
      supabase.from('splits').select('athlete_id, race_id, checkpoint_id, recorded_time_ms').in('race_id', raceIds),
    ])

    const finishMap = buildFinishCheckpointMap(checkpoints || [], 'race_id', 'sort_order')
    const totals = buildTotalsByParticipant(splits || [], 'race_id', finishMap)
    const participantList = (participants || []).map((p) => ({
      id: p.id,
      raceId: p.race_id,
      rosterId: p.team_athlete_id,
    }))

    const rows = buildSeasonAggregates(roster || [], teamRaces, participantList, totals)
    setXcReport(groupByGender(rows))
    setXcReportLoading(false)
  }

  async function loadTrackSeasonReport() {
    if (!activeTeam) return
    setTrackReportLoading(true)

    const [{ data: roster }, { data: teamRaces }] = await Promise.all([
      supabase.from('track_athletes').select('id, name, gender').eq('team_id', activeTeam.id),
      supabase
        .from('track_races')
        .select('id, created_at, event_label')
        .eq('team_id', activeTeam.id)
        .order('created_at', { ascending: true }),
    ])

    if (!teamRaces || teamRaces.length === 0) {
      setTrackReport({ events: [] })
      setTrackReportLoading(false)
      return
    }
    const raceIds = teamRaces.map((r) => r.id)

    const [{ data: participants }, { data: checkpoints }, { data: splits }] = await Promise.all([
      supabase.from('track_race_athletes').select('id, track_race_id, track_athlete_id').in('track_race_id', raceIds),
      supabase.from('track_checkpoints').select('id, track_race_id, distance_m').in('track_race_id', raceIds),
      supabase
        .from('track_splits')
        .select('athlete_id, track_race_id, checkpoint_id, recorded_time_ms')
        .in('track_race_id', raceIds),
    ])

    const finishMap = buildFinishCheckpointMap(checkpoints || [], 'track_race_id', 'distance_m')
    const totals = buildTotalsByParticipant(splits || [], 'track_race_id', finishMap)
    const participantList = (participants || []).map((p) => ({
      id: p.id,
      raceId: p.track_race_id,
      rosterId: p.track_athlete_id,
    }))

    // Times only mean anything against the same event, so each event gets its own
    // rollup rather than one race list lumped together.
    const eventLabels = [...new Set(teamRaces.map((r) => r.event_label || 'Unlabeled'))]
    const events = eventLabels
      .map((label) => {
        const racesForEvent = teamRaces.filter((r) => (r.event_label || 'Unlabeled') === label)
        const raceIdSet = new Set(racesForEvent.map((r) => r.id))
        const participantsForEvent = participantList.filter((p) => raceIdSet.has(p.raceId))
        const rows = buildSeasonAggregates(roster || [], racesForEvent, participantsForEvent, totals)
        return { label, ...groupByGender(rows) }
      })
      .filter((e) => e.girls.length || e.boys.length || e.unassigned.length)

    setTrackReport({ events })
    setTrackReportLoading(false)
  }

  function toggleXcReport() {
    const next = !showXcReport
    setShowXcReport(next)
    if (next && !xcReport) loadXcSeasonReport()
  }

  function toggleTrackReport() {
    const next = !showTrackReport
    setShowTrackReport(next)
    if (next && !trackReport) loadTrackSeasonReport()
  }

  async function createTeam(e) {
    e.preventDefault()
    if (!teamName.trim()) return
    setError('')
    setBusy(true)

    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase
        .from('teams')
        .insert({ name: teamName.trim(), owner_coach_id: session.user.id, join_code: generateJoinCode() })
        .select()
        .single()

      if (!error) {
        const { error: memberError } = await supabase
          .from('team_members')
          .insert({ team_id: data.id, coach_id: session.user.id })
        setBusy(false)
        if (memberError) {
          setError(`Team was created, but adding you to it failed: ${memberError.message}`)
          return
        }
        setTeamName('')
        setShowCreate(false)
        await loadTeams()
        setActiveTeamId(data.id)
        return
      }
      if (!String(error.message).toLowerCase().includes('join_code')) {
        setBusy(false)
        setError(error.message)
        return
      }
    }
    setBusy(false)
    setError('Could not create team after a few attempts. Please try again.')
  }

  async function joinTeam(e) {
    e.preventDefault()
    const trimmed = joinCode.trim().toUpperCase()
    if (!trimmed) return
    setError('')
    setBusy(true)

    const { data: teamRow, error: teamError } = await supabase
      .from('teams')
      .select('id, name')
      .eq('join_code', trimmed)
      .maybeSingle()

    if (teamError || !teamRow) {
      setBusy(false)
      setError("Couldn't find a team with that code. Double check it and try again.")
      return
    }

    const { error: joinError } = await supabase
      .from('team_members')
      .insert({ team_id: teamRow.id, coach_id: session.user.id })

    setBusy(false)

    if (joinError) {
      setError(
        joinError.message.toLowerCase().includes('duplicate')
          ? "You're already on that team."
          : joinError.message
      )
      return
    }

    setJoinCode('')
    setShowJoin(false)
    await loadTeams()
    setActiveTeamId(teamRow.id)
  }

  async function copyCode() {
    if (!activeTeam) return
    try {
      await navigator.clipboard.writeText(activeTeam.join_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  async function leaveTeam() {
    if (!activeTeam) return
    const confirmed = window.confirm(
      activeTeam.isOwner
        ? `Leave "${activeTeam.name}"? Since you created it, this also removes every other coach's membership. Races already created stay as they are.`
        : `Leave "${activeTeam.name}"? You'll lose automatic access to its races until you rejoin with the team code.`
    )
    if (!confirmed) return

    if (activeTeam.isOwner) {
      await supabase.from('teams').delete().eq('id', activeTeam.id)
    } else {
      await supabase.from('team_members').delete().eq('team_id', activeTeam.id).eq('coach_id', session.user.id)
    }
    setActiveTeamId(null)
    loadTeams()
  }

  function startEdit() {
    setEditName(activeTeam.name)
    setPhotoFile(null)
    setPhotoPreview(activeTeam.photo_url || null)
    setEditing(true)
  }

  function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  async function saveEdit(e) {
    e.preventDefault()
    if (!editName.trim()) return
    setSaving(true)
    setError('')

    let photoUrl = activeTeam.photo_url

    if (photoFile) {
      const ext = photoFile.name.split('.').pop()
      const path = `${activeTeam.id}/${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('team-photos')
        .upload(path, photoFile, { upsert: true })

      if (uploadError) {
        setSaving(false)
        setError(`Photo upload failed: ${uploadError.message}`)
        return
      }
      photoUrl = supabase.storage.from('team-photos').getPublicUrl(path).data.publicUrl
    }

    const { error: updateError } = await supabase
      .from('teams')
      .update({ name: editName.trim(), photo_url: photoUrl })
      .eq('id', activeTeam.id)

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setEditing(false)
    setPhotoFile(null)
    loadTeams()
  }

  async function removePhoto() {
    const { error: updateError } = await supabase
      .from('teams')
      .update({ photo_url: null })
      .eq('id', activeTeam.id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setPhotoPreview(null)
    setPhotoFile(null)
    loadTeams()
  }

  if (loading) return <p className="text-center py-8 text-sm text-gray-500">Loading...</p>

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link to="/" className="text-sm text-gray-500 underline">
        &larr; All races
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-4">Teams</h1>

      {teams.length > 0 && (
        <div className="flex gap-2 overflow-x-auto mb-4 pb-1">
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTeamId(t.id)}
              className={`whitespace-nowrap text-sm px-3 py-1.5 rounded-full border ${
                t.id === activeTeamId
                  ? 'bg-gray-900 text-white border-gray-900 font-medium'
                  : 'border-gray-300 text-gray-600'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => {
            setShowCreate((v) => !v)
            setShowJoin(false)
          }}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
        >
          + Create a team
        </button>
        <button
          onClick={() => {
            setShowJoin((v) => !v)
            setShowCreate(false)
          }}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
        >
          Join a team
        </button>
      </div>

      {showCreate && (
        <form onSubmit={createTeam} className="flex gap-2 mb-6">
          <input
            type="text"
            placeholder="Team name (e.g. Duncan Demons - Middle School)"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            disabled={busy}
            className="bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}

      {showJoin && (
        <form onSubmit={joinTeam} className="flex gap-2 mb-6">
          <input
            type="text"
            placeholder="Team code (e.g. K7M2QX)"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            maxLength={6}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono tracking-widest uppercase"
          />
          <button
            disabled={busy}
            className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Joining...' : 'Join'}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {!activeTeam ? (
        <p className="text-sm text-gray-400">
          You're not on a team yet. Create one or join one with a team code above.
        </p>
      ) : editing ? (
        <form onSubmit={saveEdit} className="space-y-3 mb-6">
          <h2 className="text-sm font-medium text-gray-700">Edit team</h2>

          {photoPreview && (
            <img src={photoPreview} alt="" className="w-24 h-24 rounded-lg object-cover border border-gray-200" />
          )}
          <div className="flex items-center gap-3">
            <input type="file" accept="image/*" onChange={handlePhotoChange} className="text-sm" />
            {activeTeam.photo_url && (
              <button type="button" onClick={removePhoto} className="text-xs text-red-600 underline">
                Remove photo
              </button>
            )}
          </div>

          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />

          <div className="flex gap-2">
            <button
              disabled={saving}
              className="bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-1">
            {activeTeam.photo_url && (
              <img
                src={activeTeam.photo_url}
                alt=""
                className="w-14 h-14 rounded-lg object-cover border border-gray-200"
              />
            )}
            <h2 className="text-lg font-semibold flex-1">{activeTeam.name}</h2>
            {activeTeam.isOwner && (
              <button onClick={startEdit} className="text-xs text-gray-500 underline">
                Edit
              </button>
            )}
          </div>
          <p className="text-sm text-gray-500 mb-4">
            {activeTeam.memberCount} coach{activeTeam.memberCount === 1 ? '' : 'es'} on this team
          </p>

          {activeTeam.isOwner && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-6 flex items-center gap-2">
              <span className="text-xs text-gray-500">Team code — season-long, share with your staff:</span>
              <span className="text-sm font-mono font-semibold tracking-wider">{activeTeam.join_code}</span>
              <button onClick={copyCode} className="text-xs text-gray-700 underline ml-auto">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}

          <div className="flex items-center justify-between mb-4">
            {hasTrack ? (
              <div className="flex text-sm border border-gray-300 rounded-lg overflow-hidden">
                <button
                  onClick={() => setSubTab('xc')}
                  className={`px-4 py-1.5 ${subTab === 'xc' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}
                >
                  XC
                </button>
                <button
                  onClick={() => setSubTab('track')}
                  className={`px-4 py-1.5 border-l border-gray-300 ${
                    subTab === 'track' ? 'bg-gray-900 text-white' : 'text-gray-600'
                  }`}
                >
                  Track
                </button>
              </div>
            ) : (
              <span />
            )}
            <button onClick={leaveTeam} className="text-xs text-red-600 underline">
              Leave team
            </button>
          </div>

          {subTab === 'xc' ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700">Season races ({races.length})</h3>
                <button onClick={toggleXcReport} className="text-xs text-gray-500 underline">
                  {showXcReport ? 'Hide season report' : 'Season report'}
                </button>
              </div>

              {showXcReport && (
                <div className="border border-gray-200 rounded-lg px-3 py-3 mb-4 bg-gray-50">
                  {xcReportLoading || !xcReport ? (
                    <p className="text-sm text-gray-500">Loading season report...</p>
                  ) : (
                    <SeasonReportGroup groups={xcReport} />
                  )}
                </div>
              )}

              {races.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No races yet. When creating a race, choose "{activeTeam.name}" and it'll show up here.
                </p>
              ) : (
                <ul className="space-y-2">
                  {races.map((r) => (
                    <li key={r.id}>
                      <Link
                        to={`/race/${r.id}`}
                        className="block border border-gray-200 rounded-lg px-4 py-3 hover:bg-gray-50"
                      >
                        <div className="font-medium text-sm">{r.name}</div>
                        <div className="text-xs text-gray-500">
                          {new Date(r.created_at).toLocaleDateString()} · {r.status}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700">Track races ({trackRaces.length})</h3>
                <div className="flex items-center gap-3">
                  <button onClick={toggleTrackReport} className="text-xs text-gray-500 underline">
                    {showTrackReport ? 'Hide season report' : 'Season report'}
                  </button>
                  <Link to="/track/roster" className="text-xs text-gray-500 underline">
                    Track roster
                  </Link>
                </div>
              </div>

              {showTrackReport && (
                <div className="border border-gray-200 rounded-lg px-3 py-3 mb-4 bg-gray-50">
                  {trackReportLoading || !trackReport ? (
                    <p className="text-sm text-gray-500">Loading season report...</p>
                  ) : trackReport.events.length === 0 ? (
                    <p className="text-sm text-gray-400">No season results yet.</p>
                  ) : (
                    trackReport.events.map((ev) => (
                      <SeasonReportGroup key={ev.label} title={ev.label} groups={ev} />
                    ))
                  )}
                </div>
              )}

              {trackRaces.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No track races yet for this team. Create one from the Track tab and choose "{activeTeam.name}".
                </p>
              ) : (
                <ul className="space-y-2">
                  {trackRaces.map((r) => (
                    <li key={r.id}>
                      <Link
                        to={`/track/${r.id}`}
                        className="block border border-gray-200 rounded-lg px-4 py-3 hover:bg-gray-50"
                      >
                        <div className="font-medium text-sm">{r.name}</div>
                        <div className="text-xs text-gray-500">
                          {new Date(r.created_at).toLocaleDateString()}
                          {r.event_label && <> · {r.event_label}</>} · {r.status}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
