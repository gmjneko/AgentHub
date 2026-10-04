# Agent Team 收件箱群聊实现计划

规格见 [`doc/spec/agent-team.md`](../spec/agent-team.md)。

## 步骤

1. 扩展 `packages/shared/src/group-chat.ts`：`mode`、`leaderAgentId`，`orchestrator` 改为可空，创建请求区分两种模式。
2. `group_chat` 实体同步上述字段；新增 `group_inbox_message`。删除群时一并删除 Inbox。
3. 创建校验：普通群聊仍要 Orchestrator；Agent Team 要队长、拒绝 Orchestrator。
4. 纯函数解析 `skip` / 队友发言 / 给用户的发言，并拼 Inbox 文本。
5. 讨论循环：队长优先、串行、给用户后停住、全员 skip 时追问队长。
6. `AgentTeamRunService` 复用 `scope=group` 会话和共享仓库，直接 `adapter.send()`。`GroupRunExecutor` 在 `mode=agent_team` 时走这条路径，不调用 `runOrchestrated`。
7. 建群对话框增加模式和队长选择。资料面在 Agent Team 下显示队长。运行中的发言追加为现有 Agent 气泡，结束后以服务端群聊记录为准。

## 依赖

桌面端依赖共享类型。讨论循环不依赖控制面 MCP，也不依赖黑板任务图。

## 验证

先跑 `apps/server/src/multiagents/group/run/agent-team.spec.ts`，再跑服务端测试与桌面 `typecheck`。
