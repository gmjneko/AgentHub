# Group Control MCP Plan

## Steps

1. 在 `@agenthub/agent-core` 新增 `control-mcp`：工具名、JSON Schema、stdio 进程、sink、以及 `withControlMcp` / `applyControlMcpConfig`。
2. 依赖 `@modelcontextprotocol/sdk`，stdio 用官方 `Server` + `StdioServerTransport`。
3. Claude adapter 的 `canUseTool` 对 control MCP 工具直接 `allow`。
4. 群聊四处调用去掉 `outputSchema`，注入 control MCP，只从 `tool_use` + sink 回收载荷，不做文本 JSON 回退：
   - `orchestrator-executor.ts`
   - `orchestrator-final-reviewer.ts`
   - `member-chat.service.ts`
   - `dispatch.service.ts` + `context-assembler.service.ts` 文案
5. 更新 orchestrator 单测与 control-mcp 解析单测。
6. 同步 SERVER_README、agent-core README、adapter README、相关 group-chat spec。

## Files

- `packages/agent-core/src/control-mcp/*`
- `packages/agent-core/src/adapter/claude.ts`
- `packages/agent-core/src/index.ts`
- `packages/agent-core/package.json`
- `apps/server/src/multiagents/group/run/orchestrator-executor.ts`
- `apps/server/src/multiagents/group/run/orchestrator-executor.spec.ts`
- `apps/server/src/multiagents/group/run/orchestrator-final-reviewer.ts`
- `apps/server/src/multiagents/group/run/member-chat.service.ts`
- `apps/server/src/multiagents/group/run/dispatch.service.ts`
- `apps/server/src/multiagents/group/context/context-assembler.service.ts`
- `apps/server/src/multiagents/group/run/control-mcp.spec.ts`
- `doc/spec/group-control-mcp.md`
- `doc/plan/group-control-mcp.md`
- `apps/server/SERVER_README.md`
- `packages/agent-core/README.md`
- `apps/server/src/multiagents/adapter/README.md`
- `doc/spec/group-chat-collaboration-mvp.md`
- `doc/spec/group-chat-orchestrator-final-review.md`
- `doc/spec/group-chat-deploy-card.md`

## Notes

- 控制 MCP 配置在 turn 级注入，不写回 `AgentSession.mcpServers`。
- Orchestrator / Reviewer：Claude 仅允许 control 工具；Codex 省略 `allowedTools` 并改 `permissionMode: plan`（`default` + 空白名单会直接被 Codex adapter 拒绝）。
- 成员 turn 合并用户 MCP 与 control MCP，`agenthub_control` 不可被用户配置覆盖。
