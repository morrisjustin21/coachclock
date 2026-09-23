import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import Login from './pages/Login'
import RaceList from './pages/RaceList'
import RacePage from './pages/RacePage'
import TeamRoster from './pages/TeamRoster'
import JoinRace from './pages/JoinRace'
import Team from './pages/Team'
import AthleteHistory from './pages/AthleteHistory'
import Workouts from './pages/Workouts'
import WorkoutPage from './pages/WorkoutPage'
import TrackList from './pages/TrackList'
import TrackRoster from './pages/TrackRoster'
import TrackPage from './pages/TrackPage'
import BottomNav from './components/BottomNav'

function PendingScreen({ status }) {
  return (
    <div className="max-w-sm mx-auto px-4 py-16 text-center">
      <h1 className="text-lg font-semibold mb-2">
        {status === 'blocked' ? 'Account not available' : "You're almost in"}
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        {status === 'blocked'
          ? "This account doesn't have access to Coach's Clock. Reach out if you think that's a mistake."
          : "Your account is created, but Coach's Clock is invite-only right now. Text Justin at (580) 736-5225 to get your team activated."}
      </p>
      <button onClick={() => supabase.auth.signOut()} className="text-sm text-gray-500 underline">
        Sign out
      </button>
    </div>
  )
}

// Wraps every private page. Not logged in -> Login. Logged in but not an
// active coach -> the pending/blocked message instead of the real page.
function Gated({ session, accessStatus, children }) {
  if (!session) return <Login />
  if (accessStatus !== 'active') return <PendingScreen status={accessStatus} />
  return children
}

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [accessStatus, setAccessStatus] = useState(null) // null while checking, else 'pending' | 'active' | 'blocked'

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) checkAccess()
    else setAccessStatus(null)
  }, [session])

  async function checkAccess() {
    setAccessStatus(null)
    // Make sure this account has a coach_access row - brand new signups start
    // 'pending' this way. If a row already exists, this is a no-op and never
    // overwrites whatever status it already has.
    await supabase
      .from('coach_access')
      .upsert(
        { coach_id: session.user.id, email: session.user.email },
        { onConflict: 'coach_id', ignoreDuplicates: true }
      )
    const { data } = await supabase
      .from('coach_access')
      .select('status')
      .eq('coach_id', session.user.id)
      .maybeSingle()
    setAccessStatus(data?.status || 'pending')
  }

  if (loading || (session && !accessStatus)) {
    return <p className="text-center py-8 text-sm text-gray-500">Loading...</p>
  }

  return (
    <>
      <div style={session && accessStatus === 'active' ? { paddingBottom: 64 } : undefined}>
        <Routes>
          <Route
            path="/"
            element={
              <Gated session={session} accessStatus={accessStatus}>
                <RaceList session={session} />
              </Gated>
            }
          />
          <Route
            path="/roster"
            element={
              <Gated session={session} accessStatus={accessStatus}>
                <TeamRoster session={session} />
              </Gated>
            }
          />
          <Route
            path="/join"
            element={
              <Gated session={session} accessStatus={accessStatus}>
                <JoinRace session={session} />
              </Gated>
            }
          />
          <Route
            path="/team"
            element={
              <Gated session={session} accessStatus={accessStatus}>
                <Team session={session} />
              </Gated>
            }
          />
          <Route
            path="/athlete/:teamAthleteId"
            element={
              <Gated session={session} accessStatus={accessStatus}>
                <AthleteHistory />
              </Gated>
            }
          />
          <Route
            path="/workouts"
            element={
              <Gated session={session} accessStatus={accessStatus}>
                <Workouts session={session} />
              </Gated>
            }
          />
          <Route
            path="/workout/:workoutId"
            element={
              <Gated session={session} accessStatus={accessStatus}>
                <WorkoutPage session={session} />
              </Gated>
            }
          />
          <Route
            path="/track"
            element={
              <Gated session={session} accessStatus={accessStatus}>
                <TrackList session={session} />
              </Gated>
            }
          />
          <Route
            path="/track/roster"
            element={
              <Gated session={session} accessStatus={accessStatus}>
                <TrackRoster session={session} />
              </Gated>
            }
          />
          <Route
            path="/track/:trackRaceId"
            element={
              <Gated session={session} accessStatus={accessStatus}>
                <TrackPage session={session} />
              </Gated>
            }
          />
          {/* Always reachable, gate or no gate - this is the public live-results
              link parents/fans open, with or without an account. */}
          <Route path="/race/:raceId" element={<RacePage session={session} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {session && accessStatus === 'active' && <BottomNav />}
    </>
  )
}
