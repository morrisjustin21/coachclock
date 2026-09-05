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
import BottomNav from './components/BottomNav'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

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

  if (loading) return <p className="text-center py-8 text-sm text-gray-500">Loading...</p>

  return (
    <>
      <div style={session ? { paddingBottom: 64 } : undefined}>
        <Routes>
          <Route path="/" element={session ? <RaceList session={session} /> : <Login />} />
          <Route path="/roster" element={session ? <TeamRoster session={session} /> : <Login />} />
          <Route path="/join" element={session ? <JoinRace session={session} /> : <Login />} />
          <Route path="/team" element={session ? <Team session={session} /> : <Login />} />
          <Route path="/athlete/:teamAthleteId" element={session ? <AthleteHistory /> : <Login />} />
          <Route path="/workouts" element={session ? <Workouts session={session} /> : <Login />} />
          <Route path="/workout/:workoutId" element={session ? <WorkoutPage session={session} /> : <Login />} />
          <Route path="/race/:raceId" element={<RacePage session={session} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {session && <BottomNav />}
    </>
  )
}
