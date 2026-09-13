import type { ControlMcpToolName } from './names.js'

export interface ControlMcpToolDefinition {
  name: ControlMcpToolName
  description: string
  inputSchema: Record<string, unknown>
}

const PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      minItems: 0,
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          name: { type: 'string' },
          agentId: { type: 'string' },
          deps: { type: 'array', items: { type: 'string' } },
          objective: { type: 'string' }
        },
        required: ['key', 'name', 'agentId', 'deps', 'objective'],
        additionalProperties: false
      }
    },
    memberTurns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          instruction: { type: 'string' }
        },
        required: ['agentId', 'instruction'],
        additionalProperties: false
      }
    },
    contextUpdates: {
      type: 'object',
      properties: {
        projectName: { type: 'string' },
        projectGoal: { type: ['string', 'null'] },
        projectTechStack: { type: 'array', items: { type: 'string' } },
        projectStatus: {
          type: 'string',
          enum: ['planning', 'designing', 'development', 'done']
        },
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              rationale: { type: ['string', 'null'] },
              scope: { type: ['string', 'null'] }
            },
            required: ['content'],
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    },
    note: { type: 'string' }
  },
  required: ['tasks'],
  additionalProperties: false
}

const REVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    complete: { type: 'boolean' },
    summary: { type: 'string' },
    completedItems: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    followUpInstruction: { type: ['string', 'null'] },
    deploy: {
      type: ['object', 'null'],
      properties: {
        mode: { type: 'string', enum: ['static', 'service'] },
        entryPath: { type: 'string' },
        command: { type: 'string' },
        installCommand: { type: 'string' },
        port: { type: 'integer' },
        note: { type: 'string' }
      },
      required: ['mode'],
      additionalProperties: false
    }
  },
  required: ['complete', 'summary', 'completedItems', 'gaps', 'followUpInstruction', 'deploy'],
  additionalProperties: false
}

const MEMBER_QUESTION_ITEMS: Record<string, unknown> = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      header: { type: 'string' },
      question: { type: 'string' },
      multiSelect: { type: 'boolean' },
      allowText: { type: 'boolean' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            description: { type: 'string' }
          },
          required: ['label'],
          additionalProperties: false
        }
      }
    },
    required: ['question'],
    additionalProperties: true
  }
}

const MEMBER_CHAT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    text: { type: 'string' }
  },
  required: ['text'],
  additionalProperties: false
}

const REPORT_FOR_ORCHESTRATOR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['progress', 'question'] },
    text: { type: 'string' },
    needDecision: { type: 'boolean' }
  },
  required: ['kind', 'text'],
  additionalProperties: false
}

const SEND_TO_MEMBER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    action: { type: 'string', enum: ['continue', 'revise'] }
  },
  required: ['text'],
  additionalProperties: false
}

const ASK_USER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    questions: MEMBER_QUESTION_ITEMS
  },
  required: ['text', 'questions'],
  additionalProperties: false
}

const MEMBER_REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    affected: {
      type: 'object',
      properties: {
        artifacts: { type: 'array', items: { type: 'string' } },
        contracts: { type: 'array', items: { type: 'string' } },
        decisions: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: false
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          rationale: { type: 'string' },
          scope: { type: 'string' },
          supersedes: { type: 'array', items: { type: 'string' } }
        },
        required: ['content'],
        additionalProperties: false
      }
    },
    contracts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          contractKey: { type: 'string' },
          spec: { type: 'object', additionalProperties: true },
          approvalRequired: { type: 'boolean' },
          consumers: { type: 'array', items: { type: 'string' } }
        },
        required: ['contractKey', 'spec'],
        additionalProperties: false
      }
    },
    memory_candidate: {
      type: ['object', 'null'],
      properties: {
        content: { type: 'string' },
        type: { type: 'string' },
        module: { type: ['string', 'null'] }
      },
      required: ['content'],
      additionalProperties: false
    }
  },
  required: ['summary'],
  additionalProperties: false
}

export const CONTROL_MCP_TOOL_DEFINITIONS: Record<ControlMcpToolName, ControlMcpToolDefinition> = {
  submit_orchestrator_plan: {
    name: 'submit_orchestrator_plan',
    description:
      'Submit this turn’s orchestration plan. Call this instead of printing a JSON object. tasks and memberTurns must not both be nonempty.',
    inputSchema: PLAN_SCHEMA
  },
  submit_final_review: {
    name: 'submit_final_review',
    description:
      'Submit the Orchestrator final review and optional deploy declaration. Call this instead of printing a JSON object.',
    inputSchema: REVIEW_SCHEMA
  },
  submit_member_chat: {
    name: 'submit_member_chat',
    description:
      'Submit the user-visible lightweight chat reply. text is the only user-visible message. Do not ask the user here.',
    inputSchema: MEMBER_CHAT_SCHEMA
  },
  submit_member_report: {
    name: 'submit_member_report',
    description:
      'Submit the member task completion report. summary is shown to the user. List created or modified deliverable paths in affected.artifacts. Ask the orchestrator with report_for_orchestrator instead of asking the user.',
    inputSchema: MEMBER_REPORT_SCHEMA
  },
  report_for_orchestrator: {
    name: 'report_for_orchestrator',
    description:
      'Report progress or ask the Orchestrator a question. This call blocks until the Orchestrator replies. Do not use this to talk to the user.',
    inputSchema: REPORT_FOR_ORCHESTRATOR_SCHEMA
  },
  send_to_member: {
    name: 'send_to_member',
    description:
      'Reply to the waiting member. text is injected as the report_for_orchestrator tool result. Use continue to let them proceed, revise to ask them to change course.',
    inputSchema: SEND_TO_MEMBER_SCHEMA
  },
  ask_user: {
    name: 'ask_user',
    description:
      'Ask the human a clickable question card. After they answer you will be prompted again and must then call send_to_member or submit_orchestrator_plan.',
    inputSchema: ASK_USER_SCHEMA
  }
}

export function listControlMcpTools(names: readonly ControlMcpToolName[]): ControlMcpToolDefinition[] {
  return names.map((name) => CONTROL_MCP_TOOL_DEFINITIONS[name])
}
