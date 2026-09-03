import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export default function Team({ session }) {
  const [team, setTeam] = useState(null)
  const [isTeamOwner, setIsTeamOwner] = useState(false)
  const [memberCount, setMemberCount] = useState(0)
  const [races, setRaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [teamName, setTeamName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadTeam()
  }, [])

  async function loadTeam() {
    setLoading(true)
    const { data: membership } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('coach_id', session.user.id)
      .maybeSingle()

    if (!membership) {
      setTeam(null)
      setLoading(false)
      return
    }

    const { data: teamRow } = await supabase.from('teams').select('*').eq('id', membership.team_id).single()
    setTeam(teamRow)
    setIsTeamOwner(teamRow?.owner_coach_id === session.user.id)

    const { count } = await supabase
      .from('team_members')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', membership.team_id)
    setMemberCount(count || 0)

    const { data: teamRaces } = await supabase
      .from('races')
      .select('*')
      .eq('team_id', membership.team_id)
      .order('created_at', { ascending: false })
    setRaces(teamRaces || [])

    setLoading(false)
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
        await supabase.from('team_members').insert({ team_id: data.id, coach_id: session.user.id })
        setBusy(false)
        loadTeam()
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
        joinError.message.includes('duplicate')
          ? "You already belong to a team. Leave your current team first if you want to switch."
          : joinError.message
      )
      return
    }

    loadTeam()
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(team.join_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  async function leaveTeam() {
    const confirmed = window.confirm(
      isTeamOwner
        ? "Leave this team? Since you created it, this also removes every other coach's membership. Races already created stay as they are."
        : "Leave this team? You'll lose automatic access to its races until you rejoin with the team code."
    )
    if (!confirmed) return

    if (isTeamOwner) {
      await supabase.from('teams').delete().eq('id', team.id)
    } else {
      await supabase.from('team_members').delete().eq('coach_id', session.user.id)
    }
    loadTeam()
  }

  if (loading) return <p className="text-center py-8 text-sm text-gray-500">Loading...</p>

  if (!team) {
    return (
      <div className="max-w-sm mx-auto px-4 py-8">
        <Link to="/" className="text-sm text-gray-500 underline">
          &larr; All races
        </Link>
        <h1 className="text-xl font-semibold mt-2 mb-1">Team</h1>
        <p className="text-sm text-gray-500 mb-6">
          Create a team so every coach on your staff can see the whole season in one place.
        </p>

        <form onSubmit={createTeam} className="space-y-2 mb-8">
          <h2 className="text-sm font-medium text-gray-700">Create a team</h2>
          <input
            type="text"
            placeholder="Team name (e.g. Duncan Demons)"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            disabled={busy}
            className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Creating...' : 'Create team'}
          </button>
        </form>

        <form onSubmit={joinTeam} className="space-y-2">
          <h2 className="text-sm font-medium text-gray-700">Or join a team</h2>
          <input
            type="text"
            placeholder="Team code (e.g. K7M2QX)"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            maxLength={6}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono tracking-widest uppercase"
          />
          <button
            disabled={busy}
            className="w-full border border-gray-300 rounded-lg py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Joining...' : 'Join team'}
          </button>
        </form>

        {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link to="/" className="text-sm text-gray-500 underline">
        &larr; All races
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-1">{team.name}</h1>
      <p className="text-sm text-gray-500 mb-4">
        {memberCount} coach{memberCount === 1 ? '' : 'es'} on this team
      </p>

      {isTeamOwner && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-6 flex items-center gap-2">
          <span className="text-xs text-gray-500">Team code — season-long, share with your staff:</span>
          <span className="text-sm font-mono font-semibold tracking-wider">{team.join_code}</span>
          <button onClick={copyCode} className="text-xs text-gray-700 underline ml-auto">
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-gray-700">Season races ({races.length})</h2>
        <button onClick={leaveTeam} className="text-xs text-red-600 underline">
          Leave team
        </button>
      </div>

      {races.length === 0 ? (
        <p className="text-sm text-gray-400">No races yet. Create one from the races page and it'll show up here.</p>
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

      {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
    </div>
  )
}
