# ROADMAP — 更无损设计路线

> 目标：在「精简子集 + 兜底袋」的基础上，逐步收敛导入 / 导出有损点，让 DIDL（`.didl`）成为更接近**无损**的中间格式。
> 命名：导出文件后缀 `.didl`（Design IDL），内部格式标记仍为 `idlstudio`。

## 一、基线（当前状态）

- 类型子集：`string · int · number · bool · timestamp · enum · array · ref · map`
- 兜底袋：`options`（项目/模型/字段/方法四层）、`reserved`、`oneof`、`stream`、`tag`、`imports`
- 导出 / 导入：OpenAPI 3.x → DIDL 续写；DIDL（.didl/.yaml/.json）跨设备还原
- 导入仅支持 **OpenAPI**；**proto 反向导入未实现**
- 已加固（1.0.1）：proto 标识符冲突——字段名 / 枚举常量 snake 归一后去重并数字后缀避让，冲突记入日志
- 已实施（1.1.0）：**语义提示词双端强化**——OpenAPI `description`=desc+note、proto 全级注释（方法/字段/模型/资源）；**按产物自动检查**（复制/导出/导入触发 REST/RPC 体检，结果进日志页）；**主契约策略** `options.priority`（rest/rpc/both，随 .didl 携带）

### 已知有损点（需逐条收敛）

| 外部特性 | 当前处理 | 损失类型 |
|---|---|---|
| `anyOf`（并集） | 不映射 oneof，仅警告 | 丢弃 |
| `nullable` / 可空 | → `string` | 语义丢失 |
| `oneOf` | → 合成模型 | 重导不还原 |
| 嵌套内联对象 | → 合成模型 | 命名不一致 |
| `bytes / fixed32 / sint64 / double` 等 | 不在子集 | 导入即丢 |
| 外部 `$ref` 路径 | 近似处理 | 可能不一致 |
| enum（int / string） | 归一到 string/enum | 归一化 |

---

## 二、阶段规划

### 阶段四：扩子集 — 原生支持可空与字节/定长类型
**目标**：把最常触发有损的类型纳入子集，从源头减少「导入即丢」。
- 新增 `optional / nullable`（可空语义，替代「可空→string」）
- 新增 `bytes`、`fixed32 / fixed64 / sint`、`double` 精度等 proto 常见类型
- 表单类型选择器 / 双生成器 / 导入器**三端同步扩展**
- 映射：可空 → OpenAPI `nullable` / `required`，proto `optional`

**验收**：导入含 `nullable` / `bytes` 的样例，往返不丢失关键信息。

### 阶段五：proto 反向导入（.proto → DIDL → 续写）
**目标**：闭环 RPC 侧，补上当前完全空窗的一侧。
- ~~`.proto` 解析：`message / enum / oneof / stream / options / imports / reserved / 字段编号`~~ ✅ 已实施
- ~~反向映射到 DIDL 表单（含「一 Service → 资源」的映射规则）~~ ✅ 已实施
- ~~有损点写入 warnings（日志标签页）~~ ✅ 已实施

**验收**：导入典型 gRPC `.proto` 可还原继续编辑。

**状态：✅ 已实施（1.2.2）**
- `public/protoImporter.js` 手写 proto3 子集 Lexer+Parser（零新依赖）：`service→资源`（去 `Service` 后缀，生成时补回）、`rpc→方法`（含 4 种流式 none/server/client/bidi）、`message→模型`（map/repeated/oneof/reserved/tag 完整还原）、`enum→IDL 枚举`（回剔 `_UNSPECIFIED` 哨兵）、注释归位 `desc/note`、类型归一（`int32→int` 等）进丢失记录、`import google/protobuf/*` 过滤、`package→项目名`（另存 `options._proto_package` 保证往返）。
- **真源无损**：具名请求/响应消息一律保留为模型 + `body:ref` / `output:ref`（不内联、不合成包装）；`toProto` 对单 `body:ref` 直接透传模型名 → 再生成 proto 无损（名字 + 流式形状）。

### 阶段六：往返无损测试
**目标**：把「丢了什么」从感觉变成**可量化、可回归**。
- ~~建立「DIDL → OpenAPI/proto → 再导入 DIDL」的往返测试用例集~~ ✅ 已实施
- ~~每条有损点给出可度量指标（字段丢失数、语义丢失类型）~~ ✅ 已实施
- 接入 CI（`.github/workflows/check.yml`）自动跑往返测试 —— ⚠️ 未接入（测试目录随 1.2.2 发布移除，见下）

**验收**：有损点清单有量化基线，后续改动可回归验证。

**状态：✅ 已实施（1.2.2）**
- 三方向验证：proto→DIDL→proto **无损**（名字 + 流式形状）；OpenAPI→DIDL→OpenAPI **无损**（共享 body 直接 `$ref`）+ 转 proto 报 REST 损点；dIDL 双向稳定。
- 说明：验证脚本曾置于 `test/`（`fidelity-test.js` 等），随 1.2.2 发布**整体移除**（用户决定发布不含测试目录）；如需回归需重建或接 CI。

### 阶段七：DIDL 格式稳定化
**目标**：私有格式进入受管状态，跨版本可迁移。
- 格式加 `schemaVersion` 与迁移函数
- 明确 `.didl` 规范（字段、标记、版本）
- 老 `.idl.yaml` 自动迁移导入

**验收**：`.didl` 有版本约束，跨版本可无损迁移。

### 阶段八（可选）：协作与能力扩展
- 多项目切换（当前单项目单文件）
- 调试台「真实请求代理」模式
- 契约 diff / 变更通知

---

## 三、依赖关系

```
阶段四（扩子集） ──► 阶段六（往返测试）✅
阶段五（proto 导入） ──► 阶段六（往返测试）✅ 五、六 已于 1.2.2 完成
阶段七（格式稳定化） 依赖 阶段四/五 的字段稳定
阶段八 独立，可随时并行
```

## 四、优先级建议
1. ✅ **阶段六（往返测试）**：1.2.2 已建立三方向无损基线（proto/OpenAPI/dIDL），验证脚本随发布移除，CI 未接入。
2. ✅ **阶段五（proto 导入）**：1.2.2 已闭环 RPC 侧并实现真源无损。
3. **阶段四（扩子集）**：成本低、直接减少最常触发的损失（可空 / 字节 / 定长类型）。
4. **阶段七（格式稳定化）** 在有新字段后做，避免早期频繁迁移。
