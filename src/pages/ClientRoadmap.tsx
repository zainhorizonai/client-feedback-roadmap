import { Map } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useRoadmap, useRoadmapLoaded } from '../lib/roadmap'
import { ROADMAP_STATES } from '../lib/types'
import { RoadmapBoard } from '../components/RoadmapBoard'
import { EmptyState, PageHeader, Skeleton } from '../components/ui'

/** What the client sees: only items published to their project. No controls for changing plans. */
export function ClientRoadmap() {
  const { user } = useAuth()
  const items = useRoadmap().filter((i) => i.clientId === user?.clientId)
  const loaded = useRoadmapLoaded()
  return (
    <>
      <PageHeader eyebrow={user?.clientName} title="Roadmap" subtitle="What we are reviewing, planning and building for you." />
      {!loaded ? <Skeleton /> : items.length === 0 ? (
        <EmptyState icon={<Map className="h-9 w-9" />} title="Nothing on the roadmap yet">
          When we publish plans for your project, you will see them here, with updates as they move forward.
        </EmptyState>
      ) : (
        <RoadmapBoard items={items} states={ROADMAP_STATES} mode="client" />
      )}
    </>
  )
}
