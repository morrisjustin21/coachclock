import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { formatTime } from '../lib/csv'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

const LINE_COLORS = ['#1F3D2B', '#BF3B2B', '#C9A227', '#3B82F6', '#7C3AED', '#DB2777']

export default function AthleteHistory() {
  const { teamAthleteId } = useParams()
  const [athleteName, setAthleteName] = useState('')
  const [labels, setLabels] = useState([])
  const [chartData, setChartData] = useState([])
  const [tableRows, setTableRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadHistory()
  }, [teamAthleteId])

  async function loadHistory() {
    setLoading(true)

    const { data: teamAthlete } = await supabase
      .from('team_athletes')
      .select('name')
      .eq('id', teamAthleteId)
      .maybeSingle()
    setAthleteName(teamAthlete?.name || 'Athlete')

    const { data: athleteRows } = await supabase
      .from('athletes')
      .select('id, race_id')
      .eq('team_athlete_id', teamAthleteId)

    if (!athleteRows || athleteRows.length === 0) {
      setChartData([])
      setTableRows([])
      setLabels([])
      setLoading(false)
      return
    }

    const raceIds = [...new Set(athleteRows.map((a) => a.race_id))]
    const raceIdByRow = {}
    athleteRows.forEach((a) => {
      raceIdByRow[a.id] = a.race_id
    })

    const [{ data: races }, { data: checkpoints }, { data: splits }] = await Promise.all([
      supabase.from('races').select('id, name, created_at').in('id', raceIds),
      supabase.from('checkpoints').select('id, label').in('race_id', raceIds),
      supabase.from('splits').select('athlete_id, checkpoint_id, recorded_time_ms').in('athlete_id', athleteRows.map((a) => a.id)),
    ])

    const raceById = {}
    ;(races || []).forEach((r) => {
      raceById[r.id] = r
    })
    const labelByCheckpoint = {}
    ;(checkpoints || []).forEach((cp) => {
      labelByCheckpoint[cp.id] = cp.label
    })

    // Build one row per race, with a column per checkpoint label seen across the season
    const rowsByRace = {}
    const labelSet = new Set()

    ;(splits || []).forEach((s) => {
      const raceId = raceIdByRow[s.athlete_id]
      const race = raceById[raceId]
      const label = labelByCheckpoint[s.checkpoint_id]
      if (!race || !label) return
      labelSet.add(label)
      if (!rowsByRace[raceId]) {
        rowsByRace[raceId] = { raceId, raceName: race.name, date: race.created_at }
      }
      rowsByRace[raceId][label] = s.recorded_time_ms
    })

    const sortedRows = Object.values(rowsByRace).sort((a, b) => new Date(a.date) - new Date(b.date))
    const sortedLabels = Array.from(labelSet)

    setLabels(sortedLabels)
    setTableRows(sortedRows)
    setChartData(
      sortedRows.map((r) => ({
        ...r,
        dateLabel: new Date(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      }))
    )
    setLoading(false)
  }

  function timeAxisFormatter(ms) {
    return formatTime(ms)
  }

  if (loading) return <p className="text-center py-8 text-sm text-gray-500">Loading...</p>

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link to="/roster" className="text-sm text-gray-500 underline">
        &larr; Roster
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-1">{athleteName}</h1>
      <p className="text-sm text-gray-500 mb-6">Time at each checkpoint across the season</p>

      {chartData.length === 0 ? (
        <p className="text-sm text-gray-400">No recorded race times yet for this athlete.</p>
      ) : (
        <>
          <div className="h-64 mb-8">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="dateLabel" tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={timeAxisFormatter}
                  tick={{ fontSize: 11 }}
                  reversed
                  width={55}
                />
                <Tooltip
                  formatter={(value) => formatTime(value)}
                  labelFormatter={(label, payload) => payload?.[0]?.payload?.raceName || label}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {labels.map((label, i) => (
                  <Line
                    key={label}
                    type="monotone"
                    dataKey={label}
                    stroke={LINE_COLORS[i % LINE_COLORS.length]}
                    connectNulls
                    dot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400">
                <th className="py-2 pr-2">Race</th>
                {labels.map((label) => (
                  <th key={label} className="py-2 px-2 text-right">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.raceId} className="border-t border-gray-100">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{row.raceName}</div>
                    <div className="text-xs text-gray-400">
                      {new Date(row.date).toLocaleDateString()}
                    </div>
                  </td>
                  {labels.map((label) => (
                    <td key={label} className="py-2 px-2 text-right tabular-nums">
                      {row[label] != null ? formatTime(row[label]) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
