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

  const activeTeam = teams.find((t) => t.id === activeTeamId) || null

  useEffect(() => {
    loadTeams()
  }, [])

  useEffect(() => {
    if (activeTeamId) loadRaces(activeTeamId)
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

          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-700">Season races ({races.length})</h3>
            <button onClick={leaveTeam} className="text-xs text-red-600 underline">
              Leave team
            </button>
          </div>

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
      )}
    </div>
  )
}
