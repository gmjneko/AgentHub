/** Orchestrator 的保留提及关键字（前端 @ 也可用 agentId='orchestrator'） */
export const ORCHESTRATOR_TOKENS = ['orchestrator', '编排', '编排器', 'orch']

export interface MentionMember {
    agentId: string
    name: string
}

/** 从原文解析 @。返回 agentId，或命中编排器关键字时返回 'orchestrator'。 */
export function parseMentionTokens(text: string, members: MentionMember[]): string[] {
    const tokens: string[] = []
    const at = /@([^\s@]+)/g
    let match: RegExpExecArray | null
    while ((match = at.exec(text)) !== null) {
        const raw = match[1]
        if (ORCHESTRATOR_TOKENS.some((token) => raw.toLowerCase().startsWith(token))) {
            if (!tokens.includes('orchestrator')) tokens.push('orchestrator')
            continue
        }
        const member = members.find((item) => raw === item.name || raw.startsWith(item.name))
        if (member && !tokens.includes(member.agentId)) tokens.push(member.agentId)
    }
    return tokens
}
