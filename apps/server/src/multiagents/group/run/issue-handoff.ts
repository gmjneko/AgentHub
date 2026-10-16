import { parseMentionTokens, type MentionMember } from '../routing/mention-tokens.js'

export const ISSUE_HANDOFF_LIMIT = 8

export const ISSUE_HANDOFF_LIMIT_NOTE =
    '自动交接已达到 8 次，已停止继续唤醒。请评论或重新分配后继续。'

export interface IssuePeer {
    agentId: string
    name: string
    roleInGroup: string | null
    capabilitySummary: string | null
}

export interface IssueHandoffComment {
    authorAgentId: string | null
    authorRole: 'agent' | 'orchestrator'
    body: string
}

export type IssueHandoffResult =
    | { mentions: string[]; text: string }
    | { limitReached: true }
    | null

/** 把同群其他 Agent 写进 Issue 提示，要求用原名 @ 交接。 */
export function renderIssueRosterPrompt(peers: IssuePeer[]): string {
    if (peers.length === 0) return ''
    const lines = peers.map(
        (peer) =>
            `- ${peer.name} | ${peer.roleInGroup?.trim() || '成员'} | ${peer.capabilitySummary?.trim() || '无能力摘要'}`
    )
    return [
        '# 同群其他 Agent',
        '下一步可以交给下面这些 Agent。@ 时名称必须与名册完全一致。',
        ...lines,
        '如果下一步该其他 Agent 做，在最终摘要末尾写：接下来 @名称 进行后续工作。',
        '不要 @ 自己。@ 不会改变 Issue 负责人。'
    ].join('\n')
}

/**
 * 从本轮评论里收集要唤醒的下一批成员。
 * 排除作者本人，以及本轮已经执行过的对象。深度达到上限时不再交接。
 */
export function collectIssueHandoff(input: {
    comments: IssueHandoffComment[]
    members: MentionMember[]
    alreadyRan: string[]
    depth: number
}): IssueHandoffResult {
    const ran = new Set(input.alreadyRan)
    const mentions: string[] = []
    const texts: string[] = []
    for (const comment of input.comments) {
        const accepted = parseMentionTokens(comment.body, input.members).filter((token) => {
            if (comment.authorRole === 'agent' && token === comment.authorAgentId) return false
            if (comment.authorRole === 'orchestrator' && token === 'orchestrator') return false
            return !ran.has(token)
        })
        if (accepted.length === 0) continue
        texts.push(comment.body.trim())
        for (const token of accepted) {
            if (!mentions.includes(token)) mentions.push(token)
        }
    }
    if (mentions.length === 0) return null
    if (input.depth >= ISSUE_HANDOFF_LIMIT) return { limitReached: true }
    return { mentions, text: texts.join('\n\n') }
}
