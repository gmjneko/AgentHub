# 桌面端 Agent 工作台壳层

> 桌面端 renderer 壳层与消息排版改造。入口在 `apps/desktop/src/renderer/src/App.vue`，会话运行仍由 `views/ChatView.vue` 负责。

## Context

原先桌面端是 IM 式三栏：68px 图标栏（单聊 / 群聊资料 / Agents / 设置）+ 合并会话列表 + 气泡消息 + 贴底输入。本模块把它改成经典 Agent 工作台：

- 登录后始终保留一条宽侧栏：新建、搜索、分组「群聊」/「单聊」，底部是 Agents 与设置。
- 中间是文档式 transcript：用户消息右对齐气泡；Agent 回复左侧头像 + 通栏正文（无气泡底），底部为阅读栏内圆角输入条（与消息列表分栏，不叠在最后一条消息上）。
- 右侧是手风琴上下文：环境信息 / 任务清单 / 产物。
- 导航从 `chat | groups | agents | settings` 改为 `workspace | agents | settings`。独立群聊资料页退出主导航；群会话从侧栏进入，资料仍走右侧 inspector。
- 选 Agents / 设置时侧栏不消失，只替换中间与右侧。`ChatView` 保持挂载（`v-show`），后台 turn 围观不丢。

不改 `apps/server`、`packages/shared`、Android。会话 converse / SSE / abort / 置顶归档删除逻辑保持不变。

## Model

不新增后端实体，也不修改共享 API contract。

沿用前端联合会话 key：

- `agent:<chatId>`：单 Agent 聊天
- `group:<groupId>`：群聊

前端新增工作台导航与侧栏状态（`stores/workspace.ts`）：

- `nav`：`workspace | agents | settings`
- 会话列表镜像、`activeSessionKey`、搜索词、侧栏宽度
- 新建单聊 / 新建群聊信号
- ChatView 挂载时注册的 select / pin / archive / delete 处理函数

侧栏分组规则：群聊与单聊各自置顶优先，再按 `updatedAt` 倒序。搜索同时过滤两组。

## Backend API

无新增。沿用现有会话与运行接口。

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/agent-chats` | 单聊列表 |
| `GET` | `/agent-chats/:id/messages` | 单聊消息 |
| `POST` | `/agent-chats/:id/converse` | 单聊发送并订阅运行 |
| `GET` | `/group-chats` | 群聊列表 |
| `GET` | `/group-chats/:id/messages` | 群聊消息 |
| `POST` | `/group-chats/:id/converse` | 群聊发送任务并订阅运行 |
| `GET` | `/group-chats/:id/blackboard` | 群聊黑板 |

## Runtime Flow

1. 鉴权通过后渲染 `WorkspaceSidebar` + 当前 `nav` 对应主区。`ChatView` 始终挂载。
2. `ChatView` 并行加载单聊、群聊、Agent 列表，把会话镜像写入 workspace store。
3. 侧栏按「群聊」「单聊」分组展示；点击某项把 `nav` 切到 `workspace` 并选中该会话。
4. 选择单聊：加载消息与工作区 diff，右侧用 Agent inspector（环境 / 任务 / 产物）。
5. 选择群聊：加载消息、黑板与 diff，右侧用群 inspector（环境 / 任务 / 产物）。
6. 新建入口打开已有「创建单聊 / 创建群聊」弹窗；创建成功后选中新会话。
7. 无选中会话时中间显示空态与新建引导，输入区禁用。
8. Agents / 设置只替换中间+右侧，侧栏与 ChatView 运行时状态保留。

## Validation

- `pnpm -F @agenthub/desktop typecheck`
- 桌面端手测（Electron，无法用 Cursor 浏览器走完）：
  - 侧栏同时出现「群聊」「单聊」两组，不再出现 68px 图标栏。
  - 从侧栏打开单聊 / 群聊：用户消息右对齐气泡，Agent 回复为通栏正文。
  - 悬浮输入可发送；流式与停止仍可用。
  - 新建单聊、新建群聊后自动进入该会话。
  - 置顶、归档、删除仍可用。
  - 切到 Agents / 设置后侧栏仍在；再点子会话回到工作台。
  - 无会话空态与已归档输入禁用。
  - 右侧手风琴展示环境 / 任务 / 产物；工作区 diff 在环境信息内。

## Known Limits

- 不做插件中心、产物中心独立页，也不做最右侧审阅 / 浏览器 / 模拟器工具条。
- 不重写 `ChatView` 流式、围观、abort 逻辑；只抽壳层状态与排版。
- 不改字体栈与色板（继续用现有 Inter + token）。
- `GroupChatView.vue` 退出主导航，文件可保留但不再挂载。
- 交互卡片（质问 / 选项 / 部署 / 任务清单）保留卡片交互，仅改为左对齐并吃满阅读栏。
- Android 不在本次范围。
