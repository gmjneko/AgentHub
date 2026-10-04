import { getCapabilities } from '../../adapter/index.js'
import type { GroupChatView, GroupMemberView, ProjectMeta } from '@agenthub/shared'
import type { Agent } from '../../entities/agent.entity.js'
import type { GroupChat } from '../entities/group-chat.entity.js'
import type { GroupChatMember } from '../entities/group-chat-member.entity.js'

/** (member + agent) -> GroupMemberView */
export function toGroupMemberView(member: GroupChatMember, agent: Agent): GroupMemberView {
    return {
        agentId: agent.id,
        name: agent.name,
        avatar: agent.avatar,
        color: agent.color,
        vendor: agent.vendor,
        capabilities: getCapabilities(agent.vendor),
        roleInGroup: member.roleInGroup,
        capabilitySummary: agent.capabilitySummary ?? null
    }
}

export function toProjectMeta(group: GroupChat): ProjectMeta {
    return {
        name: group.projectName,
        goal: group.projectGoal,
        techStack: group.projectTechStack ?? [],
        status: group.projectStatus
    }
}

export function toGroupChatView(
    group: GroupChat,
    members: Array<{ member: GroupChatMember; agent: Agent }>,
    activeRunId: string | null,
    activeIssueRunIds: string[] = []
): GroupChatView {
    return {
        id: group.id,
        title: group.title,
        status: group.status,
        isPinned: group.isPinned,
        archivedAt: group.archivedAt ? group.archivedAt.toISOString() : null,
        workspaceDir: group.workspaceDir,
        mode: group.mode ?? 'standard',
        leaderAgentId: group.leaderAgentId ?? null,
        orchestrator:
            group.orchestratorVendor && group.orchestratorModel && group.orchestratorProviderId
                ? {
                      vendor: group.orchestratorVendor,
                      model: group.orchestratorModel,
                      providerId: group.orchestratorProviderId
                  }
                : null,
        members: members.map(({ member, agent }) => toGroupMemberView(member, agent)),
        projectMeta: toProjectMeta(group),
        activeRunId,
        ...(activeIssueRunIds.length > 0 ? { activeIssueRunIds } : {}),
        createdAt: group.createdAt.toISOString(),
        updatedAt: group.updatedAt.toISOString()
    }
}
