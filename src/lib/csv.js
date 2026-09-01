export function formatTime(ms) {
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

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${raceName.replace(/\s+/g, '_')}_results.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
