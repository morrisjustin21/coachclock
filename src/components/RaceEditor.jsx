import { useState } from 'react'
import { supabase } from '../supabaseClient'

const CHECKPOINT_PRESETS = ['1000m', '2000m', '3000m', '4000m', '1mi', '2mi', '3mi', 'Finish']

// Owner-only tools for changing a race AFTER it has been created:
//  - fix an athlete's name / bib for this race
//  - add, rename, reorder, or remove checkpoints
export default function RaceEditor({ raceId, raceAthletes, checkpoints, splits, onChanged }) {
  const sortedAthletes = [...raceAthletes].sort((a, b) => a.sort_order - b.sort_order)
  const sortedCheckpoints = [...checkpoints].sort((a, b) => a.sort_order - b.sort_order)

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // ---- athletes ----
  const [editingAthleteId, setEditingAthleteId] = useState(null)
  const [athleteName, setAthleteName] = useState('')
  const [athleteBib, setAthleteBib] = useState('')

  function startEditAthlete(a) {
    setError('')
    setEditingAthleteId(a.id)
    setAthleteName(a.name || '')
    setAthleteBib(a.bib || '')
  }

  async function saveAthlete(e) {
    e.preventDefault()
    const name = athleteName.trim()
    if (!name) return
    setBusy(true)
    setError('')
    const { error: err } = await supabase
      .from('athletes')
      .update({ name, bib: athleteBib.trim() || null })
      .eq('id', editingAthleteId)
    if (err) {
      setError(err.message)
      setBusy(false)
      return
    }
    // Recorded times keep a copy of the name they were tapped under - keep that in sync.
    await supabase.from('splits').update({ label: name }).eq('athlete_id', editingAthleteId)
    setEditingAthleteId(null)
    setBusy(false)
    onChanged()
  }

  // ---- checkpoints ----
  const [editingCpId, setEditingCpId] = useState(null)
  const [cpLabel, setCpLabel] = useState('')
  const [customCheckpoint, setCustomCheckpoint] = useState('')

  function timesAt(cp) {
    return splits.filter((s) => s.checkpoint_id === cp.id).length
  }

  function labelTaken(label, exceptId) {
    return sortedCheckpoints.some(
      (c) => c.id !== exceptId && c.label.trim().toLowerCase() === label.trim().toLowerCase()
    )
  }

  async function addCheckpoint(label) {
    const clean = label.trim()
    if (!clean) return
    if (labelTaken(clean)) {
      setError(`This race already has a checkpoint called "${clean}".`)
      return
    }
    setBusy(true)
    setError('')
    const nextOrder = sortedCheckpoints.length > 0 ? sortedCheckpoints[sortedCheckpoints.length - 1].sort_order + 1 : 0
    const { error: err } = await supabase
      .from('checkpoints')
      .insert({ race_id: raceId, label: clean, sort_order: nextOrder })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    onChanged()
  }

  async function addPreset(e) {
    const label = e.target.value
    e.target.value = ''
    if (label) await addCheckpoint(label)
  }

  async function addCustom(e) {
    e.preventDefault()
    await addCheckpoint(customCheckpoint)
    setCustomCheckpoint('')
  }

  function startEditCp(cp) {
    setError('')
    setEditingCpId(cp.id)
    setCpLabel(cp.label)
  }

  async function saveCp(e) {
    e.preventDefault()
    const clean = cpLabel.trim()
    if (!clean) return
    if (labelTaken(clean, editingCpId)) {
      setError(`This race already has a checkpoint called "${clean}".`)
      return
    }
    setBusy(true)
    setError('')
    const { error: err } = await supabase.from('checkpoints').update({ label: clean }).eq('id', editingCpId)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setEditingCpId(null)
    onChanged()
  }

  async function moveCp(index, dir) {
    const target = index + dir
    if (target < 0 || target >= sortedCheckpoints.length) return
    const next = [...sortedCheckpoints]
    ;[next[index], next[target]] = [next[target], next[index]]
    setBusy(true)
    setError('')
    // Renumber the whole list so order is always clean, even if sort_order values were uneven.
    const updates = next
      .map((cp, i) => ({ cp, i }))
      .filter(({ cp, i }) => cp.sort_order !== i)
      .map(({ cp, i }) => supabase.from('checkpoints').update({ sort_order: i }).eq('id', cp.id))
    const results = await Promise.all(updates)
    setBusy(false)
    const failed = results.find((r) => r.error)
    if (failed) {
      setError(failed.error.message)
    }
    onChanged()
  }

  async function removeCp(cp) {
    if (sortedCheckpoints.length <= 1) return
    const n = timesAt(cp)
    const message =
      n > 0
        ? `Remove "${cp.label}"? This also permanently deletes the ${n} time${n === 1 ? '' : 's'} recorded at this checkpoint.`
        : `Remove "${cp.label}"?`
    if (!window.confirm(message)) return
    setBusy(true)
    setError('')
    if (n > 0) {
      const { error: splitErr } = await supabase.from('splits').delete().eq('checkpoint_id', cp.id)
      if (splitErr) {
        setError(splitErr.message)
        setBusy(false)
        return
      }
    }
    const { error: err } = await supabase.from('checkpoints').delete().eq('id', cp.id)
    setBusy(false)
    if (err) {
      setError(err.message)
    }
    onChanged()
  }

  const inputCls = 'border border-gray-400 rounded-lg px-3 py-2 text-sm'
  const primaryBtn = 'bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40'
  const linkBtn = 'text-sm text-gray-700 underline disabled:opacity-40'

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 rounded-lg px-3 py-2 text-sm">{error}</div>
      )}

      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Checkpoints</h2>
        <p className="text-sm text-gray-700 mb-3">
          Add, rename, reorder, or remove checkpoints. Times already recorded stay with their checkpoint.
        </p>

        <ul className="border border-gray-300 rounded-lg divide-y divide-gray-200 mb-3">
          {sortedCheckpoints.map((cp, i) => (
            <li key={cp.id} className="px-3 py-3">
              {editingCpId === cp.id ? (
                <form onSubmit={saveCp} className="flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    value={cpLabel}
                    onChange={(e) => setCpLabel(e.target.value)}
                    className={`flex-1 min-w-[120px] ${inputCls}`}
                    autoFocus
                  />
                  <button disabled={busy} className={primaryBtn}>
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingCpId(null)} className={linkBtn}>
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-700 w-5">{i + 1}</span>
                  <span className="flex-1 font-medium text-gray-900">
                    {cp.label}
                    <span className="text-gray-700 font-normal ml-2">
                      ({timesAt(cp)} time{timesAt(cp) === 1 ? '' : 's'})
                    </span>
                  </span>
                  <button
                    onClick={() => moveCp(i, -1)}
                    disabled={busy || i === 0}
                    className="px-2 py-1 text-gray-800 disabled:opacity-30"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveCp(i, 1)}
                    disabled={busy || i === sortedCheckpoints.length - 1}
                    className="px-2 py-1 text-gray-800 disabled:opacity-30"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button onClick={() => startEditCp(cp)} className={linkBtn}>
                    Rename
                  </button>
                  <button
                    onClick={() => removeCp(cp)}
                    disabled={busy || sortedCheckpoints.length <= 1}
                    className="text-sm text-red-700 underline disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <select onChange={addPreset} defaultValue="" disabled={busy} className={inputCls}>
            <option value="">+ Add checkpoint…</option>
            {CHECKPOINT_PRESETS.filter((p) => !labelTaken(p)).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <form onSubmit={addCustom} className="flex gap-2 flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Custom (e.g. Top of hill)"
              value={customCheckpoint}
              onChange={(e) => setCustomCheckpoint(e.target.value)}
              className={`flex-1 ${inputCls}`}
            />
            <button disabled={busy || !customCheckpoint.trim()} className={primaryBtn}>
              Add
            </button>
          </form>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Athletes</h2>
        <p className="text-sm text-gray-700 mb-3">
          Fix a name or bib for this race. This changes the athlete in this race only — to change them everywhere,
          edit them on the Roster page.
        </p>

        <ul className="border border-gray-300 rounded-lg divide-y divide-gray-200">
          {sortedAthletes.map((a) => (
            <li key={a.id} className="px-3 py-3">
              {editingAthleteId === a.id ? (
                <form onSubmit={saveAthlete} className="flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    value={athleteName}
                    onChange={(e) => setAthleteName(e.target.value)}
                    placeholder="Name"
                    className={`flex-1 min-w-[140px] ${inputCls}`}
                    autoFocus
                  />
                  <input
                    type="text"
                    value={athleteBib}
                    onChange={(e) => setAthleteBib(e.target.value)}
                    placeholder="Bib"
                    className={`w-20 ${inputCls}`}
                  />
                  <button disabled={busy} className={primaryBtn}>
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingAthleteId(null)} className={linkBtn}>
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-900 font-medium">
                    {a.name}
                    {a.bib && <span className="text-gray-700 font-normal ml-2">#{a.bib}</span>}
                  </span>
                  <button onClick={() => startEditAthlete(a)} className={linkBtn}>
                    Edit
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
