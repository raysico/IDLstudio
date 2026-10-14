# IDLstudio · Bun compile 编译指南

> 目标：把 IDLstudio（本地 Node Web 服务）编译成 macOS / Windows 的**单个原生可执行文件**，免安装、双击即用（自动起服务并打印本地地址）。
>
> 状态：本文为**将来需要打包时**执行的方案文档。当前代码仍以 `node server.js` 开发模式运行；本文第 2 节列出的两处调整**尚未应用到源码**，打包前才需要改动。

---

## 1. 为什么选 Bun compile

| 方案 | 跨平台编译 | 资源内嵌 | 维护 | 结论 |
|---|---|---|---|---|
| **Bun compile** | ✅ 一台 macOS 上可一次产出 win / mac / linux 各架构 | ✅ 支持把静态文件内嵌进单文件 | 活跃、官方 | **采用** |
| Node SEA | ❌ 只能本机目标（win 需到 win 或 CI 上编） | ⚠️ 需 `--experimental-sea-config` + 资源 blob | 官方 | 备选 |
| pkg (vercel) | ✅ | ✅ | ⚠️ 半维护、node 版本受限 | 不推荐 |

本项目依赖只有一个 `js-yaml`，体积小，非常适合 Bun 内嵌打成单文件。

---

## 2. 打包前必须完成的两处代码调整

> ⚠️ 以下两处改动会同时影响开发模式（`node server.js`）与打包产物。建议**让两种模式并存**（通过环境变量/可写探测切换），开发模式仍走磁盘读取，打包模式走内嵌。

### 2.1 数据目录迁移（`project.json` 不能写在程序目录）

现状（`server.js` 第 11~15、17~24 行）：

```js
const ROOT = __dirname;
const PROJECT_FILE = path.join(ROOT, 'project.json');
```

打包后程序可能位于只读位置（mac App 内、win 的受保护目录），需改写到**用户数据目录**：

```js
const path = require('path');
const os = require('os');

function dataDir() {
  // 便携模式：若可执行文件所在目录可写，优先用它（便于整目录拷贝迁移）
  if (process.env.IDLSTUDIO_PORTABLE === '1') return __dirname;
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'IDLstudio');
  }
  // macOS / Linux
  return path.join(os.homedir(), 'Library', 'Application Support', 'IDLstudio');
}
const PROJECT_FILE = path.join(dataDir(), 'project.json');
```

并在 `start()` 里确保目录存在、且 `readProject/writeProject` 不变：

```js
fs.mkdirSync(path.dirname(PROJECT_FILE), { recursive: true });
```

### 2.2 静态资源与 js-yaml 内嵌（打包后不再依赖磁盘 / node_modules）

`server.js` 目前用 `fs.createReadStream` 读 `public/`（第 86~96 行），并在第 78~84 行从 `node_modules/js-yaml/dist/js-yaml.min.js` 流式提供浏览器版 YAML 库。打成单文件后这些文件必须**打进二进制**。

**方式 A（推荐，改动最小、与打包器无关）**：编译前生成一个内嵌资源表，`server.js` 从表里取值服务。

`build/pack.js`（在 `bun build --compile` 之前执行，把资源写进 `assets.generated.js`）：

```js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const entries = [
  ['/index.html', 'public/index.html'],
  ['/style.css',  'public/style.css'],
  ['/app.js',     'public/app.js'],
  ['/vendor/js-yaml.min.js', 'node_modules/js-yaml/dist/js-yaml.min.js'],
];
const out = entries.map(([url, file]) => {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return `  ${JSON.stringify(url)}: \`${text}\`,`;
}).join('\n');
fs.writeFileSync(path.join(ROOT, 'assets.generated.js'),
  `// 由 build/pack.js 生成，勿手改\nmodule.exports = {\n${out}\n};\n`);
```

`server.js` 中把静态文件与 js-yaml 的读取改为"优先内嵌表、否则回退磁盘"：

```js
const ASSETS = fs.existsSync(path.join(ROOT, 'assets.generated.js'))
  ? require(path.join(ROOT, 'assets.generated.js')) : null;
// ...
if (pathname === '/vendor/js-yaml.min.js') {
  if (ASSETS && ASSETS['/vendor/js-yaml.min.js']) {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(ASSETS['/vendor/js-yaml.min.js']);
  }
  // 原 node_modules 磁盘读取作为回退（开发模式）
}
// 静态文件分支：优先 ASSETS[pathname]，否则 fs 读盘
```

**方式 B（纯 Bun embed）**：用 `import` 让 Bun 编译期内嵌（文本资源会以字符串形式打进二进制）：

```js
import indexHtml from './public/index.html' with { type: 'text' };
import styleCss   from './public/style.css'  with { type: 'text' };
import appJs      from './public/app.js'     with { type: 'text' };
import jsYaml     from './node_modules/js-yaml/dist/js-yaml.min.js' with { type: 'text' };
```

> 说明：方式 B 依赖 Bun 对非 JS 资源 import 的默认内嵌行为；具体语法请以当时 **Bun 官方文档（`https://bun.sh/docs` → Bundler / `bun build --compile`）** 为准，首次打包前用 `bun build --help` 复核。

