import { useEffect, useState } from 'react'
import { api } from './api'

export interface TeamMember { id: string; name: string }
let cache: TeamMember[] | null = null

/** The people reports can be assigned to. Loaded once per visit. */
export function useTeam(): TeamMember[] {
  const [team, setTeam] = useState<TeamMember[]>(cache ?? [])
  useEffect(() => {
    if (cache) return
    api.get<{ team: TeamMember[] }>('/api/admin/team').then((r) => { cache = r.team; setTeam(r.team) }).catch(() => {})
  }, [])
  return team
}
