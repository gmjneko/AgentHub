# Group Control MCP

> 把群聊宿主侧的结构化提交从 `outputSchema` / 文本 JSON 块，改成 Claude 与 Codex 都能调用的 stdio MCP 工具。
> 实现目录：`packages/agent-core/src/control-mcp/`，调用点在 `apps/server/src/multiagents/group/run/`。

## Context

群聊里「分配任务 / 生成计划 / 最终验收 / 成员轻量回复 / 成员收尾报告」目前主要由宿主强制的结构化输出完成：

| 调用点 | 改造前机制 |
| --- | --- |
| Orchestrator 计划（tasks / memberTurns / note / contextUpdates） | `SendOptions.outputSchema` + JSON 文本 |
| Orchestrator 最终验收（complete / summary / deploy） | 同上 |
| 成员轻量聊天 | `outputSchema: { text }` |
| 成员 task 收尾报告 | 解析最终文本里的 ` ```report ` JSON 块 |

这些不是厂商原生的 Todo 工具。Claude 的 `TodoWrite` / `TaskCreate` / `TaskUpdate` 已经是普通工具调用，并归一成 `todo` 事件，**不在本次改造范围**。

`outputSchema` 在 Claude 上走 `outputFormat.json_schema`，在 Codex 上只是解析最终文本。两边能力不对称，而且 Orchestrator 为了禁止写仓库把 `allowedTools` 设成 `[]`，无法再声明「只许提交计划」这一类工具。本次改为注入只读控制面 MCP：模型必须调用指定工具提交载荷，宿主从 `tool_use` 事件和 sink 文件回收结果。

适配层仍保留 `outputSchema` 能力（桌面本地 runner / 远程 adapter 继续转发），群聊这四条路径不再使用它。

## Model

不新增数据库表，不改对外 REST / shared 消息形状。黑板任务、成员 report 写入、最终审查结果的业务字段保持不变。

内部新增：

- MCP 服务名：`agenthub_control`（stdio）
- 工具：
  - `submit_orchestrator_plan` — 原计划 JSON
  - `submit_final_review` — 原最终验收 JSON
  - `submit_member_chat` — `{ text }`，只给用户看
  - `submit_member_report` — 任务收口（无 awaiting_user_input / questions）
  - `report_for_orchestrator` — 成员向编排器请示（阻塞邮箱）
  - `send_to_member` / `ask_user` — 编排器回成员或问用户
- sink 文件：`{ tool, payload, at }`，供事件流未带全参数时回读
- Claude 工具名：`mcp__agenthub_control__<tool>`
- Codex 工具名：`mcp:agenthub_control/<tool>`

## Backend API

无公开 API 变更。

| Method | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/group-chats/:id/converse` | 内部提交通道改为 MCP；对外事件与消息形状不变 |

## Runtime Flow

1. 群聊 turn 启动前，宿主为该次调用创建临时 sink，并把 `agenthub_control` 合并进 `mcpServers`（覆盖同名用户配置，防止劫持）。
2. 按场景限制可见工具：
   - 最终验收：MCP 进程只暴露对应那一个工具。Claude 的 `allowedTools` 只含该 MCP 工具；Codex 不能强制 `allowedTools`，改用 `permissionMode: plan` 只读沙箱。
   - 计划回合：与邮箱回合一样用 `mailbox` 模式。Codex 若用 `plan` 只读沙箱，会把写 sink 的 `submit_orchestrator_plan` 取消成 `user cancelled MCP tool call`，模型再退回一份没有 memberTurns 的 note。
   - 成员 task / 轻量聊天：保留成员原有文件/shell 工具，额外合并 `submit_member_report` / `submit_member_chat` / `report_for_orchestrator`。若成员已有 `allowedTools` 白名单，则追加对应 Claude MCP 工具名。
   - 编排器邮箱回合：只暴露 `send_to_member` / `ask_user`，Codex 不用 plan 沙箱。详见 [`group-orchestrator-mailbox.md`](./group-orchestrator-mailbox.md)。
3. 系统提示与用户 prompt 改为「必须调用指定 MCP 工具提交」，不再要求「只输出 JSON」。
4. Claude adapter 对 `agenthub_control` 工具自动放行，不走 `AskUserQuestion` / 权限卡（否则 Orchestrator 没有 `onInteraction` 时提交会被拒）。
5. 宿主只认 MCP 载荷：最后一次匹配的 `tool_use.input`，事件不完整时再读 sink。不解析模型正文 JSON，也不接受 ` ```report ` / `{text}` 文本块。
6. 未调用对应工具，或载荷缺字段 / 非法指派，该轮直接失败。解析规则仍用 `parsePlanObject` / `parseReviewObject` / `parseReport` / `text` 字段。成员提问走 `report_for_orchestrator`。
7. 控制 MCP 只写入临时 sink，不读写群共享仓库。

## Validation

- agent-core / server typecheck
- `pnpm -F @agenthub/server test`
- 覆盖：工具名解析（Claude / Codex / 短名）、事件回收、sink 回读、计划解析在 MCP payload 下仍忽略旁路 SDK 文本
- 手动：Claude / Codex Orchestrator 派发任务、最终验收出 deploy、成员轻量回复、成员 task 收尾写黑板

## Known Limits

- Claude 原生 `TodoWrite` / `Task*` 不改为 MCP；桌面 todo 事件通道保持原样。
- 隐藏交接审查仍走无状态 `ChatClient`，不是 Agent 结构化输出，也不改 MCP。
- Codex `runStreamed` 无法强制 `allowedTools`；最终验收仍靠 prompt + `plan` 只读沙箱。计划/邮箱回合改用 `bypassPermissions`，因为只读沙箱会取消写 sink 的 control MCP。
- 计划 schema 不再按本轮成员 id 动态 `enum`（stdio 工具 schema 是静态的）；非法 `agentId` 仍由服务端 `parsePlanObject` 丢弃/判失败。
- 模型只吐 JSON、不调用对应 MCP 工具时，该轮失败，没有文本回退。
- 轻量成员回复只认 `submit_member_chat` 的 `text`。提问必须走 `report_for_orchestrator`，由编排器 `ask_user` 出卡片。模型旁路正文不进气泡。某个成员未提交时不中断其余成员，会写一条系统说明。
- `outputSchema` 作为适配层能力保留，群聊宿主路径不再传入。
