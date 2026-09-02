import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function JoinRace({ session }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleJoin(e) {
    e.preventDefault()
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    setError('')
    setLoading(true)

    const { data: race, error: raceError } = await supabase
      .from('races')
      .select('id, name')
      .eq('join_code', trimmed)
      .maybeSingle()

    if (raceError || !race) {
      setLoading(false)
      setError("Couldn't find a race with that code. Double check it and try again.")
      return
    }

    const { error: joinError } = await supabase
      .from('race_coaches')
      .upsert({ race_id: race.id, coach_id: session.user.id }, { onConflict: 'race_id,coach_id' })

    setLoading(false)

    if (joinError) {
      setError(joinError.message)
      return
    }

    navigate(`/race/${race.id}`)
  }

  return (
    <div className="max-w-sm mx-auto px-4 py-8">
      <Link to="/" className="text-sm text-gray-500 underline">
        &larr; All races
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-1">Join a race</h1>
      <p className="text-sm text-gray-500 mb-6">
        Ask the head coach for their race's join code, then enter it below.
      </p>

      <form onSubmit={handleJoin} className="space-y-3">
        <input
          type="text"
          placeholder="Join code (e.g. K7M2QX)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono tracking-widest uppercase"
          maxLength={6}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Joining...' : 'Join race'}
        </button>
      </form>
    </div>
  )
}
