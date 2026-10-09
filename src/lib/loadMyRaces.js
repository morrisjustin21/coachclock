import { supabase } from '../supabaseClient'

export const DAY_MS = 24 * 60 * 60 * 1000

// Loads the coach's own races plus races belonging to any team they're on.
export async function loadMyRaces(userId) {
  const { data: memberships } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('coach_id', userId)
  const teamIds = (memberships || []).map((m) => m.team_id)

  let teams = []
  if (teamIds.length > 0) {
    const { data: teamRows } = await supabase
      .from('teams')
      .select('id, name')
      .in('id', teamIds)
      .order('name', { ascending: true })
    teams = teamRows || []
  }

  const { data: ownRaces } = await supabase
    .from('races')
    .select('*')
    .eq('coach_id', userId)
    .order('created_at', { ascending: false })

  let races = ownRaces || []

  if (teamIds.length > 0) {
    const { data: teamRaces } = await supabase
      .from('races')
      .select('*')
      .in('team_id', teamIds)
      .order('created_at', { ascending: false })
    const existingIds = new Set(races.map((r) => r.id))
    races = [...races, ...(teamRaces || []).filter((r) => !existingIds.has(r.id))]
    races.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }

  return { teams, races }
}

export async function deleteRace(race) {
  const confirmed = window.confirm(
    `Delete "${race.name}"? This permanently removes its roster and all recorded times.`
  )
  if (!confirmed) return { cancelled: true }
  const { error } = await supabase.from('races').delete().eq('id', race.id)
  return { error }
}

// Splits races into the three groups the main screen needs.
//   top      = live races first, then races finished within the last 24 hours
//   upcoming = created but not started yet (status 'setup')
//   older    = finished more than 24 hours ago, newest first
export function splitRaces(races, now) {
  const cutoff = now - DAY_MS
  const done = (r) => !!r.completed_at
  const doneAt = (r) => new Date(r.completed_at).getTime()

  const live = races.filter((r) => !done(r) && r.status !== 'setup')
  const upcoming = races.filter((r) => !done(r) && r.status === 'setup')
  const justFinished = races
    .filter((r) => done(r) && doneAt(r) > cutoff)
    .sort((a, b) => doneAt(b) - doneAt(a))
  const older = races
    .filter((r) => done(r) && doneAt(r) <= cutoff)
    .sort((a, b) => doneAt(b) - doneAt(a))

  return { top: [...live, ...justFinished], upcoming, older }
}
