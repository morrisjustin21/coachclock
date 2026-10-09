import { Link } from 'react-router-dom'

function timeAgo(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}

// variant: 'live' | 'justFinished' | 'upcoming' | 'done'
export default function RaceRow({ race: r, teams, userId, variant, onDelete, onCopy, copiedId }) {
  const isOwner = r.coach_id === userId
  const isDone = variant === 'done'

  const box = {
    live: 'border-2 border-red-600 bg-white',
    justFinished: 'border-2 border-gray-900 bg-white',
    upcoming: 'border border-gray-200 bg-white',
    done: 'border border-gray-200 bg-gray-50',
  }[variant]

  let statusLine
  if (variant === 'live') {
    statusLine = (
      <span className="flex items-center gap-1.5 text-red-600 font-semibold">
        <span className="inline-block w-2 h-2 rounded-full bg-red-600 animate-pulse" />
        LIVE
      </span>
    )
  } else if (variant === 'justFinished') {
    statusLine = <span className="text-gray-900 font-medium">✓ Finished {timeAgo(r.completed_at)}</span>
  } else if (variant === 'upcoming') {
    statusLine = <span>Not started · {new Date(r.created_at).toLocaleDateString()}</span>
  } else {
    statusLine = <span>✓ Finished {new Date(r.completed_at).toLocaleDateString()}</span>
  }

  return (
    <li className={`rounded-lg px-4 ${isDone ? 'py-2' : 'py-3'} ${box}`}>
      <div className="flex items-center gap-2">
        <Link to={`/race/${r.id}`} className="flex-1 block hover:opacity-70">
          <div
            className={`flex items-center gap-2 ${
              isDone ? 'text-sm text-gray-700' : 'font-medium text-sm'
            }`}
          >
            {r.name}
            {r.team_id && (
              <span className="text-[10px] uppercase tracking-wide text-gray-600 border border-gray-200 rounded-full px-1.5 py-0.5">
                {teams.find((t) => t.id === r.team_id)?.name || 'Team'}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-700 mt-0.5">{statusLine}</div>
        </Link>
        {isOwner && (
          <button
            onClick={() => onDelete(r)}
            className="text-gray-600 hover:text-red-600 text-sm px-2"
            aria-label={`Delete ${r.name}`}
          >
            ✕
          </button>
        )}
      </div>

      {/* Join code only matters while a race is still being run */}
      {isOwner && (variant === 'live' || variant === 'upcoming') && r.join_code && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-600">Join code:</span>
          <span className="text-xs font-mono font-semibold tracking-wider">{r.join_code}</span>
          <button onClick={() => onCopy(r)} className="text-xs text-gray-700 underline ml-1">
            {copiedId === r.id ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
    </li>
  )
}
