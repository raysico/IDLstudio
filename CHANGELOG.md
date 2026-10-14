# 更新记录 (Changelog)

## 0.2.0 (2026-10-14)
- **导入续写（阶段一）**：新增 OpenAPI 3.x yaml/json 导入，反解回 IDL 后可在表单续写（`public/importer.js` + 顶部「导入」入口）。
- **proto 无损属性**：IDL 新增 `tag`（字段编号）、`imports`（项目）、`reserved`（模型，编号/名称）；proto 生成器发射字段编号、`import`、`reserved`（自动避让 reserved、支持 `2 to 11` 区间）。
- **「日志」标签页**：右侧新增日志 tab，集中展示导入错误报告与丢失记录；localStorage 持久化（上限 200 条），含「清空」。
- **品牌标识**：标题更新为 `IDLstudio by hoxiudimdim`。
- **修复**：导入弹窗无法关闭（`modal-overlay[hidden]` 被 `display:flex` 覆盖）。

## 0.1.0 (2026-10-14)
- 初始版本 `api-design-studio` → 开源副本 `IDLstudio`。
- **IDL 表单设计**：资源 / 方法 / 模型树，字段类型 `string · int · number · bool · timestamp · enum · array · ref · map`，位置 `body · path · query · header`，必填 / 枚举 / 描述。
- **双向同步**：表单 ⇄ IDL YAML 源码（`js-yaml`），实时重算预览。
- **双生成器**：OpenAPI 3.1（schemas / `$ref` / enum / 数组 / map / `example`）与 protobuf/gRPC（`proto3`、`package`、每资源一个 Service、Request/Response 消息、枚举、`Timestamp`/`Empty`）。
- **备注与预期示例**：方法级 `note`（→ `x-note` / proto 注释）与预期正常返回示例（→ 200 `example`，调试台直接使用）。
- **mock 调试台**：选方法 → 示例参数 → 200 / 错误码 → 模拟响应；响应查找（正则、上一个 / 下一个、高亮）。
- **持久化**：`project.json`，`Ctrl/Cmd + S` 快速保存。
- **浅色 / 暗夜双主题**，滚动条主题化。
