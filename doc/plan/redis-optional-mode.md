# Redis 可选开关实施计划

规格见 `../spec/redis-optional-mode.md`，已由用户确认并授权实施。

1. 新增严格的 Redis 模式配置与条件客户端工厂，关闭模式使用 null 客户端；统一监听选择及启动日志。
2. 新增可清理的 TTL 存储，替换 token 黑名单和群聊热上下文直接使用 Redis 的部分。
3. 新增复用内存运行流，在 TurnStream / GroupRunStream 内部选择后端，保持 Redis 分支行为及外部方法。
4. 修正单聊订阅内部归属参数；确保 SSE 断开可以立即取消内存流等待者，完成事件不被提前关闭吞掉。
5. 补充配置/存储/运行流/SSE 取消/Redis 路径测试，执行最小相关测试与 server 类型检查。
6. 更新环境变量示例、根 README 与 SERVER_README，回顾规格并记录验证结果和限制。
