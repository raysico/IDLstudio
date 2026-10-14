# 更新记录 (Changelog)

## 0.4.0 (2026-10-14)
- **快捷键系统**：中央键位表 + `bindShortcuts()`；保存 `Cmd/Ctrl+S`、导出 .didl `Cmd/Ctrl+Shift+S`、载入 `Cmd/Ctrl+L`、新增资源/模型/字段/方法 `Cmd/Ctrl+Shift+R/M/F/E`、调试台聚焦 `Cmd/Ctrl+Alt+F`、模拟发送 `Cmd/Ctrl+Alt+T`；顶栏「快捷键」按钮弹出面板。
- **失焦自动保存**：任一输入框失焦即保存；顶栏「保存」改为「导出项目」。
- **导出格式**：后缀 `.idl.yaml` → `.didl`；「导入 IDL」→「导入dIDL」。
- **改名**：项目名 `IDLstudio` → `IDL Service Design Studio`；底部新增 `Powered by hoxiudimdim` 页脚。
- **新增 ROADMAP.md**（更无损路线）；移除涉敏测试数据并 `.gitignore` 防护。

## 0.3.0 (2026-10-14)
- **阶段二：oneof + stream**：字段行 oneof 组名（同组互斥，proto `oneof 块` / OpenAPI `oneOf`）；方法流类型 `none/server/client/bidi`（proto `stream Xxx` / OpenAPI `x-streaming`）；导入反向映射 `x-streaming`→stream、schema `oneOf`→合成 oneof 模型。
- **阶段三：options 兜底袋**：项目 / 模型 / 字段 / 方法四层 JSON 录入；proto 原样回写（文件级 `option`、message 级 `option`、字段 `[ k = v ]`、method `{ option }`）；OpenAPI 按方向性忽略。
- **项目信息**：项目面板新增「描述」字段（YAML / OpenAPI `info.description` 往返、导入器映射）；标题栏项目名胶囊可点击管理项目信息。
- **新建项目**：原「项目信息」按钮改为「新建项目」（确认弹窗，清空回 Node 示例）。
- **导出 / 导入 IDL**：IDL 源码 tab「导出项目」下载全部 IDL + 备注（`.didl`，跨设备还原）；顶栏「导入 IDL」还原续写。
- **入口调整**：「导入」更名「导入OpenAPI」；「导入 IDL」移至顶栏（＋模型 与 导入 之间）；IDL 源码工具栏按钮成组右对齐、两端对齐。

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
