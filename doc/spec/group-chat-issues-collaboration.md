# 群聊 Issue 协作模式

> 在保留 standard DAG 与 agent_team 的前提下，为群聊增加以 Issue 和评论时间线为载体的协作模式。

## Context

`issues` 模式将群聊协作从一次性消息运行扩展为可追踪的 Issue 生命周期。Issue 归属于一个群聊，由独立 Orchestrator 或成员 Agent 负责，评论与 mention 触发后续运行。不同 Issue 可以并行，同一 Issue 保持串行并合并重复触发。

## Model

- `GroupChatMode` 增加 `issues`；该模式必须配置独立 Orchestrator。
- 新增 `group_issue` 与 `group_issue_comment` 实体。
- `GroupRun` 增加可空 `issueId`；旧模式运行保持为空。
- Issue 状态为 `todo/in_progress/in_review/done/blocked/cancelled`，`done` 只能由用户设置。
- Issue 评论是协作事实源；群聊消息只同步摘要、状态变化和导航信息。

## Backend API

| Method | Path | 说明 |
|---|---|---|
| `GET` | `/group-chats/:groupId/issues` | 查询群内 Issue |
| `POST` | `/group-chats/:groupId/issues` | 创建 Issue 并触发默认负责人 |
| `GET` | `/group-chats/:groupId/issues/:issueId` | 查询 Issue、评论和运行摘要 |
| `PATCH` | `/group-chats/:groupId/issues/:issueId` | 修改 Issue 内容、负责人和状态 |
| `GET` | `/group-chats/:groupId/issues/:issueId/comments` | 查询评论时间线 |
| `POST` | `/group-chats/:groupId/issues/:issueId/comments` | 新增评论并触发运行 |
| `POST` | `/group-chats/:groupId/messages/:messageId/issue` | 群消息转换为 Issue |

## Runtime Flow

1. 创建 Issue 默认分配给 Orchestrator 并创建 Issue run。
2. 分配 Agent 或 Orchestrator 时立即入队。
3. 评论无 mention 时唤醒当前负责人；显式 mention 时唤醒目标，不改变负责人。
4. Orchestrator 使用结构化 issue actions 评论、分配或推进状态；派活后结束本轮。
5. Agent 最终摘要写入 Issue 评论，并可 mention Orchestrator 或其他成员。
6. Issue 使用 `groupId + issueId` 活跃锁；同一 Issue + Agent 重复触发 coalesce，不同 Issue 可并行。

## Validation

- 覆盖模式校验、CRUD 归属、状态权限、mention 路由、队列去重和 Issue 级并发。
- 覆盖 SSE 回放、追尾、abort 与错误收口。
- 保持 standard DAG 与 agent_team 既有测试通过。
- 执行 shared/server/desktop typecheck 与 server tests。

## Known Limits

- 不实现 Autopilot、cron、外部 daemon、跨群 Issue、父子 Issue 或全局 Issue 工作台。
- 当前桌面端提供 Issue 列表和创建入口，评论详情/复杂筛选可继续沿用 REST API 扩展。
- 不做旧数据迁移；旧群聊继续使用原模式。
