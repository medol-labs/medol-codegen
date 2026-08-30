# TOTO list

- 页面依赖其他聚合信息，下拉查询
- axon5 读模型更新
- 参照 axon4 结构
- 生成项目中附带对应 skills，用于后续代码生成
- 生成代码中 添加 organization 后自动添加了 federation member readmodel，逻辑有问题是添加federation后再维护 partition 才更新。
- 基础镜像 node 22，升级
- 支持显式 UI action 绑定语义，例如 `ui action on UserAccountCatalog`，用于指定 command 按钮挂载到哪个 readmodel/resource；没有显式声明时再使用当前的 owner concept / event projection 推断规则。
