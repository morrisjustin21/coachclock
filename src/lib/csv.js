export function formatTime(ms) {
  if (ms == null) return ''
  const totalTenths = Math.floor(ms / 100)
  const tenths = totalTenths % 10
  const totalSec = Math.floor(ms / 1000)
  const sec = totalSec % 60
  const min = Math.floor(totalSec / 60)
  return (
    String(min).padStart(2, '0') +
    ':' +
    String(sec).padStart(2, '0') +
    '.' +
    tenths
  )
}

function triggerDownload(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Results for a single checkpoint
export function downloadCSV(raceName, splits) {
  const header = ['Place', 'Bib/Name', 'Time']
  const rows = splits.map((s, i) => [
    i + 1,
    s.label || `Finish ${i + 1}`,
    formatTime(s.recorded_time_ms),
  ])
  const csvContent = [header, ...rows]
    .map((row) => row.map((cell) => `"${cell}"`).join(','))
    .join('\n')

  triggerDownload(`${raceName.replace(/\s+/g, '_')}_results.csv`, csvContent)
}

// Full race report: one row per runner, cumulative time + segment split at every checkpoint
export function buildReportRows(checkpoints, raceAthletes, splits) {
  const sortedCheckpoints = [...checkpoints].sort((a, b) => a.sort_order - b.sort_order)

  // athlete_id -> checkpoint_id -> split
  const byAthlete = {}
  splits.forEach((s) => {
    if (!byAthlete[s.athlete_id]) byAthlete[s.athlete_id] = {}
    byAthlete[s.athlete_id][s.checkpoint_id] = s
  })

  const rows = raceAthletes.map((athlete) => {
    const times = byAthlete[athlete.id] || {}
    let prevCumulative = 0
    const checkpointCells = sortedCheckpoints.map((cp) => {
      const split = times[cp.id]
      const cumulative = split ? split.recorded_time_ms : null
      const segment = cumulative != null ? cumulative - prevCumulative : null
      if (cumulative != null) prevCumulative = cumulative
      return { checkpointId: cp.id, label: cp.label, cumulative, segment }
    })
    return { athlete, checkpointCells }
  })

  // Sort by progress: finishers (have a time at the last checkpoint) first, fastest first;
  // then partial finishers by how far they got and how fast; then everyone else in original order.
  const lastCp = sortedCheckpoints[sortedCheckpoints.length - 1]
  rows.sort((a, b) => {
    const aLast = lastCp ? a.checkpointCells.find((c) => c.checkpointId === lastCp.id)?.cumulative : null
    const bLast = lastCp ? b.checkpointCells.find((c) => c.checkpointId === lastCp.id)?.cumulative : null
    if (aLast != null && bLast != null) return aLast - bLast
    if (aLast != null) return -1
    if (bLast != null) return 1

    // Neither finished - compare furthest checkpoint reached
    for (let i = sortedCheckpoints.length - 1; i >= 0; i--) {
      const cpId = sortedCheckpoints[i].id
      const aVal = a.checkpointCells.find((c) => c.checkpointId === cpId)?.cumulative
      const bVal = b.checkpointCells.find((c) => c.checkpointId === cpId)?.cumulative
      if (aVal != null && bVal != null) return aVal - bVal
      if (aVal != null) return -1
      if (bVal != null) return 1
    }
    return 0
  })

  return { sortedCheckpoints, rows }
}

export function downloadReportCSV(raceName, checkpoints, raceAthletes, splits) {
  const { sortedCheckpoints, rows } = buildReportRows(checkpoints, raceAthletes, splits)

  const header = ['Runner']
  sortedCheckpoints.forEach((cp) => {
    header.push(`${cp.label} (time)`, `${cp.label} (split)`)
  })

  const dataRows = rows.map(({ athlete, checkpointCells }) => {
    const row = [athlete.name]
    checkpointCells.forEach((c) => {
      row.push(formatTime(c.cumulative), formatTime(c.segment))
    })
    return row
  })

  const csvContent = [header, ...dataRows]
    .map((row) => row.map((cell) => `"${cell ?? ''}"`).join(','))
    .join('\n')

  triggerDownload(`${raceName.replace(/\s+/g, '_')}_full_report.csv`, csvContent)
}
