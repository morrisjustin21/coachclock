import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'

const GRADES = ['6', '7', '8', '9', '10', '11', '12']
const GENDERS = [
  { value: 'F', label: 'Girls' },
  { value: 'M', label: 'Boys' },
]

export default function TeamRoster({ session }) {
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

  useEffect(() => {
    loadRoster()
  }, [])

  async function loadRoster() {
    setLoading(true)
    const { data } = await supabase
      .from('team_athletes')
      .select('*')
      .order('name', { ascending: true })
    if (data) setAthletes(data)
    setLoading(false)
  }

  async function addOne(e) {
    e.preventDefault()
    if (!name.trim()) return
    setError('')
    const { error } = await supabase.from('team_athletes').insert({
      coach_id: session.user.id,
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

  async function deleteAll() {
    if (athletes.length === 0) return
    const confirmed = window.confirm(
      `Delete all ${athletes.length} athletes from your team roster? This cannot be undone. Past races you've already run are not affected.`
    )
    if (!confirmed) return
    const { error } = await supabase.from('team_athletes').delete().eq('coach_id', session.user.id)
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link to="/" className="text-sm text-gray-500 underline">
        &larr; All races
      </Link>
      <div className="flex items-center justify-between mt-2 mb-1">
        <h1 className="text-xl font-semibold">Team roster</h1>
        {athletes.length > 0 && (
          <button onClick={deleteAll} className="text-xs text-red-600 underline">
            Delete all
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Build this once, then pick from it when setting up each race.
      </p>

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

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

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
                          <span>
                            {a.name}
                            {a.bib && <span className="text-gray-400 ml-2">#{a.bib}</span>}
                          </span>
                          <button
                            onClick={() => removeAthlete(a.id)}
                            className="text-gray-400 hover:text-red-600 text-xs"
                          >
                            Remove
                          </button>
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
