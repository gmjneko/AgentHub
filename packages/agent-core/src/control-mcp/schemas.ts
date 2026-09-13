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

const MEMBER_CHAT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    text: { type: 'string' }
  },
  required: ['text'],
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
    },
    awaiting_user_input: { type: 'boolean' },
    question: { type: 'string' },
    questions: {
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
      'Submit the user-visible lightweight chat reply. text is shown as the member’s message.',
    inputSchema: MEMBER_CHAT_SCHEMA
  },
  submit_member_report: {
    name: 'submit_member_report',
    description:
      'Submit the member task completion report. summary is shown to the user. List created or modified deliverable paths in affected.artifacts. Set awaiting_user_input when the task must pause for the user.',
    inputSchema: MEMBER_REPORT_SCHEMA
  }
}

export function listControlMcpTools(names: readonly ControlMcpToolName[]): ControlMcpToolDefinition[] {
  return names.map((name) => CONTROL_MCP_TOOL_DEFINITIONS[name])
}
