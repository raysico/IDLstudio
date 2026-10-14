# API 设计台 —— 设计文档

> 内部 IDL 可视化设计工具：用表单设计一份中立的接口契约，实时「编译」生成 **OpenAPI 3.1（REST）** 与 **protobuf/gRPC（RPC）** 两套契约，并内置 mock 调试台。

## 1. 定位与目标
- **Spec-first**：IDL 是唯一真相源，REST 与 RPC 均由它生成，避免有损的 REST↔RPC 互译。
- 面向资源的 API 设计方法论（Google AIP 风格）：资源 + 标准方法（Get/List/Create/Update/Delete）。
- 交付两套契约：一份 OpenAPI（可直接喂给 tana/anytype 那种 OpenAPI 驱动调试客户端），一份 `.proto`（gRPC 契约）。
- **产物 AI 友好**：生成的 OpenAPI / proto 自带备注（`x-note` / 注释）与预期返回示例，可直接交付给 AI/LLM 进行编程；无基础用户设计完即可转交 AI 实现，减少沟通成本。

## 2. 内部 IDL 语法（DSL）
YAML 形态，与内部模型一一对应：

```yaml
name: MyService        # 服务名（也作 proto package 与 OpenAPI title）
version: 1.0.0
resources:             # 资源：每个资源是一组相关方法 + 默认增删改查
  Node:
    description: 节点
    methods:
      Create:          # 标准方法名 -> 默认 http: POST /nodes
        input:
          name: { type: string, required: true, desc: 名称 }
          parentId: { type: ref, ref: Node }      # 引用另一个模型
          tags: { type: array, items: string }
          status: { type: enum, enum: [draft, published] }
          createdAt: { type: timestamp }
        output: Node                                # 字符串 = 模型引用
        note: 备注说明（仅文档用途）                 # 可选：方法备注/注意事项
        example: |                                  # 可选：预期正常返回(200)示例
          {
            "id": "1",
            "name": "示例",
            "status": "published"
          }
        errors: [400, 409]
      Get:
        http: GET /nodes/{id}                        # 可自定义路由
        input:
          id: { type: string, in: path, required: true }
        output: Node
        errors: [404]
      List:
        input:
          pageSize: { type: int, in: query }
          pageToken: { type: string, in: query }
        output:                                      # 缺省 = void；也可内联对象
          nodes: { type: array, items: ref, ref: Node }
          nextPageToken: { type: string }
models:                # 可复用的数据结构
  Node:
    id: { type: string }
    name: { type: string }
```

### 字段类型
| 类型 | 说明 | OpenAPI 映射 | proto 映射 |
|---|---|---|---|
| `string` | 字符串 | `type: string` | `string` |
| `int` | 整数 | `type: integer` | `int64` |
| `number` | 浮点 | `type: number` | `double` |
| `bool` | 布尔 | `type: boolean` | `bool` |
| `timestamp` | 时间戳 | `type: string, format: date-time` | `google.protobuf.Timestamp` |
| `enum` | 枚举 `enum:[...]` | `type: string, enum:[...]` | 生成 `enum Xxx {...}` |
| `array` | 数组 `items:<类型>` | `type: array, items: <schema>` | `repeated <T>` |
| `ref` | 模型引用 `ref:<模型>` | `$ref: #/components/schemas/<名>` | 消息类型引用 |
| `map` | 映射 | `type: object, additionalProperties` | `map<...>` |

字段位置 `in`：`body`（默认）/ `path` / `query` / `header`。
枚举字段还有一个隐式默认值 `UNSPECIFIED=0`（proto 规范，见 §5）。

## 3. 表单 + 源码 双模式
- **表单模式**：左侧资源/模型树，点选后在中间编辑（资源描述、方法、字段增删、类型/必填/位置/枚举）。表单约束合法值，防写出不合规契约。
- **源码模式**（右侧「IDL 源码」tab）：直接编辑 YAML，实时解析回填表单。两者双向同步：
  - 表单改动 → 序列化成源码 + 重新生成两套契约
  - 源码改动 → `js-yaml` 解析 → 规范化回内部模型 → 重绘表单 + 契约；解析出错时**不覆盖模型**，仅提示错误
