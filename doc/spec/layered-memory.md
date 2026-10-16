# 分层记忆

> 在保留群内 Agent 私有记忆的前提下，增加用户长期记忆和工作区记忆。实现位于 `apps/server/src/multiagents/memory/`，桌面入口在设置页。

## Context

简历中的分层记忆要能跨会话复用：用户偏好和代码风格跟随用户；工作区约定和任务决策跟随工作区目录。现有 `agent_memory_item` 仍是某个 Agent 在某个群内的私有记忆，不替代、不迁移。

## Model

新表 `layered_memory_item`：

| 字段 | 含义 |
| --- | --- |
| `userId` | 所属用户 |
| `layer` | `long_term` 或 `workspace` |
| `type` | 长期：`preference` / `code_style`；工作区：`convention` / `decision` |
| `workspaceKey` | 工作区真实路径。长期记忆为空 |
| `content` | 正文 |
| `sourceType` | `user` / `agent` / `blackboard` |
| `sourceRef` | 来源引用，可空 |
| `status` | `active` / `stale` / `deprecated` |
| `lastUsedAt` | 最近一次注入提示词的时间 |

同一用户、同一层、同一类型、同一工作区键下，规范化正文相同则不再写入。

## Backend API

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/user/memories` | 查询当前用户记忆。`layer` 可选；`workspaceDir` 用于解析工作区键 |
| `POST` | `/user/memories` | 新增一条。工作区记忆必须带 `workspaceDir` |
| `DELETE` | `/user/memories/:id` | 删除当前用户自己的一条 |

## Runtime Flow

1. 用户在设置页维护两层记忆。
2. 群成员 `memory_candidate`：`preference` / `code_style` 写入长期记忆，`convention` / `decision` 写入当前群工作区记忆。其余类型仍写入私有记忆。
3. 成员报告里的黑板 decision 写入黑板后，再抄一条 `decision` 到该群 `workspaceDir`。
4. 单聊 `buildSdkPrompt`、群聊 `ContextAssembler`、Agent Team 发言提示在调用模型前注入两层记忆。工作区键由目录 `realpath` 得到，同一目录的后续会话读到同一批工作区记忆。
5. 注入时更新 `lastUsedAt`。

## Validation

- 类型分流：长期、工作区、私有记忆互不串写。
- 同一真实目录的两条路径得到同一个工作区键，另一目录读不到这些工作区记忆；长期记忆始终注入。
- 重复正文不新增。
- `pnpm -F @agenthub/server test` 与桌面 `typecheck`。

## Known Limits

- 不做旧 `agent_memory_item` 迁移。
- 目录尚不存在时用绝对路径做键，之后若变成符号链接，键可能和 `realpath` 不一致。
- 单聊没有控制面 MCP，不会自动从单聊回复里抽取记忆；单聊只注入，写入靠设置页或群成员报告。
- 每个层最多注入最近 20 条，渲染上限约 2000 字。
