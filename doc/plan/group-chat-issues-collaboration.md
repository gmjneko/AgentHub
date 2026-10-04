# 群聊 Issue 协作模式实施计划

1. 扩展 `@agenthub/shared` 的群聊、Issue、评论、运行事件和消息契约。
2. 新增 server Issue entities、DTO、mapper、service、manager/controller API 与触发/队列运行时。
3. 将 GroupRunStream 扩展为旧群级锁与 Issue 级锁双模式，并把 Issue run 接入现有成员派发与 Orchestrator 会话。
4. 更新 group module、TypeORM entities、OpenAPI DTO 与单元测试。
5. 更新桌面端群聊创建表单、Issue API、Issue inspector、Issue 时间线、Issue 摘要消息和 mention 交互。
6. 运行 shared/server/desktop 类型检查与测试，回顾 Spec 并同步 README。
