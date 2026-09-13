import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { BusinessException } from '../../../common/index.js'
import type { GroupChat } from '../entities/group-chat.entity.js'
import {
    LlmOrchestratorExecutor,
    preferActionableOrchestratorPlan,
    type OrchestratorDecision,
    type DecisionRequest
} from './orchestrator-executor.js'
import type { AgentEvent } from '../../adapter/index.js'

interface StubRunResult {
    text: string
    success: boolean
    error?: string
    submission?: unknown
    sessionId?: string | null
}

function createPlanner(result: StubRunResult): LlmOrchestratorExecutor {
    const planner = new LlmOrchestratorExecutor(
        {} as never,
        {} as never,
        {} as never,
        { log: () => undefined } as never,
        {} as never
    )
    Object.defineProperty(planner, 'runOrchestrator', {
        value: async () => result
    })
    return planner
}

function planRequest(): DecisionRequest {
    return {
        group: {
            id: 'group-1',
            userId: 'user-1',
            title: 'Test Group',
            status: 'active',
            isPinned: false,
            archivedAt: null,
            workspaceDir: '/tmp/agenthub-test',
            orchestratorVendor: 'claude',
            orchestratorModel: 'test-model',
            orchestratorProviderId: 'provider-1',
            orchestratorSessionId: null,
            projectName: 'Test Project',
            projectGoal: null,
            projectTechStack: null,
            projectStatus: 'planning',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z')
        } as GroupChat,
        userId: 'user-1',
        userText: '各位好',
        routeKind: 'orchestrate',
        mentionedAgentIds: [],
        context: {
            projectGoal: null,
            blackboardSummary: '(blackboard empty)',
            pinnedMessages: '',
            recentUserIntents: ['各位好'],
            memberStatus: [],
            activeTaskGraph: []
        }
    }
}

test('LlmOrchestratorPlanner ignores raw SDK text when MCP submission is available', async () => {
    const note =
        '大家好！欢迎来到 AgentHub。我是 Orchestrator，负责协调大家的工作。请问今天想做什么项目？'
    const json = JSON.stringify({ tasks: [], note })
    const planner = createPlanner({
        text: [json, json, note].join('\n\n'),
        success: true,
        submission: { tasks: [], note },
        sessionId: 'sdk-session-1'
    })

    const plan: OrchestratorDecision = await planner.decide(planRequest())

    assert.equal(plan.note, note)
    assert.equal(plan.displayText, undefined)
    assert.equal(plan.orchestratorSessionId, 'sdk-session-1')
})

test('preferActionableOrchestratorPlan keeps memberTurns after a later empty note', () => {
    const events: AgentEvent[] = [
        {
            type: 'tool_use',
            vendor: 'codex',
            id: '1',
            name: 'mcp:agenthub_control/submit_orchestrator_plan',
            input: {
                tasks: [],
                note: '请产品经理提问',
                memberTurns: [
                    {
                        agentId: 'pm-1',
                        instruction: '向用户提几个关键问题'
                    }
                ]
            },
            status: 'failed',
            kind: 'mcp',
            mcp: { server: 'agenthub_control', tool: 'submit_orchestrator_plan' }
        },
        {
            type: 'tool_use',
            vendor: 'codex',
            id: '2',
            name: 'mcp:agenthub_control/submit_orchestrator_plan',
            input: { tasks: [], note: '我让产品经理去问你。' },
            status: 'completed',
            kind: 'mcp',
            mcp: { server: 'agenthub_control', tool: 'submit_orchestrator_plan' }
        }
    ]
    const chosen = preferActionableOrchestratorPlan(events)
    assert.equal(Array.isArray(chosen?.payload.memberTurns), true)
    assert.equal((chosen?.payload.memberTurns as { agentId: string }[])[0]?.agentId, 'pm-1')
})

test('LlmOrchestratorPlanner rejects text JSON when MCP submission is missing', async () => {
    const note = '大家好！我是 Orchestrator。'
    const planner = createPlanner({
        text: JSON.stringify({ tasks: [], note }),
        success: true,
        sessionId: 'sdk-session-2'
    })

    await assert.rejects(
        () => planner.decide(planRequest()),
        (err: unknown) => {
            assert.ok(err instanceof BusinessException)
            assert.equal(
                (err.details as { reason?: string } | undefined)?.reason,
                'missing submit_orchestrator_plan'
            )
            return true
        }
    )
})
