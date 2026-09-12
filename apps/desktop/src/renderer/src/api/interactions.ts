import type { AgentInteractionResponse, AgentInteractionEvent } from '@agenthub/shared'
import { http } from './http'

export interface PendingAgentInteraction {
  id: string
  sessionId: string
  turnId: string
  groupId: string | null
  event: AgentInteractionEvent
  expiresAt: string
}

export const interactionApi = {
  list: (scope: { chatId?: string; groupId?: string }) =>
    http.get<PendingAgentInteraction[]>(`/agent-interactions?${new URLSearchParams(scope as Record<string, string>)}`),
  respond: (requestId: string, response: AgentInteractionResponse) =>
    http.post<{ accepted: true }>(`/agent-interactions/${requestId}/response`, response)
}
