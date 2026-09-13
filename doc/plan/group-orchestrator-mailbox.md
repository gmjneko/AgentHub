# 成员–编排器邮箱通道 Plan

## Steps

1. Control MCP：新工具名/schema；`mailbox.ts` 读写 `request.json` / `response.json`；stdio 对 `report_for_orchestrator` 阻塞轮询；`withControlMcp` 提供 `watchMailbox`；新增 `mailbox` 模式（控制面工具、Codex 不用 plan 沙箱）。
2. shared：`GroupRunEvent` 增加 `orchestrator_turn_event`。
3. `OrchestratorMailboxService`：按 groupId 串行队列、邮箱回合、`ask_user` interaction、持久化 `orchestratorSessionId`。
4. `appendAgentQuestion` 允许 `senderRole=orchestrator`。
5. dispatch / member-chat：注入 `report_for_orchestrator`，挂 watcher，去掉成员直接提问；轻量 turn timeout 改为 30 分钟。
6. 计划回合暴露 `ask_user`，作答后再 `submit_orchestrator_plan`。
7. 桌面：处理 `orchestrator_turn_event`；撤销 `submit_member_chat.questions` live 卡片。
8. 同步旧 spec / SERVER_README；补 mailbox 与 prompt 测试。

## Files

- `packages/agent-core/src/control-mcp/{names,schemas,mailbox,stdio-server,host,index}.ts`
- `packages/shared/src/group-chat.ts`
- `apps/server/src/multiagents/group/run/orchestrator-mailbox.service.ts`
- `apps/server/src/multiagents/group/run/{dispatch,member-chat,orchestrator-executor}.service.ts`
- `apps/server/src/multiagents/group/group-message.service.ts`
- `apps/server/src/multiagents/group/group-chat.module.ts`
- `apps/desktop/src/renderer/src/views/ChatView.vue`
- `doc/spec/group-orchestrator-mailbox.md` 及旧 spec / SERVER_README
