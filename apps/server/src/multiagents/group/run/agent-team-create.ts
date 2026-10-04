import type {
    CreateGroupChatPayload,
    GroupChatMode,
    OrchestratorConfigInput
} from '@agenthub/shared'
import { BusinessException } from '../../../common/index.js'

export interface ResolvedGroupChatCreate {
    mode: GroupChatMode
    leaderAgentId: string | null
    orchestrator: OrchestratorConfigInput | null
}

/** 建群模式校验。普通群聊要 Orchestrator；Agent Team 要队长且不接受 Orchestrator。 */
export function resolveGroupChatCreate(
    payload: Pick<
        CreateGroupChatPayload,
        'mode' | 'leaderAgentId' | 'orchestrator' | 'memberAgentIds'
    >
): ResolvedGroupChatCreate {
    const mode = payload.mode ?? 'standard'
    if (mode === 'agent_team') {
        if (payload.orchestrator) {
            throw BusinessException.badRequest('Agent Team groups do not take an Orchestrator')
        }
        const leaderAgentId = payload.leaderAgentId?.trim() ?? ''
        if (!leaderAgentId) {
            throw BusinessException.badRequest('Agent Team requires a leader')
        }
        if (!(payload.memberAgentIds ?? []).includes(leaderAgentId)) {
            throw BusinessException.badRequest('Leader must be one of the member Agents')
        }
        return { mode, leaderAgentId, orchestrator: null }
    }
    if (mode !== 'standard') {
        throw BusinessException.badRequest(`Unknown group chat mode: ${String(mode)}`)
    }
    if (!payload.orchestrator) {
        throw BusinessException.badRequest('Orchestrator config is required')
    }
    return { mode: 'standard', leaderAgentId: null, orchestrator: payload.orchestrator }
}
