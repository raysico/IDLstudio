# ROADMAP — 更无损设计路线

> 目标：在「精简子集 + 兜底袋」的基础上，逐步收敛导入 / 导出有损点，让 DIDL（`.didl`）成为更接近**无损**的中间格式。
> 命名：导出文件后缀 `.didl`（Design IDL），内部格式标记仍为 `idlstudio`。

## 一、基线（当前状态）

- 类型子集：`string · int · number · bool · timestamp · enum · array · ref · map`
- 兜底袋：`options`（项目/模型/字段/方法四层）、`reserved`、`oneof`、`stream`、`tag`、`imports`
- 导出 / 导入：OpenAPI 3.x → DIDL 续写；DIDL（.didl/.yaml/.json）跨设备还原
- 导入仅支持 **OpenAPI**；**proto 反向导入未实现**

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
- `.proto` 解析：`message / enum / oneof / stream / options / imports / reserved / 字段编号`
- 反向映射到 DIDL 表单（含「一 Service → 资源」的映射规则）
- 有损点写入 warnings（日志标签页）

**验收**：导入典型 gRPC `.proto` 可还原继续编辑。

### 阶段六：往返无损测试
**目标**：把「丢了什么」从感觉变成**可量化、可回归**。
- 建立「DIDL → OpenAPI/proto → 再导入 DIDL」的往返测试用例集
- 每条有损点给出可度量指标（字段丢失数、语义丢失类型）
- 接入 CI（`.github/workflows/check.yml`）自动跑往返测试

**验收**：有损点清单有量化基线，后续改动可回归验证。

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
阶段四（扩子集） ──► 阶段六（往返测试）
阶段五（proto 导入） ──► 阶段六（往返测试）
阶段七（格式稳定化） 依赖 阶段四/五 的字段稳定
阶段八 独立，可随时并行
```

## 四、优先级建议
1. **阶段六（往返测试）先建立基线**：没有量化基线，前几阶段的"更无损"无法验证。
2. 再走 **阶段四（扩子集）**：成本低、直接减少最常触发的损失。
3. **阶段五（proto 导入）** 价值高、工作量中，补齐 RPC 闭环。
4. **阶段七（格式稳定化）** 在有新字段后做，避免早期频繁迁移。
