# 成员–编排器邮箱通道

> 成员不再直接问用户。进度、协作请示和不确定的问题先 `report_for_orchestrator`（同一轮阻塞等待），由 Orchestrator 决定 `send_to_member` 或 `ask_user`。
> 实现：`packages/agent-core/src/control-mcp/`、`apps/server/src/multiagents/group/run/orchestrator-mailbox.service.ts`，调用点在 dispatch / member-chat / orchestrator-executor。

## Context

群聊原先是批次计划：编排器 `submit_orchestrator_plan` → 成员一轮做完 → `submit_member_chat` / `submit_member_report`（可直接 `awaiting_user_input` 问用户）。成员和编排器之间没有会话内来回；轻量 `submit_member_chat.questions` 也是成员直接问用户。

`agenthub_control` 是单向 sink：stdio 写完即返回。成员 `adapter.send()` 在 MCP 未返回时堵住，宿主不能在同一个 `iterator.next()` 里再跑编排器。同一轮等待必须做成：**成员工具阻塞轮询邮箱文件，宿主用旁路 watcher 跑编排器**。

用户确认：问用户也必须先过编排器；成员调用报告后在同一轮里等回复。

## Model

不新增表。沿用 `group_message.kind = 'agent-question'`（编排器提问时 `senderRole = orchestrator`）和 `agent_interaction`（用户作答，不新开 converse）。

Control MCP 新增工具：

| 角色 | 工具 | 阻塞 | 载荷 |
| --- | --- | --- | --- |
| 成员 | `submit_member_chat` | 否 | `{ text }`，只给用户看。无 `questions`。 |
| 成员 | `report_for_orchestrator` | 是 | `{ kind: "progress" \| "question", text, needDecision? }` |
| 成员 | `submit_member_report` | 否 | 任务收口（artifacts / decisions）。无 `awaiting_user_input` / `questions`。 |
| 编排器 | `send_to_member` | 否 | `{ text, action?: "continue" \| "revise" }`，写邮箱解开成员 |
| 编排器 | `ask_user` | 否（宿主等 interaction） | `{ text, questions }` |
| 编排器 | `submit_orchestrator_plan` / `submit_final_review` | 否 | 外层计划 / 验收；计划回合也可调用 `ask_user` |

邮箱文件（与 sink 并列，目录由 `AGENTHUB_CONTROL_MAILBOX` 指定）：

- `request.json`：`{ id, tool, payload, at }`
- `response.json`：`{ id, text, action?, error? }`

`GroupRunEvent` 增加 `orchestrator_turn_event`，把编排器邮箱/提问回合的 `AgentEvent`（含 `user_input_request`）推到群 run stream。

## Backend API

无新 REST。用户作答走已有 `POST /api/agent-interactions/:id/response`。

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/group-chats/:id/runs/:runId/events` | 增加 `orchestrator_turn_event` |
| `POST` | `/api/agent-interactions/:id/response` | 编排器 `ask_user` 的作答通道 |

## Runtime Flow

1. 成员 turn（task 与轻量 `memberTurns`）注入 `report_for_orchestrator`；task 另保留 `submit_member_report`，轻量/任务均可 `submit_member_chat`。
2. `withControlMcp` 在 `adapter.send` 前 `watchMailbox`。成员调用 `report_for_orchestrator` 时 stdio 写 `request.json` 并轮询 `response.json`。
3. Watcher 把请求送进**按 groupId 串行**的队列（编排器只有一个 SDK 会话）。
4. 邮箱回合：续接 `orchestratorSessionId`，只暴露 `send_to_member` + `ask_user`，**不用** Codex `plan` 沙箱。回合结束后读 sink。
5. 若 `ask_user`：落 orchestrator 提问卡片、发 `user_input_request`、`AgentInteractionService.request` 等到用户。答案再喂回同一编排器会话，直到 `send_to_member`。
6. 宿主写 `response.json`，成员同一轮继续。
7. 每成员 turn 最多 6 次报告往返；每封报告最多 3 次 `ask_user`。邮箱轮询超时等于该成员 turn deadline。
8. 计划回合也可 `ask_user`，同样走 interaction，然后再 `submit_orchestrator_plan`。
9. 任务保持 `in_progress`（成员 SDK 仍在等工具）。旧的 `waiting_input` + converse 恢复仍保留给隐藏 handoff / 存量路径；新提问不走它。

## Validation

- `pnpm -F @agenthub/agent-core typecheck` 与 `pnpm -F @agenthub/server test`
- 覆盖：新工具名解析、邮箱 request/response 协议、stdio 阻塞后读到 response 返回正文
- pinned prompt：成员轻量 prompt 含 `report_for_orchestrator`，不含直接 `questions` 问用户
- `pnpm -F @agenthub/desktop typecheck`
- 手动：成员报告进度后编排器 `send_to_member`；编排器 `ask_user` 出卡片，作答后成员继续；并行成员报告串行处理

## Known Limits

- 本轮不把 `submit_member_report` 并进 `report_for_orchestrator.kind=complete`。
- 成员之间不直发，仍经编排器或黑板。
- 不恢复 Claude `AskUserQuestion`；不把编排器 MCP 做成阻塞等用户（用户等待在宿主 watcher）。
- 邮箱轮询超时跟成员 turn deadline 走（task / 轻量均为 30 分钟），而不是 10 分钟——`ask_user` 等用户发生在同一次成员 MCP 调用内。
- 隐藏 handoff review 暂留，防止成员把问题写进 `submit_member_chat` 正文。
- DAG 并行时多个成员同时报告：编排器串行，其他成员 MCP 继续轮询。
- Codex 计划回合不用 `plan` 只读沙箱（改 `mailbox` + `bypassPermissions`），否则 control MCP 写 sink 会被取消，编排器容易只回 note、不派 `memberTurns`。
