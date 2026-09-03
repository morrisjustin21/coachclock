import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I to avoid confusion
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export default function RaceList({ session }) {
  const [races, setRaces] = useState([])
  const [teamId, setTeamId] = useState(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    loadRaces()
  }, [])

  async function loadRaces() {
    setLoading(true)

    const { data: membership } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('coach_id', session.user.id)
      .maybeSingle()
    const myTeamId = membership?.team_id || null
    setTeamId(myTeamId)

    const { data: ownRaces } = await supabase
      .from('races')
      .select('*')
      .eq('coach_id', session.user.id)
      .order('created_at', { ascending: false })

    let combined = ownRaces || []

    if (myTeamId) {
      const { data: teamRaces } = await supabase
        .from('races')
        .select('*')
        .eq('team_id', myTeamId)
        .order('created_at', { ascending: false })
      const existingIds = new Set(combined.map((r) => r.id))
      combined = [...combined, ...(teamRaces || []).filter((r) => !existingIds.has(r.id))]
      combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }

    setRaces(combined)
    setLoading(false)
  }

  async function createRace(e) {
    e.preventDefault()
    if (!name.trim()) return
    setError('')

    // Try a couple of times in the rare case of a join code collision
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase
        .from('races')
        .insert({
          name: name.trim(),
          coach_id: session.user.id,
          join_code: generateJoinCode(),
          team_id: teamId,
        })
        .select()
        .single()

      if (!error) {
        setName('')
        navigate(`/race/${data.id}`)
        return
      }
      if (!String(error.message).toLowerCase().includes('join_code')) {
        setError(error.message)
        return
      }
      // otherwise loop and retry with a fresh code
    }
    setError('Could not create race after a few attempts. Please try again.')
  }

  async function deleteRace(race) {
    const confirmed = window.confirm(
      `Delete "${race.name}"? This permanently removes its roster and all recorded times.`
    )
    if (!confirmed) return
    const { error } = await supabase.from('races').delete().eq('id', race.id)
    if (error) {
      setError(error.message)
      return
    }
    setRaces((prev) => prev.filter((r) => r.id !== race.id))
  }

  async function copyCode(race) {
    try {
      await navigator.clipboard.writeText(race.join_code)
      setCopiedId(race.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // Clipboard API can fail on some browsers/permissions - fail silently, code is shown anyway
    }
  }

  async function
