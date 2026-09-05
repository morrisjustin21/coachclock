import { Link, useLocation } from 'react-router-dom'

function StopwatchIcon(props) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2" />
      <path d="M9 3h6" />
      <path d="M12 3v2" />
    </svg>
  )
}

function RunnerIcon(props) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="6" cy="17" r="1.5" />
      <circle cx="14" cy="5" r="1.5" />
      <path d="M14 7l-3 5 3 2-1 5" />
      <path d="M10 12L6 10l-2 3" />
    </svg>
  )
}

function TeamIcon(props) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="9" cy="7" r="3" />
      <circle cx="17" cy="8" r="2.5" />
      <path d="M2 21v-1a6 6 0 0 1 12 0v1" />
      <path d="M14 21v-1a5 5 0 0 1 7-4.5" />
    </svg>
  )
}

function RosterIcon(props) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 3v2h6V3" />
      <path d="M8 10h8M8 14h8M8 18h5" />
    </svg>
  )
}

const TABS = [
  {
    key: 'race',
    label: 'Race',
    to: '/',
    Icon: StopwatchIcon,
    match: (p) => p === '/' || p.startsWith('/race/') || p === '/join',
  },
  {
    key: 'practice',
    label: 'Practice',
    to: '/workouts',
    Icon: RunnerIcon,
    match: (p) => p.startsWith('/workout'),
  },
  {
    key: 'team',
    label: 'Team',
    to: '/team',
    Icon: TeamIcon,
    match: (p) => p === '/team',
  },
  {
    key: 'roster',
    label: 'Roster',
    to: '/roster',
    Icon: RosterIcon,
    match: (p) => p.startsWith('/roster') || p.startsWith('/athlete/'),
  },
]

export default function BottomNav() {
  const location = useLocation()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-40"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map((tab) => {
        const active = tab.match(location.pathname)
        return (
          <Link
            key={tab.key}
            to={tab.to}
            className={`flex-1 flex flex-col items-center gap-0.5 pt-1.5 pb-2 text-[10px] font-medium ${
              active ? 'text-gray-900' : 'text-gray-400'
            }`}
          >
            <tab.Icon />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
