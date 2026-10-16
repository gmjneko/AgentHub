# 分层记忆实施计划

1. 在 `@agenthub/shared` 增加分层记忆契约。
2. 新增 `layered_memory_item` 实体、服务和 `/user/memories` API。
3. 群成员报告按类型分流；黑板 decision 同步写入工作区记忆。
4. 单聊提示、ContextAssembler、Agent Team 提示注入记忆。
5. 设置页增加记忆分区。
6. 用纯函数单测覆盖分流、工作区键和跨目录选择。
