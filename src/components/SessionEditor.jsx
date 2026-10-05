import { useState } from 'react'
import { supabase } from '../supabaseClient'

const CHECKPOINT_PRESETS = ['1000m', '2000m', '3000m', '4000m', '1mi', '2mi', '3mi', 'Finish']

// ---- Configs: tell the editor which tables/columns belong to a race vs a practice ----

export function raceEditorConfig(raceId) {
  return {
    parentColumn: 'race_id',
    parentId: raceId,
    athleteTable: 'athletes',
    athleteOrderColumn: 'sort_order', // athletes are kept in expected finish order
    splitTable: 'splits',
    splitLinkColumn: 'checkpoint_id',
    itemTable: 'checkpoints',
    itemOrderColumn: 'sort_order',
    itemOrderStart: 0,
    itemNoun: 'checkpoint',
    allowAddItems: true,
    allowReorderItems: true,
    relabelDefaultReps: false,
    presets: CHECKPOINT_PRESETS,
    sessionNoun: 'race',
  }
}

export function workoutEditorConfig(workout) {
  const continuous = workout.mode === 'continuous'
  return {
    parentColumn: 'workout_id',
    parentId: workout.id,
    athleteTable: 'workout_athletes',
    athleteOrderColumn: null, // workout athletes are listed alphabetically
    splitTable: 'workout_splits',
    splitLinkColumn: 'rep_id',
    itemTable: 'workout_reps', // holds reps (intervals) or checkpoints (continuous)
    itemOrderColumn: 'rep_number',
    itemOrderStart: 1,
    itemNoun: continuous ? 'checkpoint' : 'rep',
    allowAddItems: continuous, // interval reps are added with the "next rep" button while running
    allowReorderItems: continuous,
    relabelDefaultReps: !continuous, // after removing a rep, "Rep 4" becomes "Rep 3" etc.
    presets: continuous ? CHECKPOINT_PRESETS : [],
    sessionNoun: 'workout',
  }
}

function relabelDefault(label, n) {
  return /^Rep \d+/.test(label || '') ? label.replace(/^Rep \d+/, `Rep ${n}`) : label
}

