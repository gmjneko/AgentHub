# Agent Team 收件箱群聊

> 建群时可选的另一种协作。队长是已选成员里的一个 Agent，队员在共享工作区里干活。发言写入群聊，并复制到其他成员的 Inbox。实现位于 `apps/server/src/multiagents/group/run/` 与桌面建群对话框。

## Context

普通群聊仍由独立 Orchestrator 拆任务、写黑板、做最终验收。Agent Team 不走这套编排，也不使用 `agenthub_control` MCP。

交流有两份记录：

- 群聊气泡是给人看的发言。
- Inbox 是每个成员自己的待读副本。某个 Agent 往群里发消息时，按自己的名字给其他每个成员各放一条。用户消息同样放入每个成员的 Inbox，名字记为「用户」。

成员下次运行时，未消费的 Inbox 整段拼进那一次提示，并要求模型判断要不要发言。最终回复是纯文本：`skip`、给队友的话，或第一行 `用户` 加给用户的正文。讨论不设发言次数上限，直到有人直接对用户说话后停住，等用户的下一条消息。

## Model

`group_chat` 增加：

| 字段 | 含义 |
| --- | --- |
| `mode` | `standard` 或 `agent_team`，默认 `standard` |
| `leaderAgentId` | Agent Team 的队长；普通群聊为空 |
| `orchestratorVendor` / `orchestratorModel` / `orchestratorProviderId` | 改为可空。Agent Team 不填 |

`GroupChatView.orchestrator` 在 Agent Team 下为 `null`。

新表 `group_inbox_message`：

| 字段 | 含义 |
| --- | --- |
| `groupId` / `runId` | 所属群、产生它的运行 |
| `toAgentId` | 接收者 |
| `fromName` | 发言人名字；用户消息为「用户」 |
| `text` | 正文副本 |
| `consumedAt` | 注入某次运行后标记；空表示未读 |
| `createdAt` | 写入时间 |

一条发言对应每个其他成员一行。注入时按时间拼成 `名字：\n正文`，并设字符上限，优先保留较新的条目。

## Backend API

不新增路由。创建群聊的请求体扩展：

| Method | Path | 说明 |
| --- | --- | --- |
| `POST` | `/group-chats` | `mode=standard` 时 `orchestrator` 仍必填。`mode=agent_team` 时必填 `leaderAgentId`（必须是成员之一），且不接受 `orchestrator` |
| `POST` | `/group-chats/:id/converse` | Agent Team 仍用这条启动运行。运行内不调用编排计划 |

## Runtime Flow

1. 用户消息写入群聊，并放入每个成员的 Inbox。
2. 队长排在队员前面。同一时刻只跑一个 Agent，工作目录是群共享仓库根。直接 `adapter.send()`，不包控制面 MCP。
3. 有未读 Inbox 才调用模型。提示里包含名册、项目目标、未读 Inbox，以及发言判断：整段 `skip`；给队友的正文；或第一行 `用户`、其余是要显示的正文。
4. `skip` 或空白：消费自己的 Inbox，不写群聊，讨论不因此结束。
5. 给队友的正文：写入该 Agent 的群聊气泡，并按名字复制到其他成员的 Inbox，把还不在队列里的成员排进去。
6. 给用户的正文：去掉 `用户` 这一行后写入气泡，同样复制进其他人的 Inbox，然后清空队列，本次运行停住。
7. 队列空了且还没有人给用户发过话时，只再跑队长。队长仍 `skip` 就再提醒一次；还是 `skip` 才写一条系统说明并停住。
8. 对方正在跑的这一轮不插入新的 Inbox。文件和命令工具仍可用，回复本身放在最终正文里。

## Validation

- `pnpm -F @agenthub/server test`
- `pnpm -F @agenthub/desktop typecheck`
- 覆盖：创建校验、发言同时写群聊和他人 Inbox 且带名字、`skip` 不写群聊也不结束讨论、给用户的消息去掉标记后上屏并停住、消费后不再注入、Agent Team 不进入编排计划也不挂控制面 MCP
- 桌面端：建群可切换模式并指定队长；资料面显示队长；发言出现在群聊里

## Known Limits

- 不在推理步之间插入 Inbox。当前适配器没有这个钩子。
- 第一行 `用户` 只给运行时用来停住自动讨论，气泡里不显示这行。
- 全员连续不发言时，队长最多被额外追问两次，然后停住，避免空转。这不是发言次数上限。
- 不并行改同一工作区，不用黑板任务图，不做最终验收，不在对话中创建或邀请临时 Agent。
- 不使用提问卡片或 `ask_user`。
