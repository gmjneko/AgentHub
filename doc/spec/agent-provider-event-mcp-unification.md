# AgentProvider 事件流与 MCP 统一

## Context

Claude Agent SDK 与 Codex SDK 的事件模型、工具结果和 MCP 配置存在差异，导致群聊消费层出现重复文本、失败误判以及 MCP 配置被丢弃。该改造统一公共事件语义，并保留厂商能力差异。

## Model

`AgentEvent` 增加稳定关联字段、权限请求和用户输入请求事件。工具调用统一使用 started/completed/failed 生命周期；`done.success` 是最终成功判定。

## Backend API

沿用现有 SSE turn stream，新增 interaction request/response 事件；恢复请求复用现有 waiting-input/agent-question 流程。Android 不参与本次协议同步。

## Runtime Flow

Adapter 将 SDK 原始事件转换为统一事件，server 持久化工具步骤并广播群聊事件。需要用户操作时发布 request 事件并暂停任务；用户回复后恢复同一会话。

## Validation

执行 shared、agent-core、server、desktop typecheck，以及 server 测试和 adapter 事件单测。

## Known Limits

Codex SDK 当前没有与 Claude `canUseTool` 等价的宿主回调时，不强行模拟暂停审批，而是返回结构化能力错误。MCP 仅支持 SDK 可表达的原生 server 配置字段。
