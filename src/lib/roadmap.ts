import { useEffect, useSyncExternalStore } from 'react'
import { api, ApiError } from './api'
import { notify } from './toast'
import type { RoadmapItem, RoadmapState } from './types'

interface State { items: RoadmapItem[]; loaded: boolean }
let state: State = { items: [], loaded: false }
const listeners = new Set<() => void>()
const set = (next: State) => { state = next; listeners.forEach((l) => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export const useRoadmap = () => useSyncExternalStore(subscribe, () => state).items
export const useRoadmapLoaded = () => useSyncExternalStore(subscribe, () => state).loaded
export const resetRoadmap = () => set({ items: [], loaded: false })

export async function refreshRoadmap() {
  try {
    const { items } = await api.get<{ items: RoadmapItem[] }>('/api/roadmap')
    set({ items, loaded: true })
  } catch (e) {
    if (!state.loaded) set({ ...state, loaded: true })
    if (!(e instanceof ApiError && e.status === 401)) console.error(e)
  }
}

export function useRoadmapSync() {
  useEffect(() => {
    refreshRoadmap()
    const t = setInterval(refreshRoadmap, 30_000)
    return () => clearInterval(t)
  }, [])
}

const upsert = (item: RoadmapItem) =>
  set({ ...state, items: state.items.some((i) => i.id === item.id) ? state.items.map((i) => (i.id === item.id ? item : i)) : [item, ...state.items] })

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong')

export interface ItemInput {
  clientId: string
  title: string
  description: string
  state: RoadmapState
  targetWindow: string
  clientUpdate: string
  published: boolean
  reportIds: string[]
}

export async function createItem(input: ItemInput): Promise<boolean> {
  try {
    upsert((await api.post<{ item: RoadmapItem }>('/api/admin/roadmap', input)).item)
    notify(input.published ? 'Roadmap item added and published.' : 'Roadmap item added. It is not visible to the client until you publish it.')
    return true
  } catch (e) {
    notify(message(e), 'error')
    return false
  }
}

export async function updateItem(id: string, patch: Partial<Omit<ItemInput, 'clientId'>>, okText?: string): Promise<boolean> {
  const before = state.items
  // Show the change straight away, and put it back if the server refuses it.
  set({ ...state, items: state.items.map((i) => (i.id === id ? { ...i, ...(patch.state ? { state: patch.state } : {}), ...(patch.published !== undefined ? { published: patch.published } : {}) } : i)) })
  try {
    upsert((await api.patch<{ item: RoadmapItem }>(`/api/admin/roadmap/${id}`, patch)).item)
    if (okText) notify(okText)
    return true
  } catch (e) {
    set({ ...state, items: before })
    notify(message(e), 'error')
    return false
  }
}

export async function deleteItem(id: string): Promise<boolean> {
  try {
    await api.del(`/api/admin/roadmap/${id}`)
    set({ ...state, items: state.items.filter((i) => i.id !== id) })
    notify('Roadmap item deleted. Its reports are unchanged.')
    return true
  } catch (e) {
    notify(message(e), 'error')
    return false
  }
}
