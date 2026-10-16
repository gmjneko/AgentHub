import type {
  CreateLayeredMemoryPayload,
  LayeredMemoryItem,
  ListLayeredMemoryQuery
} from '@agenthub/shared'
import { http } from './http'

export const memoryApi = {
  list: (query: ListLayeredMemoryQuery = {}) => {
    const params = new URLSearchParams()
    if (query.layer) params.set('layer', query.layer)
    if (query.workspaceDir) params.set('workspaceDir', query.workspaceDir)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    return http.get<LayeredMemoryItem[]>(`/user/memories${suffix}`)
  },
  create: (payload: CreateLayeredMemoryPayload) =>
    http.post<LayeredMemoryItem>('/user/memories', payload),
  remove: (id: string) => http.delete<{ deleted: true }>(`/user/memories/${id}`)
}
