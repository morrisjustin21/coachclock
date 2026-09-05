import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'

const GRADES = ['6', '7', '8', '9', '10', '11', '12']
const GENDERS = [
  { value: 'F', label: 'Girls' },
  { value: 'M', label: 'Boys' },
]

export default function TeamRoster({ session }) {
  const [teams, setTeams] = useState([])
  const [activeTeamId, setActiveTeamId] = useState('none') // 'none' = personal, no team
  const [viewMode, setViewMode] = useState('mine') // 'mine' | 'team'

  const [athletes, setAthletes] = useState([])
  const [name, setName] = useState('')
  const [bib, setBib] = useState('')
  const [grade, setGrade] = useState('')
  const [gender, setGender] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [genderFilter, setGenderFilter] = useState('all')
  const [gradeFilter, setGradeFilter] = useState('all')

  const [selectedIds, setSelectedIds] = useState(new Set())
  const [moveTargetTeamId, setMoveTargetTeamId] = useState('')
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    loadTeams()
  }, [])

  useEffect(() => {
    loadRoster()
    setSelectedIds(new Set())
  }, [activeTeamId, viewMode])

  useEffect(() => {
    if (teams.length > 0 && !moveTargetTeamId) setMoveTargetTeamId(teams[0].id)
  }, [teams])

  async function loadTeams() {
    const { data: memberships } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('coach_id', session.user.id)
    if (!memberships || memberships.length === 0) return

    const { data: teamRows } = await supabase
      .from('teams')
      .select('id, name')
      .in('id', memberships.map((m) => m.team_id))
      .order('name', { ascending: true })

    setTeams(teamRows || [])
    if (teamRows && teamRows.length > 0) setActiveTeamId(teamRows[0].id)
  }

  async function loadRoster() {
    setLoading(true)

    let query = supabase.from('team_athletes').select('*').order('name', { ascending: true })

    if (viewMode === 'mine') {
      query = query.eq('coach_id', session.user.id)
    }
    if (activeTeamId === 'none') {
      query = query.is('team_id', null)
    } else {
      query = query.eq('team_id', activeTeamId)
    }

    const { data } = await query
    if (data) setAthletes(data)
    setLoading(false)
  }

  async function addOne(e) {
    e.preventDefault()
    if (!name.trim()) return
    setError('')
    const { error } = await supabase.from('team_athletes').insert({
      coach_id: session.user.id,
      team_id: activeTeamId === 'none' ? null : activeTeamId,
      name: name.trim(),
      bib: bib.trim() || null,
      grade: grade || null,
      gender: gender || null,
    })
    if (error) {
      setError(error.message)
      return
    }
    setName('')
    setBib('')
    loadRoster()
  }

  async function addBulk(e) {
    e.preventDefault()
    setError('')
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) return

    const rows = lines.map((line) => {
      // Accept either tab-separated (e.g. pasted straight from a spreadsheet)
      // or comma-separated input.
      const parts = (line.includes('\t') ? line.split('\t') : line.split(','))
        .map((p) => p.trim())
        .filter((p) => p !== '')

      let n = '',
        b = null,
        g = null,
        gen = null

      if (parts.length >= 4) {
        // Name, Bib, Grade, Gender
        ;[n, b, g, gen] = parts
      } else if (parts.length === 3) {
        // Name, Grade, Gender (no bib)
        ;[n, g, gen] = parts
      } else if (parts.length === 2) {
        // Name, Grade (no bib or gender)
        ;[n, g] = parts
      } else {
        n = parts[0]
      }

      return {
        coach_id: session.user.id,
        team_id: activeTeamId === 'none' ? null : activeTeamId,
        name: n,
        bib: b || null,
        grade: g || null,
        gender: gen ? gen.toUpperCase().slice(0, 1) : null,
      }
    })

    const { error } = await supabase.from('team_athletes').insert(rows)
    if (error) {
      setError(error.message)
      return
    }
    setBulkText('')
    loadRoster()
  }

  async function removeAthlete(id) {
    await supabase.from('team_athletes').delete().eq('id', id)
    loadRoster()
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllFiltered() {
    const filteredIds = filtered.map((a) => a.id)
    const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id))
    setSelectedIds(allSelected ? new Set() : new Set(filteredIds))
  }

  async function moveSelectedToTeam() {
    if (selectedIds.size === 0 || !moveTargetTeamId) return
    setMoving(true)
    setError('')

    const { error } = await supabase
      .from('team_athletes')
      .update({ team_id: moveTargetTeamId })
      .in('id', Array.from(selectedIds))

    setMoving(false)

    if (error) {
      setError(error.message)
      return
    }

    setSelectedIds(new Set())
    loadRoster()
  }

  async function deleteAll() {
    if (athletes.length === 0) return
    const label = activeTeamId === 'none' ? 'your personal (no team) roster' : "this team's roster"
    const confirmed = window.confirm(
      `Delete all ${athletes.length} athletes from ${label}? This cannot be undone. Past races you've already run are not affected.`
    )
    if (!confirmed) return

    let query = supabase.from('team_athletes').delete().eq('coach_id', session.user.id)
    query = activeTeamId === 'none' ? query.is('team_id', null) : query.eq('team_id', activeTeamId)

    const { error } = await query
    if (error) {
      setError(error.message)
      return
    }
    loadRoster()
  }

  const filtered = athletes.filter((a) => {
    if (genderFilter !== 'all' && a.gender !== genderFilter) return false
    if (gradeFilter !== 'all' && a.grade !== gradeFilter) return false
    return true
  })

  // Group by gender, then by grade within each gender
  const groups = {}
  filtered.forEach((a) => {
    const genderKey = a.gender || 'Unspecified'
    const gradeKey = a.grade || 'Unspecified'
    if (!groups[genderKey]) groups[genderKey] = {}
    if (!groups[genderKey][gradeKey]) groups[genderKey][gradeKey] = []
    groups[genderKey][gradeKey].push(a)
  })

  function genderLabel(key) {
    if (key === 'F') return 'Girls'
    if (key === 'M') return 'Boys'
    return key
  }

  const genderOrder = ['F', 'M', 'Unspecified'].filter((k) => groups[k])
  const gradeSort = (a, b) => {
    if (a === 'Unspecified') return 1
    if (b === 'Unspecified') return -1
    return Number(a) - Number(b)
  }

  const canEdit = viewMode === 'mine'
  const showMoveTools = canEdit && activeTeamId === 'none' && teams.length > 0

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link to="/" className="text-sm text-gray-500 underline">
        &larr; All races
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-1">Roster</h1>
      <p className="text-sm text-gray-500 mb-4">
        Build this once, then pick from it when setting up each race.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={activeTeamId}
          onChange={(e) => setActiveTeamId(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
        >
          <option value="none">No team (personal)</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {activeTeamId !== 'none' && (
          <div className="flex text-sm border border-gray-300 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('mine')}
              className={`px-3 py-1.5 ${viewMode === 'mine' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}
            >
              My roster
            </button>
            <button
              onClick={() => setViewMode('team')}
              className={`px-3 py-1.5 border-l border-gray-300 ${
                viewMode === 'team' ? 'bg-gray-900 text-white' : 'text-gray-600'
              }`}
            >
              Whole team
            </button>
          </div>
        )}

        {canEdit && athletes.length > 0 && (
          <button onClick={deleteAll} className="text-xs text-red-600 underline ml-auto">
            Delete all
          </button>
        )}
      </div>

      {canEdit && (
        <>
          <form onSubmit={addOne} className="flex flex-wrap gap-2 mb-3">
            <input
              type="text"
              placeholder="Athlete name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 min-w-[140px] border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="text"
              placeholder="Bib (optional)"
              value={bib}
              onChange={(e) => setBib(e.target.value)}
              className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Grade</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Gender</option>
              {GENDERS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            <button className="bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium">
              Add
            </button>
          </form>

          <details className="mb-6">
            <summary className="text-sm text-gray-500 cursor-pointer">
              Or paste a whole list at once
            </summary>
            <form onSubmit={addBulk} className="mt-2 space-y-2">
              <textarea
                placeholder={
                  'One per line. Works with tabs (pasted from a spreadsheet) or commas.\n' +
                  'Accepted formats:\n' +
                  'Name, Grade, Gender  ->  Asher Covington, 6, M\n' +
                  'Name, Bib, Grade, Gender  ->  Asher Covington, 101, 6, M'
                }
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={6}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <button className="bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium">
                Add list
              </button>
            </form>
          </details>
        </>
      )}

      {!canEdit && (
        <p className="text-xs text-gray-400 mb-4">
          Read-only view of everyone's athletes on this team. Switch to "My roster" to add or remove your own.
        </p>
      )}

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {showMoveTools && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4 flex flex-wrap items-center gap-2">
          <button onClick={toggleSelectAllFiltered} className="text-xs text-blue-700 underline">
            {filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id)) ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-xs text-blue-700">{selectedIds.size} selected</span>
          <select
            value={moveTargetTeamId}
            onChange={(e) => setMoveTargetTeamId(e.target.value)}
            className="text-xs border border-blue-300 rounded-lg px-2 py-1 ml-auto"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={moveSelectedToTeam}
            disabled={selectedIds.size === 0 || moving}
            className="text-xs bg-blue-600 text-white rounded-lg px-3 py-1 disabled:opacity-40"
          >
            {moving ? 'Moving...' : 'Move to team'}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <span className="text-xs text-gray-400 mr-1">Filter:</span>
        <button
          onClick={() => setGenderFilter('all')}
          className={`text-xs px-3 py-1 rounded-full border ${
            genderFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setGenderFilter('F')}
          className={`text-xs px-3 py-1 rounded-full border ${
            genderFilter === 'F' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600'
          }`}
        >
          Girls
        </button>
        <button
          onClick={() => setGenderFilter('M')}
          className={`text-xs px-3 py-1 rounded-full border ${
            genderFilter === 'M' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600'
          }`}
        >
          Boys
        </button>
        <select
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value)}
          className="text-xs border border-gray-300 rounded-full px-3 py-1"
        >
          <option value="all">All grades</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              Grade {g}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400">No athletes match this filter.</p>
      ) : (
        <div className="space-y-6">
          {genderOrder.map((genderKey) => (
            <div key={genderKey}>
              <h2 className="text-sm font-semibold text-gray-800 mb-2">{genderLabel(genderKey)}</h2>
              {Object.keys(groups[genderKey])
                .sort(gradeSort)
                .map((gradeKey) => (
                  <div key={gradeKey} className="mb-3">
                    <h3 className="text-xs font-medium text-gray-500 mb-1">
                      {gradeKey === 'Unspecified' ? 'Grade unspecified' : `Grade ${gradeKey}`}
                    </h3>
                    <ul className="space-y-1">
                      {groups[genderKey][gradeKey].map((a) => (
                        <li
                          key={a.id}
                          className="flex items-center justify-between border-b border-gray-100 py-2 text-sm"
                        >
                          <span className="flex items-center gap-2">
                            {showMoveTools && (
                              <input
                                type="checkbox"
                                checked={selectedIds.has(a.id)}
                                onChange={() => toggleSelect(a.id)}
                              />
                            )}
                            {a.name}
                            {a.bib && <span className="text-gray-400 ml-2">#{a.bib}</span>}
                          </span>
                          <span className="flex items-center gap-3">
                            <Link to={`/athlete/${a.id}`} className="text-gray-400 hover:text-gray-700 text-xs underline">
                              History
                            </Link>
                            {canEdit && (
                              <button
                                onClick={() => removeAthlete(a.id)}
                                className="text-gray-400 hover:text-red-600 text-xs"
                              >
                                Remove
                              </button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
