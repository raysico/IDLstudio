# IDL Service Design Studio — MCP 设计方案

> 版本：Draft v0.1（2026-10-15）
> 状态：设计讨论，未实施。实施顺序见 §7。

## 1. 定位

MCP（Model Context Protocol）让 AI 助手（Claude Code / Cursor / 豆包等）以**编程方式**读写 IDL、生成契约、跑语义体检，把「设计台」能力暴露给 agent——与网页端行为完全一致。

## 2. 架构

```
AI 助手 (Claude Code / Cursor / 豆包)
        │  JSON-RPC (stdio 或 HTTP/SSE)
        ▼
IDLstudio MCP Server  (Node, 基于 @modelcontextprotocol/sdk)
        │  复用 IDL 核心
        ▼
idl-core（纯逻辑：数据模型 + toOpenAPI + toProto + 语义校验 + .didl 导入导出）
        │
        ▼
project.json（与网页端同一份数据源）
```

**关键架构点**：IDL 引擎目前嵌在 `public/app.js`（浏览器端，依赖 `window.jsyaml` / DOM）。MCP 要在 Node 里跑，因此第一步（阶段 A）把引擎抽取成**无 DOM 依赖的共享模块 `idl-core.js`**（UMD：`window.IDLCore` + `module.exports` 双端），网页端与 MCP 共用一处源码。

**状态方案**：
- 默认：直接读写 `project.json`（与网页端同源）
- 可选：**代理模式**桥接正在运行的 8011 HTTP API（`/api/project`）
- 二者二选一，避免并发写冲突。

## 3. 传输方式
- **stdio**：本地，配 Claude Code / Cursor 等
- **HTTP/SSE**：远程或供网页端自挂 AI 调用

## 4. 暴露清单

### 4.1 Tools
按「只读 → 生成 → 校验 → 写 → 维护」分组：

| 分组 | 工具 | 作用 |
|---|---|---|
| 只读 | `get_project` / `list_models` / `get_model` / `list_resources` / `get_method` | 读当前项目全量 / 单点 |
| 生成 | `generate_openapi` / `generate_proto` | 由 IDL 生成两份契约文本 |
| 校验 | `validate`（`priority: rest/rpc/both`） | 语义完整性检查，返回 warn/info 清单（与网页端体检一致） |
| 写 | `add_model` / `update_model` / `delete_model`；`add_resource` / `add_method` / `update_method` / `delete_method`；`add_field` / `update_field` / `delete_field` | 结构化维护 |
| 文件 | `export_didl` / `import_didl` | 导出 / 导入 `.didl` |
| 配置 | `set_priority` | 设置 rest/rpc/both 主契约策略 |

### 4.2 Resources
- `idl://project`（项目 JSON）
- `idl://models/{id}`（单模型）
- `idl://openapi`（生成的 OpenAPI YAML）
- `idl://proto`（生成的 proto）

### 4.3 Prompts（可选）
先做扎实 Tools，Prompts 后续补（如「设计一个 REST 方法」「评审这个模型」模板）。

## 5. 数据模型对接（直接映射现有字段）
- **方法**：`name / http(METHOD 路径) / desc / note / example / input[] / output{kind,ref,fields[]} / errors[] / stream / options`
- **模型**：`name / desc / fields[] / reserved{numbers,names} / options`
- **字段**：`name / type(string|int|number|bool|timestamp|enum|array|ref|map) / required / in(body|path|query|header) / desc / enum[] / itemsType / ref / mapValueType / tag / oneof / options`

MCP 增删改直接落到这些字段，生成 / 校验复用同一引擎 → 与网页端行为完全一致。

## 6. 关键风险
- **并发写**：MCP 与网页端同时改 `project.json` 可能互相覆盖 → 同一份文件 + 保存前重读合并，或统一走 HTTP API。
- **引擎抽取**：最大工作量，需保证网页端行为不回归（抽取后网页端照常跑）。
- **权限**：MCP 默认有写能力，宿主（Claude Code 等）侧配置 `readOnly` 或白名单工具。

## 7. 分阶段实施
1. **阶段 A**：抽 `idl-core` 共享模块（网页端回归验证）——进行中
2. **阶段 B**：MCP Server 只读 + 生成 + 校验（stdio）
3. **阶段 C**：写操作 + `.didl` 导入导出 + HTTP/SSE 传输
4. **阶段 D**：Prompts 模板 + 代理模式桥接运行实例
