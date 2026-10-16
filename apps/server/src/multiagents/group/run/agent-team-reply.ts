/** 未读 Inbox 拼进提示时的字符上限，优先保留较新的条目。 */
export const INBOX_CHAR_BUDGET = 12_000

export const SKIP_TOKEN = 'skip'

/** 最终回复的第一行。只给运行时识别，不显示在气泡里。 */
export const USER_ADDRESS_LINE = '用户'

export const USER_SPEAKER_NAME = '用户'

export const TEAM_STALL_NOTE = '这轮没有人接话，讨论先停在这里。'

export type TeamNudge = 'none' | 'ask' | 'remind'

export interface TeamInboxEntry {
    id: string
    fromName: string
    text: string
}

export type ParsedTeamReply =
    | { kind: 'skip'; text: '' }
    | { kind: 'team'; text: string }
    | { kind: 'user'; text: string }

/** 整段 skip、给队友的正文，或第一行「用户」加给用户的正文。 */
export function parseTeamReply(raw: string): ParsedTeamReply {
    const trimmed = raw.trim()
    if (!trimmed || trimmed === SKIP_TOKEN) return { kind: 'skip', text: '' }
    const lines = trimmed.split(/\r?\n/)
    if (lines[0]?.trim() === USER_ADDRESS_LINE) {
        const text = lines.slice(1).join('\n').trim()
        if (!text) return { kind: 'skip', text: '' }
        return { kind: 'user', text }
    }
    return { kind: 'team', text: trimmed }
}

export function renderInbox(items: TeamInboxEntry[], budget = INBOX_CHAR_BUDGET): string {
    const selected: string[] = []
    let used = 0
    for (let index = items.length - 1; index >= 0; index -= 1) {
        let block = `${items[index].fromName}：\n${items[index].text.trim()}`
        const gap = selected.length > 0 ? 2 : 0
        if (used + gap + block.length > budget) {
            if (selected.length === 0)
                selected.push(block.slice(Math.max(0, block.length - budget)))
            break
        }
        selected.push(block)
        used += gap + block.length
    }
    return selected.reverse().join('\n\n')
}

export function buildTeamTurnPrompt(input: {
    groupTitle: string
    projectName: string
    projectGoal: string | null
    speakerName: string
    isLeader: boolean
    roster: Array<{ name: string; isLeader: boolean }>
    inboxText: string
    pinnedContext: string
    memoryContext?: string
    nudge: TeamNudge
}): string {
    const role = input.isLeader ? '队长' : '队员'
    const roster = input.roster
        .map((member) => `- ${member.name}${member.isLeader ? '（队长）' : ''}`)
        .join('\n')
    const nudge =
        input.nudge === 'ask'
            ? '目前没有人继续发言，也还没有人直接回复用户。请继续跟队友讨论，或者直接给用户一个结论或提问。'
            : input.nudge === 'remind'
              ? '你上一次没有发言。请继续跟队友讨论，或者直接给用户一个结论或提问。'
              : ''
    return [
        input.memoryContext ?? '',
        input.pinnedContext,
        `你是群聊「${input.groupTitle}」的${role}「${input.speakerName}」。`,
        `项目：${input.projectName}`,
        input.projectGoal ? `目标：${input.projectGoal}` : '',
        '成员：',
        roster,
        '收件箱：',
        input.inboxText || '（空）',
        [
            '判断这次要不要发言。最终回复只能是下面三种之一：',
            '- 不发言：最终回复只能是 skip',
            '- 跟队友讨论：最终回复就是要发到群里的那句话',
            '- 问用户，或由队长给出给用户的结论：最终回复第一行只能是 用户，后面另起一行写群里要显示的正文',
            '讨论可以一直进行，直到出现给用户的消息。',
            '回复本身写在最终正文里，不要调用工具来提交这句话。需要查文件或改工作区时仍可以使用你的文件和命令工具。'
        ].join('\n'),
        nudge
    ]
        .filter(Boolean)
        .join('\n\n')
}
