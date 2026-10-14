# IDLstudio

**内部 IDL 可视化设计台**：用表单设计一份与输出格式无关的中立 IDL 契约，实时「编译」生成
**OpenAPI 3.1（REST）** 与 **protobuf / gRPC（RPC）** 两套契约，并内置 **mock 调试台**。

轻量、零构建、纯浏览器交互（仅服务端做本地持久化）。自带浅色 / 暗夜双主题。

## 特性

- **表单设计**：资源 / 方法 / 模型树，字段类型含 `string · int · number · bool · timestamp · enum · array · ref · map`，`in: body · path · query · header`，必填 / 枚举 / 描述一应俱全
- **双向同步**：表单改动实时回写 YAML 源码并重算两套预览；也可直接手写 YAML 源码，停顿自动解析回填表单
- **双生成器**：标准方法默认路由（Create→POST /复数、Get→GET /{id}、List→GET、Update→PATCH、Delete→DELETE，`http` 可自定义覆盖）
  - **OpenAPI 3.1**：schemas / `$ref` / enum / `date-time` / 数组 / map / 内联输出，200 响应可带 `example`
  - **protobuf / gRPC**：`proto3`、`package`、每资源一个 `XxxService`、`<Res><Method>Request`、枚举 `<消息><字段>Value`、`Timestamp` / `Empty`
- **备注与示例**：每个方法可写备注说明（输出为 OpenAPI `x-note` / proto 注释）与预期正常返回示例（200，输出为 `example`，调试台直接使用）
- **mock 调试台**：选方法 → 示例参数 → 选错误码或 200 → 返回模拟响应；响应支持查找（正则、上一个 / 下一个、高亮）
- **持久化**：项目保存到本地 `project.json`；`Ctrl/Cmd + S` 快速保存
- 浅色 / 暗夜双主题

## 快速开始

需要 Node.js ≥ 16。

```bash
npm install
npm start
```

打开 <http://127.0.0.1:8010>。

> 端口：默认 `8010`，被占用时可用 `PORT=8011 npm start` 换端口。
> 服务仅绑定 `127.0.0.1`，不对外网开放。

## 用法

1. 左侧树选中 **资源 / 方法 / 模型**，中间表单编辑；
2. 右侧四个标签页实时查看 **IDL 源码 / OpenAPI / proto / 调试台**；
3. 顶部「保存」或 `Ctrl/Cmd+S` 持久化到 `project.json`。

IDL 语法与 OpenAPI / proto 的完整映射规则见 **[DESIGN.md](DESIGN.md)**。

## 项目结构

```
IDLstudio/
├── server.js          # 本地服务：静态页 + /api/project 持久化 + 提供浏览器版 js-yaml
├── package.json
├── DESIGN.md          # 设计文档（IDL 语法 + 双生成映射 + 调试台 + 限制）
├── project.json       # 示例项目（可修改；保存时更新）
├── LICENSE
└── public/
    ├── index.html
    ├── style.css      # 浅/暗双主题
    └── app.js         # IDL 模型、表单、双向同步、双生成器、调试台、查找
```

## 工作原理

服务端只做静态托管与项目持久化；**IDL → OpenAPI / proto 的编译全部在浏览器端完成**（`app.js` + 浏览器版 `js-yaml`），因此无需任何后端编译依赖。

## 示例

`project.json` 自带一个 `MyService / Node` 示例：启动后即可在树中看到 `Node` 资源的增删改查方法，右侧实时生成对应 OpenAPI 与 proto。

## 许可证

[MIT](LICENSE) © 2026 何小点点 (hoxiudimdim)