- 因此常用 90% 用表单，流式/复杂注解这类高级场景回源码补。

## 4. OpenAPI 3.1 生成映射
- 每个 `resource.method` → 一个 operation：
  - `operationId = <资源><方法>`，`tags=[资源名]`
  - `in=path/query/header` 字段 → `parameters`；`in=body` 字段 → `requestBody`（application/json object）
  - `output`：模型引用 → 200 schema `$ref`；内联对象 → 内联 schema；void → 空响应
  - `errors` 列表 → 对应状态码的 error responses
  - `note` → 附带为 OpenAPI 操作的 `x-note`，并在 proto 中作为 rpc 前的注释
  - `example` → 作为 200 响应的 `content.application/json.example`（示例可 JSON 或 YAML，自动解析）；用于前端按预期对接、调试台直接取用、以及交付 AI 时的契约示例
- `components/schemas`：所有 `models` 转成 schema
- 标准方法默认路由：`Create→POST /<复数>`、`Get→GET /<复数>/{id}`、`List→GET /<复数>`、`Update→PATCH /<复数>/{id}`、`Delete→DELETE /<复数>/{id}`；`http` 自定义则优先
- 产物可直接用现有的 `tana-web-client` / `anytype-v2-web-client` 架构加载调试

## 5. protobuf/gRPC 生成映射
- `package = 服务名小写`
- 每个 `resource` 视为一组方法：
  - `rpc <方法>(<资源><方法>Request) returns (<资源><方法>Response);`
  - Request：`input` 全部字段（含 path/query，均入消息，字段号从 1 自增）
  - Response：`output` 为模型 → 直接返回该消息类型；内联 → 生成 `<方法>Response` 消息；void → `google.protobuf.Empty`
- 每个 `model` → `message <名> { ... }`（snake_case 字段名）
- 每个 `enum` 字段 → 生成 `enum <消息名><字段名> { <字段名>_UNSPECIFIED=0; <值>=1..; }`
- `timestamp` → 引用 `google/protobuf/timestamp.proto`（按需 import）
- 错误模型：REST 端用 HTTP 状态码；proto 端在 `.proto` 顶部注释约定错误由 `google.rpc.Status` 承载

## 6. 模块结构
```
IDLstudio/
├─ server.js            # 静态页 + /api/project 持久化（project.json）
├─ package.json         # 唯一依赖 js-yaml（源码解析）
├─ DESIGN.md            # 本文档
├─ README.md            # 使用说明
├─ project.json         # 当前 IDL 项目（自动生成）
└─ public/
   ├─ index.html        # 三栏布局：资源树 | 表单 | 预览tab(源码/OpenAPI/proto/调试台)
   ├─ style.css         # 浅色/暗夜双主题（复用 tana/anytype 客户端主题）
   └─ app.js            # IDL 模型 / 表单渲染 / 源码同步 / 双生成器 / mock 调试台
```

## 7. 调试台（mock）
- 选一个方法 → 自动生成输入表单 → 发送 → 按 `output` schema 递归生成示例 JSON 作为 200 响应；`void` 返回空
- 若填写了方法 `example`，发送 200 时**直接以该预期示例作为响应体**（自动美化排版）
- 可从 `errors` 列表选一个状态码模拟错误响应
- 响应展示复用客户端样式（状态码/响应头/格式化 JSON），并带查找高亮（复用查找逻辑）

## 8. 限制与后续
- 当前覆盖：资源 + 标准方法 + 常见类型 + 单层错误码；**流式（server/client/bidi stream）、oneof、嵌套 map 的复杂表达、权限 scope、版本化策略**暂不在 v0.1
- 后续可选：外部契约导入与无损往返见 §9；另可选 `.proto` 多文件工程、代码生成（客户端 stubs）

## 9. 导入与无损往返（规划）