// Owner-only tools for changing a race or practice AFTER it has been created:
//  - add / remove athletes, fix a name or bib
//  - add, rename, reorder, or remove checkpoints (or rename / remove reps)
export default function SessionEditor({ config, athletes, items, splits, rosterAthletes = [], onChanged }) {
  const c = config
  const noun = c.itemNoun
  const nounCap = noun.charAt(0).toUpperCase() + noun.slice(1)

  const sortedAthletes = [...athletes].sort((a, b) =>
    c.athleteOrderColumn
      ? (a[c.athleteOrderColumn] ?? 0) - (b[c.athleteOrderColumn] ?? 0)
      : (a.name || '').localeCompare(b.name || '')
  )
  const sortedItems = [...items].sort((a, b) => (a[c.itemOrderColumn] ?? 0) - (b[c.itemOrderColumn] ?? 0))

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function timesAtItem(it) {
    return splits.filter((s) => s[c.splitLinkColumn] === it.id).length
  }
  function timesForAthlete(a) {
    return splits.filter((s) => s.athlete_id === a.id).length
  }
  function plural(n) {
    return `${n} time${n === 1 ? '' : 's'}`
  }

  // =============== ATHLETES ===============
  const [editingAthleteId, setEditingAthleteId] = useState(null)
  const [athleteName, setAthleteName] = useState('')
  const [athleteBib, setAthleteBib] = useState('')
  const [oneOffName, setOneOffName] = useState('')

  const inSession = new Set(athletes.map((a) => a.team_athlete_id).filter(Boolean))
  const addableRoster = rosterAthletes.filter((r) => !inSession.has(r.id))

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
      .from(c.athleteTable)
      .update({ name, bib: athleteBib.trim() || null })
      .eq('id', editingAthleteId)
    if (err) {
      setError(err.message)
      setBusy(false)
      return
    }
    // Recorded times keep a copy of the name they were tapped under - keep that in sync.
    await supabase.from(c.splitTable).update({ label: name }).eq('athlete_id', editingAthleteId)
    setEditingAthleteId(null)
    setBusy(false)
    onChanged()
  }

  async function insertAthlete({ team_athlete_id, name, bib }) {
    setBusy(true)
    setError('')
    const row = { [c.parentColumn]: c.parentId, team_athlete_id, name, bib: bib || null }
    if (c.athleteOrderColumn) {
      const max = sortedAthletes.reduce((m, a) => Math.max(m, a[c.athleteOrderColumn] ?? 0), -1)
      row[c.athleteOrderColumn] = max + 1
    }
    const { error: err } = await supabase.from(c.athleteTable).insert(row)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    onChanged()
  }

  async function addFromRoster(e) {
    const id = e.target.value
    e.target.value = ''
    const r = rosterAthletes.find((x) => x.id === id)
    if (r) await insertAthlete({ team_athlete_id: r.id, name: r.name, bib: r.bib })
  }

  async function addOneOff(e) {
    e.preventDefault()
    const name = oneOffName.trim()
    if (!name) return
    await insertAthlete({ team_athlete_id: null, name, bib: null })
    setOneOffName('')
  }

  async function removeAthlete(a) {
    const n = timesForAthlete(a)
    const message =
      n > 0
        ? `Remove ${a.name} from this ${c.sessionNoun}? This also permanently deletes their ${plural(n)} recorded here.`
        : `Remove ${a.name} from this ${c.sessionNoun}?`
    if (!window.confirm(message)) return
    setBusy(true)
    setError('')
    if (n > 0) {
      const { error: splitErr } = await supabase.from(c.splitTable).delete().eq('athlete_id', a.id)
      if (splitErr) {
        setError(splitErr.message)
        setBusy(false)
        return
      }
    }
    const { error: err } = await supabase.from(c.athleteTable).delete().eq('id', a.id)
    setBusy(false)
    if (err) setError(err.message)
    onChanged()
  }

  // =============== CHECKPOINTS / REPS ===============
  const [editingItemId, setEditingItemId] = useState(null)
  const [itemLabel, setItemLabel] = useState('')
  const [customItem, setCustomItem] = useState('')

  function labelTaken(label, exceptId) {
    return sortedItems.some(
      (it) => it.id !== exceptId && (it.label || '').trim().toLowerCase() === label.trim().toLowerCase()
    )
  }

  // Renumber an ordered list so order values are clean (and default "Rep N" labels follow).
  async function renumber(list) {
    const ops = []
    list.forEach((it, i) => {
      const order = i + c.itemOrderStart
      const patch = {}
      if (it[c.itemOrderColumn] !== order) patch[c.itemOrderColumn] = order
      if (c.relabelDefaultReps) {
        const nl = relabelDefault(it.label, order)
        if (nl !== it.label) patch.label = nl
      }
      if (Object.keys(patch).length > 0) {
        ops.push(supabase.from(c.itemTable).update(patch).eq('id', it.id))
      }
    })
    const results = await Promise.all(ops)
    return results.find((r) => r.error)?.error || null
  }

  async function addItem(label) {
    const clean = label.trim()
    if (!clean) return
    if (labelTaken(clean)) {
      setError(`There is already a ${noun} called "${clean}".`)
      return
    }
    setBusy(true)
    setError('')
    const max = sortedItems.reduce((m, it) => Math.max(m, it[c.itemOrderColumn] ?? 0), c.itemOrderStart - 1)
    const { error: err } = await supabase
      .from(c.itemTable)
      .insert({ [c.parentColumn]: c.parentId, label: clean, [c.itemOrderColumn]: max + 1 })
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
    if (label) await addItem(label)
  }

  async function addCustom(e) {
    e.preventDefault()
    await addItem(customItem)
    setCustomItem('')
  }

  function startEditItem(it) {
    setError('')
    setEditingItemId(it.id)
    setItemLabel(it.label || '')
  }

  async function saveItem(e) {
    e.preventDefault()
    const clean = itemLabel.trim()
    if (!clean) return
    if (labelTaken(clean, editingItemId)) {
      setError(`There is already a ${noun} called "${clean}".`)
      return
    }
    setBusy(true)
    setError('')
    const { error: err } = await supabase.from(c.itemTable).update({ label: clean }).eq('id', editingItemId)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setEditingItemId(null)
    onChanged()
  }

  async function moveItem(index, dir) {
    const target = index + dir
    if (target < 0 || target >= sortedItems.length) return
    const next = [...sortedItems]
    ;[next[index], next[target]] = [next[target], next[index]]
    setBusy(true)
    setError('')
    const err = await renumber(next)
    setBusy(false)
    if (err) setError(err.message)
    onChanged()
  }

  async function removeItem(it) {
    if (sortedItems.length <= 1 && c.itemNoun === 'checkpoint') return
    const n = timesAtItem(it)
    const message =
      n > 0
        ? `Remove "${it.label}"? This also permanently deletes the ${plural(n)} recorded for it.`
        : `Remove "${it.label}"?`
    if (!window.confirm(message)) return
    setBusy(true)
    setError('')
    if (n > 0) {
      const { error: splitErr } = await supabase.from(c.splitTable).delete().eq(c.splitLinkColumn, it.id)
      if (splitErr) {
        setError(splitErr.message)
        setBusy(false)
        return
      }
    }
    const { error: err } = await supabase.from(c.itemTable).delete().eq('id', it.id)
    if (err) {
      setError(err.message)
      setBusy(false)
      onChanged()
      return
    }
    const renumberErr = await renumber(sortedItems.filter((x) => x.id !== it.id))
    if (renumberErr) setError(renumberErr.message)
    setBusy(false)
    onChanged()
  }

  const inputCls = 'border border-gray-400 rounded-lg px-3 py-2 text-sm'
  const primaryBtn = 'bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40'
  const linkBtn = 'text-sm text-gray-700 underline disabled:opacity-40'
  const dangerBtn = 'text-sm text-red-700 underline disabled:opacity-30'

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 rounded-lg px-3 py-2 text-sm">{error}</div>
      )}

      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">{nounCap}s</h2>
        <p className="text-sm text-gray-700 mb-3">
          {c.allowReorderItems
            ? `Add, rename, reorder, or remove ${noun}s. Times already recorded stay with their ${noun}.`
            : `Rename or remove ${noun}s. To add another ${noun}, use the "next ${noun}" button on the ${c.sessionNoun} screen.`}
        </p>

        {sortedItems.length === 0 ? (
          <p className="text-sm text-gray-700 mb-3">No {noun}s yet.</p>
        ) : (
          <ul className="border border-gray-300 rounded-lg divide-y divide-gray-200 mb-3">
            {sortedItems.map((it, i) => (
              <li key={it.id} className="px-3 py-3">
                {editingItemId === it.id ? (
                  <form onSubmit={saveItem} className="flex flex-wrap gap-2 items-center">
                    <input
                      type="text"
                      value={itemLabel}
                      onChange={(e) => setItemLabel(e.target.value)}
                      className={`flex-1 min-w-[120px] ${inputCls}`}
                      autoFocus
                    />
                    <button disabled={busy} className={primaryBtn}>
                      Save
                    </button>
                    <button type="button" onClick={() => setEditingItemId(null)} className={linkBtn}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-700 w-5">{i + 1}</span>
                    <span className="flex-1 font-medium text-gray-900">
                      {it.label}
                      <span className="text-gray-700 font-normal ml-2">({plural(timesAtItem(it))})</span>
                    </span>
                    {c.allowReorderItems && (
                      <>
                        <button
                          onClick={() => moveItem(i, -1)}
                          disabled={busy || i === 0}
                          className="px-2 py-1 text-gray-800 disabled:opacity-30"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => moveItem(i, 1)}
                          disabled={busy || i === sortedItems.length - 1}
                          className="px-2 py-1 text-gray-800 disabled:opacity-30"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                      </>
                    )}
                    <button onClick={() => startEditItem(it)} className={linkBtn}>
                      Rename
                    </button>
                    <button
                      onClick={() => removeItem(it)}
                      disabled={busy || (c.itemNoun === 'checkpoint' && sortedItems.length <= 1)}
                      className={dangerBtn}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {c.allowAddItems && (
          <div className="flex flex-wrap gap-2">
            <select onChange={addPreset} defaultValue="" disabled={busy} className={inputCls}>
              <option value="">+ Add {noun}…</option>
              {c.presets
                .filter((p) => !labelTaken(p))
                .map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
            </select>
            <form onSubmit={addCustom} className="flex gap-2 flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Custom (e.g. Top of hill)"
                value={customItem}
                onChange={(e) => setCustomItem(e.target.value)}
                className={`flex-1 ${inputCls}`}
              />
              <button disabled={busy || !customItem.trim()} className={primaryBtn}>
                Add
              </button>
            </form>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Athletes</h2>
        <p className="text-sm text-gray-700 mb-3">
          Add or remove athletes, or fix a name or bib. Name changes here apply to this {c.sessionNoun} only — to
          change an athlete everywhere, edit them on the Roster page.
        </p>

        {sortedAthletes.length === 0 ? (
          <p className="text-sm text-gray-700 mb-3">No athletes yet.</p>
        ) : (
          <ul className="border border-gray-300 rounded-lg divide-y divide-gray-200 mb-3">
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
                  <div className="flex items-center gap-3 text-sm">
                    <span className="flex-1 text-gray-900 font-medium">
                      {a.name}
                      {a.bib && <span className="text-gray-700 font-normal ml-2">#{a.bib}</span>}
                      <span className="text-gray-700 font-normal ml-2">({plural(timesForAthlete(a))})</span>
                    </span>
                    <button onClick={() => startEditAthlete(a)} className={linkBtn}>
                      Edit
                    </button>
                    <button onClick={() => removeAthlete(a)} disabled={busy} className={dangerBtn}>
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          {addableRoster.length > 0 && (
            <select onChange={addFromRoster} defaultValue="" disabled={busy} className={inputCls}>
              <option value="">+ Add from roster…</option>
              {addableRoster.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          <form onSubmit={addOneOff} className="flex gap-2 flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="One-off athlete name"
              value={oneOffName}
              onChange={(e) => setOneOffName(e.target.value)}
              className={`flex-1 ${inputCls}`}
            />
            <button disabled={busy || !oneOffName.trim()} className={primaryBtn}>
              Add
            </button>
          </form>
        </div>
      </section>
    </div>
  )
}
