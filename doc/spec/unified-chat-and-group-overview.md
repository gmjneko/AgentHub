# 统一聊天列表与群聊资料页

> 桌面端 renderer 功能改造，涉及 `apps/desktop/src/renderer/src/views` 与 `components`。
> 主导航与侧栏分组的现行规格见 `doc/spec/agent-workspace-shell.md`。

## Context

单 Agent 聊天与群聊共用同一工作台。现行壳层：

- 左侧宽侧栏按「群聊」「单聊」分组，不再使用合并成一条的 IM 列表，也不再使用独立群聊资料页作为主导航。
- 群聊列表项可显示成员拼接头像。
- 选中群聊后，中间是会话 transcript，右侧 inspector 展示成员、目标、黑板任务与产物。

历史实现曾把单聊和群聊混在同一个聊天列表，并把 `GroupChatView` 做成资料浏览页；该资料页已退出主导航。

## Model

不新增后端模型，也不修改共享 API contract。

前端本地联合会话列表项概念：

- `agent:<chatId>`：单 Agent 聊天列表 key。
- `group:<groupId>`：群聊列表 key。

群聊头像使用 `GroupMemberView[]` 中的 `name`、`avatar`、`color` 渲染，不需要后端额外返回头像合成图。

## Backend API

使用现有 API。

| Method | Path                          | 说明                   |
| ------ | ----------------------------- | ---------------------- |
| `GET`  | `/agent-chats`                | 获取单聊列表           |
| `GET`  | `/agent-chats/:id/messages`   | 获取单聊消息           |
| `POST` | `/agent-chats/:id/converse`   | 单聊发送消息并订阅运行 |
| `GET`  | `/group-chats`                | 获取群聊列表           |
| `GET`  | `/group-chats/:id/messages`   | 获取群聊消息           |
| `POST` | `/group-chats/:id/converse`   | 群聊发送任务并订阅运行 |
| `GET`  | `/group-chats/:id/blackboard` | 获取群聊黑板           |

## Runtime Flow

1. 进入工作台时并行加载单聊、群聊、Agent 列表。
2. 侧栏按「群聊」「单聊」分组，各组内置顶优先、更新时间倒序。
3. 选择单聊时使用现有单聊消息、运行订阅、右侧 Agent inspector。
4. 选择群聊时加载群聊详情、消息和黑板；发送消息走群聊 converse API。
5. 群聊运行期间列表项显示运行态，消息与黑板在关键事件后刷新。
6. 群聊资料不再占用独立导航页，改在工作台右侧 inspector 展示成员、目标、工作区、Orchestrator 和黑板摘要。

## Validation

- `pnpm typecheck`
- 手动在桌面端验证：
  - 侧栏同时出现群聊与单聊分组。
  - 群聊头像由成员头像/首字拼接。
  - 选中群聊后中间是会话而不是独立资料页；右侧显示资料与黑板。

## Known Limits

- 群聊头像在前端实时拼接，不生成持久化图片。
- 群聊消息回复引用暂不持久化到群聊后端；群聊发送只提交文本。
- 本次不处理旧置顶 localStorage key 的迁移。
- `GroupChatView.vue` 已退出主导航，详见 `agent-workspace-shell` spec。
