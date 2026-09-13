# 桌面端 Agent 工作台壳层 Plan

## 目标

把桌面端从 IM 三栏聊天壳改成经典 Agent 工作台：单一宽侧栏（群聊 / 单聊）、文档式 transcript、底部悬浮输入、右侧环境/任务/产物手风琴。不改后端与 Android。

## 实现步骤

1. 编写 `doc/spec/agent-workspace-shell.md`，并同步 `doc/spec/unified-chat-and-group-overview.md`。

2. 新增 `apps/desktop/src/renderer/src/stores/workspace.ts`
   - `nav`、会话列表镜像、`activeSessionKey`、搜索词、侧栏宽度、新建信号
   - ChatView 注册 select / pin / archive / delete

3. 新增 `WorkspaceSidebar.vue`，替换 `GlobalSidebar` + 会话列表壳
   - 用户 / 品牌、新建下拉、搜索
   - 「群聊」「单聊」可折叠分组
   - 底部 Agents、设置
   - 宽度 220–420，localStorage 沿用 `agenthub:chat-list-width`

4. 改 `App.vue`：鉴权后侧栏常驻；`v-show` 切 ChatView / AgentsView / SettingsView；去掉 `GroupChatView` 挂载。

5. 改 `ChatView.vue`：去掉内嵌 `ChatList`；读写 workspace store；创建弹窗看 store 信号；inspector 宽度计算改为减去侧栏宽度。

6. 文档式中间栏
   - `MessageList` 限宽阅读栏
   - `TextMessage`：用户消息右对齐气泡；Agent 与 `AgentRunMessage` 去气泡、通栏正文
   - 交互卡片左对齐吃满阅读栏
   - `ChatHeader` 细顶栏
   - `MessageInput` 圆角悬浮条
   - `WorkspaceDiffPanel` 移入右侧环境信息

7. 右侧手风琴
   - 新增 `InspectorSection.vue`
   - `RightInspector`：环境（含 diff）/ 任务 / 产物
   - `GroupDetailPanel` inspector 模式同样三段

8. 更新 `apps/desktop/README.md`，跑 `pnpm -F @agenthub/desktop typecheck`。
