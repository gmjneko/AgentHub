# Issue 成员交接与桌面协作

> Issue 模式的成员做完后，可以在评论末尾 @ 同群其他 Agent，服务端串行唤醒下一步。桌面 inspector 补齐负责人、状态、评论 @ 和实时刷新。实现位于群运行时与 `apps/desktop` 的 Issue 面板。

## Context

Issue 的创建、分配、评论和用户 @ 已经能唤醒 Agent。成员摘要目前写成没有 mentions 的评论，提示词里也没有同群其他人，所以开发 Agent 无法把测试交给测试 Agent。桌面 Issue 面板只有标题和纯文本评论。

Agent Team 仍由队长主持 Inbox 讨论，本规格不改那条路径。

## Model

不新增表。复用 `group_issue_comment.mentions`。自动交接深度只存在于一次运行链的内存参数里，不落库。

## Backend API

不新增路由。已有接口继续使用：

| Method | Path | 说明 |
| --- | --- | --- |
| `POST` | `/group-chats/:groupId/issues` | 创建时可带负责人和描述 |
| `PATCH` | `/group-chats/:groupId/issues/:issueId` | 修改负责人或状态，`done` 仍只能由用户设置 |
| `POST` | `/group-chats/:groupId/issues/:issueId/comments` | 评论可带 `mentions` |

## Runtime Flow

1. Issue 派发成员时，把同群其他成员的名称、群角色和能力摘要写进提示。名称必须原样用于 @。
2. 成员或 Orchestrator 的最终摘要若包含 `@名称`，用与用户消息相同的解析得到 agentId。排除作者本人，也排除本轮已经执行过的成员。@ 不修改 Issue 负责人。
3. 当前 run 释放 Issue 锁之后，用这些 mentions 和评论正文再启动一轮。多个 @ 仍在同一 Issue 内串行。
4. 自动交接最多 8 跳。再想交接时写一条系统评论，不再唤醒，等用户评论或重新分配。
5. 桌面 inspector 可创建、改负责人、改状态、在评论里 @。群 SSE 的 `issue_status` / `issue_comment` 刷新面板，并在聊天流里显示摘要；run 结束后再拉一次群状态，以便跟上自动交接产生的下一轮。

## Validation

- `@测试Agent` 解析为对应成员，排除自己，排除本轮已执行成员。
- 第 8 跳之后不再启动下一轮，并留下系统评论。
- 桌面 `typecheck`。Issue 面板可创建、分配、评论 @，SSE 后列表刷新。

## Known Limits

- 不接 GitHub 或其他外部 Webhook。
- @ 只唤醒，不改负责人，也不把 Issue 状态自动设为 `done`。
- 交接深度不跨进程保留。服务重启后未完成的自动链不会续上。
- Issue 被标成阻塞，或本轮已被中止时，不再根据评论里的 @ 继续唤醒。
- 名称解析沿用现有 @ 规则：名称后需要空格，或与成员名精确匹配。
