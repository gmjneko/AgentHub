import {
    TEAM_STALL_NOTE,
    parseTeamReply,
    type TeamInboxEntry,
    type TeamNudge
} from './agent-team-reply.js'

export interface TeamSeat {
    agentId: string
    name: string
    isLeader: boolean
}

export type TeamDiscussionStop = 'addressed_user' | 'stalled' | 'aborted'

export interface TeamDiscussionIO {
    loadInbox(agentId: string): Promise<TeamInboxEntry[]>
    consume(ids: string[]): Promise<void>
    deliver(fromName: string, text: string, exceptAgentId: string): Promise<void>
    postSpeech(seat: TeamSeat, text: string): Promise<void>
    postSystem(text: string): Promise<void>
    speak(seat: TeamSeat, inbox: TeamInboxEntry[], nudge: TeamNudge): Promise<string>
    aborted(): boolean
}

/**
 * 队长优先、一次一个。给用户的话会停住自动讨论。
 * 全员 skip 时不结束，改为追问队长，最多两次。
 */
export async function runTeamDiscussion(
    seats: TeamSeat[],
    io: TeamDiscussionIO
): Promise<TeamDiscussionStop> {
    const leader = seats.find((seat) => seat.isLeader)
    if (!leader) {
        await io.postSystem('Agent Team 没有队长，无法继续讨论。')
        return 'stalled'
    }

    let pending: TeamSeat[] = [
        ...seats.filter((seat) => seat.isLeader),
        ...seats.filter((seat) => !seat.isLeader)
    ]
    let leaderSkips = 0

    const enqueueOthers = (exceptAgentId: string): void => {
        for (const seat of seats) {
            if (seat.agentId === exceptAgentId) continue
            if (pending.some((item) => item.agentId === seat.agentId)) continue
            pending.push(seat)
        }
    }

    const takeTurn = async (
        seat: TeamSeat,
        nudge: TeamNudge,
        inbox?: TeamInboxEntry[]
    ): Promise<string> => {
        const items = inbox ?? (await io.loadInbox(seat.agentId))
        if (items.length > 0) await io.consume(items.map((item) => item.id))
        try {
            return await io.speak(seat, items, nudge)
        } catch (err) {
            if (io.aborted()) return 'skip'
            const message = err instanceof Error ? err.message : String(err)
            await io.postSystem(`${seat.name} 这轮没有完成：${message}`)
            return 'skip'
        }
    }

    const applyReply = async (seat: TeamSeat, raw: string): Promise<TeamDiscussionStop | null> => {
        const parsed = parseTeamReply(raw)
        if (parsed.kind === 'skip') return null
        await io.postSpeech(seat, parsed.text)
        await io.deliver(seat.name, parsed.text, seat.agentId)
        if (parsed.kind === 'user') {
            pending = []
            return 'addressed_user'
        }
        leaderSkips = 0
        enqueueOthers(seat.agentId)
        return null
    }

    while (!io.aborted()) {
        const seat = pending.shift()
        if (!seat) {
            if (leaderSkips >= 2) {
                await io.postSystem(TEAM_STALL_NOTE)
                return 'stalled'
            }
            const nudge: TeamNudge = leaderSkips === 0 ? 'ask' : 'remind'
            const raw = await takeTurn(leader, nudge)
            if (io.aborted()) return 'aborted'
            const stop = await applyReply(leader, raw)
            if (stop) return stop
            if (parseTeamReply(raw).kind === 'skip') leaderSkips += 1
            continue
        }

        const inbox = await io.loadInbox(seat.agentId)
        if (inbox.length === 0) continue
        const raw = await takeTurn(seat, 'none', inbox)
        if (io.aborted()) return 'aborted'
        const stop = await applyReply(seat, raw)
        if (stop) return stop
    }

    return 'aborted'
}