目标：支持导入 **OpenAPI yaml/json** 与 **.proto** 到 IDL 模型后继续表单编辑（续写），并保证 **proto → IDL → proto 无损往返**。

### 9.1 策略：IDL 超集化
不再在反向映射时丢弃 proto 特性，而是把 IDL 模型升级为「**proto 完整可表达 + OpenAPI 合理子集**」的中立超集：
- **结构化属性**：语义清晰、高频的 proto 概念建模成字段/属性，生成器按规则发射。
- **原样保留袋（extras）**：低频/杂项（各类 `option`、自定义选项）以 key→value 结构化存下，导出时原样回写。

### 9.2 反向映射（导入）
**OpenAPI → IDL**

| OpenAPI | → IDL |
|---|---|
| `paths.<path>.<verb>` | 资源（按 tag/路径段分组）+ 方法 |
| `parameters(in: path/query/header)` | 字段 `in` |
| `requestBody(application/json object)` | body 字段 |
| `responses.200.schema` | `output`（`$ref`→模型引用；内联→内联对象） |
| `components.schemas` | `models` |
| `description` / `x-note` | `desc` / `note` |
| `example` | `example` |

**proto → IDL**

| proto | → IDL |
|---|---|
| `message` | `model` |
| 字段：`int64/int32/uint32…→int`、`double→number`、`string→string`、`bool→bool`、`Timestamp→timestamp`、`repeated→array`、`map→map`、`enum→enum`、消息引用→`ref` | `field` |
| `enum`（首个 `_UNSPECIFIED=0`） | `enum` |
| `service` + `rpc <名>(Req) returns (Resp)` | 资源（按 service）+ 方法；`Req/Resp` → `input/output` |
| 注释 `//` | `desc` / `note` |

### 9.3 无损属性（结构化建模 proto 语义）
全部可选、有默认，旧 `project.json` 不受影响：

| 属性 | 归属 | 说明 |
|---|---|---|
| `tag: N` | 字段 | proto 字段编号；导入记录、生成发射；新增字段分配 max+1 并避开 reserved |
| `oneof: 组名` | 字段 | 同模型内同组字段归一个 oneof；proto 生成 `oneof 组{...}`，OpenAPI 映射 `oneOf` |
| `stream: none\|server\|client\|bidi` | 方法 | proto 生成 `stream Xxx`；OpenAPI 用 `x-streaming` 标注 |
| `imports: [ ... ]` | 项目 | proto import；自动维护 timestamp，其余原样保留 |
| `reserved: { numbers, names }` | 模型 | 发射 `reserved 2,15,9 to 11;` / `reserved "a","b";` |
| `options: { key: value }` | 项目/消息/字段/方法 | 兜底袋，导出原样回写 |

### 9.4 方向性说明
- **proto 方向**：完全无损（含 9.3 全部属性）。
- **OpenAPI 方向**：wire 编号、reserved、部分 option 无法表达 → IDL 保留、OpenAPI 输出忽略；oneof→`oneOf`、stream→`x-streaming`。

### 9.5 表单与实现落点
- 每个模型/方法/字段增加「**高级(proto)属性**」可折叠区，默认收起。
- 新增 `public/importers.js`（`openApiToModel` / `protoToModel` / `parseIdlYaml`）；`app.js` 接入导入流程与名称冲突处理；`index.html` 加入口；`server.js` 不动。
- **无损验收标准**：导入 proto → 导出 → 再导入 → **逐字节一致**（golden round-trip）。

### 9.6 分期
1. **阶段一**：`tag` + `imports` + `reserved`（线兼容关键，改动小）
2. **阶段二**：`oneof` + `stream`
3. **阶段三**：`options` 兜底袋

## 10. 验收
- 通过表单或源码新增/修改一个资源与字段 → OpenAPI 与 proto 实时变化
- 导出/复制生成的 OpenAPI 可被 tana/anytype 调试客户端加载
- 调试台发送返回可读的示例响应，查找可高亮
- 浅色/暗夜主题切换正常
