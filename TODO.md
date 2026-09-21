# TOTO list

- 页面依赖其他聚合信息，下拉查询
- axon5 读模型更新
- 参照 axon4 结构
- 生成项目中附带对应 skills，用于后续代码生成
- 生成代码中 添加 organization 后自动添加了 federation member readmodel，逻辑有问题是添加federation后再维护 partition 才更新。
- 基础镜像 node 22，升级
- 支持显式 UI action 绑定语义，例如 `ui action on UserAccountCatalog`，用于指定 command 按钮挂载到哪个 readmodel/resource；没有显式声明时再使用当前的 owner concept / event projection 推断规则。
- 优化 Axon 生成项目的 processor 资源使用：生成的集成测试应复用统一的 Spring Test `ApplicationContext`，并允许测试环境关闭无关的 streaming processors，避免完整测试套件因重复启动大量 processor 耗尽 native threads；生产配置应支持按 processor 配置 segment 数、worker 数和自动启动策略，普通 read model 与低频 automation 默认使用保守并发度，并补充线程数、事件积压和 token claim 的监控建议。
- 前端生成器参考 Backstage 的 extension / override 体系演进：在保持当前轻量扩展点的基础上，逐步引入 typed extension points / override registry，用于覆盖 resource page、toolbar、row actions、field renderer、menu icon、header action 等可变区域；默认生成实现作为 fallback，业务项目在稳定手写目录维护 override，避免直接修改 generated contexts/pages。
- 前端扩展体系需要参考 Backstage 文档设计方式同步补全文档：MEDOL/codegen model 应输出每个 frontend application、resource、command、field 对应的可扩展点清单、默认实现、override 类型签名、稳定文件路径和示例；生成项目 README/AGENTS/开发文档中也应包含这些内容，便于开发者知道哪些地方可覆盖、哪些生成文件不要改。