---

## 3. 安装 Bun

macOS（Homebrew）：

```bash
brew install oven-sh/bun/bun
```

或用官方脚本：`curl -fsSL https://bun.sh/install | bash`。验证：

```bash
bun --version
```

---

## 4. 编译命令与目标平台

```bash
# 在项目根目录
bun build server.js --compile \
  --target=bun-darwin-arm64 \
  --outfile dist/IDLstudio-mac-arm64
```

| `--target` | 产物平台 | 说明 |
|---|---|---|
| `bun-darwin-arm64` | macOS Apple Silicon | 你本机架构 |
| `bun-darwin-x64` | macOS Intel | 兼容旧款 Mac |
| `bun-windows-x64` | Windows 64 位 | 你需要的 win 版 |
| `bun-linux-x64` / `bun-linux-arm64` | Linux | 可选 |

`bun build` 会**自动打包 `js-yaml`（依赖）**，无需随包带 node_modules；`--compile` 输出为单个原生可执行文件，内置 Bun 运行时。

---

## 5. 一条命令出多平台压缩包

`scripts/release.sh`（macOS 上运行）：

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node build/pack.js                      # 方式 A：生成内嵌资源表
mkdir -p dist

bun build server.js --compile --target=bun-darwin-arm64 --outfile dist/idlstudio-mac-arm64
bun build server.js --compile --target=bun-darwin-x64   --outfile dist/idlstudio-mac-x64
bun build server.js --compile --target=bun-windows-x64  --outfile dist/idlstudio-win-x64.exe

cd dist
zip -r IDLstudio-mac-arm64.zip idlstudio-mac-arm64
zip -r IDLstudio-mac-x64.zip   idlstudio-mac-x64
zip -r IDLstudio-win-x64.zip   idlstudio-win-x64.exe
echo "✅ dist/ 已生成三个包"
```

> Windows 可执行文件建议命名带 `.exe` 后缀；`.zip` 免安装，解压即用。

**可选 · GitHub Actions 自动构建**（每次打 tag 自动在 win/mac runner 上原生构建并发 Release）：

```yaml
name: build-release
on:
  push:
    tags: ['v*']
jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: bun-darwin-arm64
            artifact: IDLstudio-mac-arm64.zip
          - os: windows-latest
            target: bun-windows-x64
            artifact: IDLstudio-win-x64.zip
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun build server.js --compile --target=${{ matrix.target }} --outfile dist/app
      - uses: actions/upload-artifact@v4
        with: { path: dist, name: ${{ matrix.artifact }} }
```

---

## 6. 运行与验证

```bash
./dist/idlstudio-mac-arm64          # mac；或双击
./dist/idlstudio-win-x64.exe        # win；或双击
```

验证清单（浏览器打开打印的地址）：
- [ ] `GET /api/health` → `{ ok: true }`
- [ ] `GET /` → 页面正常加载（样式、脚本齐全）
- [ ] `GET /vendor/js-yaml.min.js` → 返回 YAML 库（前端源码编辑可用）
- [ ] 编辑并保存一次 → 在数据目录生成 `project.json`（mac 为 `~/Library/Application Support/IDLstudio/`，win 为 `%APPDATA%\IDLstudio\`）
- [ ] 关闭进程重开 → 上次项目仍在（持久化生效）

端口：默认 `8010`，被占用可 `PORT=8011 ./dist/idlstudio-...` 换端口（服务仅绑定 `127.0.0.1`）。

---

## 7. 签名与分发（重要）

### macOS
- **未签名 / 未公证**：Gatekeeper 会提示"无法验证开发者"，需**右键 → 打开**一次。**$0，可接受**，README/发布说明写清即可。
- 要消除提示：需 **Apple Developer 会员（$99/年）** → 签发 **Developer ID 证书** → **公证（Notarization，免费含在会员内）**。

### Windows
- **未签名**：SmartScreen 会提示"未知发布者"，点"更多信息 → 仍要运行"即可。**$0**。
- 要签名消除提示：OV 证书约 **$150–300/年**（仍会提示一次），EV 证书约 **$300–500/年**（需 USB token，基本消除）。

### 建议
个人工具 / 早期分发：**先出未签名 .zip，$0**；用户量起来或正式交付时再考虑签名。发布说明附一句首次打开指引即可。

---

## 8. 打包前检查清单（避免踩坑）

- [ ] 已完成 2.1 数据目录迁移（否则程序可能因无写权限而无法保存）
- [ ] 已完成 2.2 资源内嵌（否则打包产物打开页面空白 / js-yaml 缺失）
- [ ] `assets.generated.js` 与 `dist/` 加入 `.gitignore`（生成物不提交）
- [ ] 首次打包前用 `bun build --help` 复核 `--target` 枚举与资源内嵌语法（以 Bun 当时文档为准）
- [ ] mac 两种架构（arm64 + x64）视是否需要兼容 Intel 再出；win 只出 x64 已够
