# 从零编写 MCP Server → 发布到 npm → 配置使用（完整流程）

> 本文档基于 **`local-time-mcp`**（一个入门级的时间 MCP Server，已发布到
> npm：[local-time-mcp-server](https://www.npmjs.com/package/local-time-mcp-server)，可通过
> `npx local-time-mcp-server@latest` 一键运行）的真实实践，记录一个 MCP（Model Context Protocol）
> Server 从零编写、修复、发布到 npm、并配置到 AI 助手（CodeBuddy / WorkBuddy）的完整过程，
> 以及期间遇到的**坑**与**解决方案**。适合想自己做一个 MCP 包并发布的开发者。


## 1. MCP 是什么（30 秒理解）

### 技术定义

MCP（Model Context Protocol）是一种**让 AI 助手调用外部工具**的开放协议：AI 助手通过 stdio（标准输入输出）+ JSON-RPC 与一个独立进程（即 MCP Server，如本项目 `server.js`）通信，按需请求它执行某个工具（如 `get_current_time`）并拿到结果。协议是**语言无关**的，Node 生态可直接使用官方 `@modelcontextprotocol/sdk` 实现。

### 通俗理解（本质）

**MCP Server 本质上就是一个普通的本地 Node.js 程序**，AI 客户端（如 CodeBuddy）只是用命令行把它启动起来，通过标准输入输出对话而已。你打开任何一个开源的 MCP Server 代码，会发现它就是一个能接命令行的普通 node 程序，没什么特别的。

那这个协议到底做了什么？**它只是给大模型一份"工具清单"**。具体工具是什么不重要——每个工具都有自己的代码实现，大模型只需要根据用户的问题，自己在清单里挑合适的工具去调用，再把工具返回的内容当作上下文使用。

> **一个比喻**：把 AI 助手想象成**餐厅的服务员**，把 MCP Server 想象成**后厨**。服务员手里有一份**菜单**（= 工具清单），上面写着每道菜（= 每个工具）的名字和简介。当客人点菜时，服务员看一眼菜单就知道"这道菜后厨能做"，于是把点单**写下来递给后厨**（= 调用工具），后厨做完把**成品端出来**（= 返回结果），服务员再端给客人（= 把结果作为上下文组织成回答）。

大模型调用 MCP 工具就是这个过程——**工具就是后厨里一道道具体的菜**，菜单让服务员知道"这家店能做什么、该点哪道"。服务员本人并不会做菜，但他知道**该把什么需求交给哪个后厨**，并信任后厨端出来的成品。

> 更深入的协议讲解见本仓库的 `docs/mcp核心概念.md` 与 `docs/mcp端到端流程.md`。

---

## 2. 整体流程总览

```
编写 Server → 本地测试 → 完善 package.json → 注册/登录 npm
→ 处理 2FA → npm publish（首次发布）
→ 跨平台修复 + CI 真机验证 → 重新发布 → CI/CD 自动发布
→ 配置 mcp.json → 在 AI 助手中使用
```

每一步都会遇到一些"看起来小但很坑"的问题，下面逐步展开。

---

## 3. 第一步：编写 MCP Server

### 3.1 初始化项目

```bash
mkdir local-time-mcp && cd local-time-mcp
npm init -y
npm install @modelcontextprotocol/sdk zod
```

> `zod` 用于定义工具入参的 schema，SDK 依赖它做参数校验。

### 3.2 核心代码结构（`server.js`）

一个最小 MCP Server 分五部分，完整代码如下（`isMain` 的定义见 3.3）：

```js
#!/usr/bin/env node   // bin 入口必须有 shebang

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 1. 判断是否作为入口直接运行（见 3.3 详解）
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

// 2. 实现核心逻辑函数（抽出来便于 4.1 的测试脚本 import 直接验证）
//    判断"是否本地时间"：tz 为空 / 'local' 均视为本地
function isLocalTz(tz) {
  return tz === undefined || tz === null || String(tz).trim() === "" || String(tz).trim().toLowerCase() === "local";
}

function currentTimeInTimezone(tz = "local") {
  const local = isLocalTz(tz);
  return JSON.stringify({ datetime: new Date().toISOString(), timezone: local ? "local" : tz });
}

// 3. 创建 server 实例
const server = new McpServer({ name: "local-time-server", version: "1.0.0" });

// 4. 注册工具：给大模型看的"菜单"，含工具名、说明、入参 schema
server.tool(
  "get_current_time",                        // 工具名
  "获取当前时间，传 'local' 或 IANA 时区名",   // 工具说明（供大模型判断何时调用）
  { tz: z.string().optional().describe("时区") },  // 入参 schema
  async ({ tz }) => {                        // 实际执行逻辑（调用上面的核心函数）
    return { content: [{ type: "text", text: currentTimeInTimezone(tz) }] };
  }
);

// 5. 启动（stdio 模式）：仅作为入口时连接，便于测试脚本 import 复用内部函数
if (isMain) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// 导出内部函数，供测试脚本（见 4.1）import 复用，运行时无副作用
// （示例只实现了这几个；真实项目可把 time_diff 等也抽成函数一并导出）
export { isLocalTz, currentTimeInTimezone };
```

这段代码分五步：
1. **定义 `isMain`**（见 3.3）
2. **实现核心逻辑函数**（`isLocalTz`、`currentTimeInTimezone`，抽出来供测试 import）
3. **创建 server 实例**（命名 server + 版本号）
4. **注册工具**（`server.tool(name, description, schema, handler)`，handler 调用核心函数）
5. **启动 + 导出**（`isMain` 为真才连 stdio；末尾 `export` 内部函数供测试脚本复用）

### 3.3 关键设计：入口判断

为了让**同一个文件既能被直接运行，又能被测试脚本 import 复用内部函数**，需要一个 `isMain` 判断。它比较"入口参数指向的文件"和"当前模块文件"是否为同一个（用 `realpath` 消除符号链接差异）：

```js
const isMain = (() => {
  if (!process.argv[1]) return false;                       // 没有入口参数，视为被 import
  try {
    // process.argv[1] = 命令行入口文件；import.meta.url = 当前文件
    // realpathSync 归一化，兼容 macOS 符号链接 / Windows 路径差异
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;                                          // 解析失败，安全起见视为被 import
  }
})();
```

- 直接运行 `node server.js` 时，`process.argv[1]` 就是 `server.js`，与当前文件相同 → `isMain = true`，启动连接
- 被 `test_server.js` import 时，`process.argv[1]` 是 `test_server.js`，不同 → `isMain = false`，只导出不启动

> **不要**用 `process.argv[1].endsWith("server.js")` 这种文件名猜测，
> 在 npm 符号链接、Windows 路径下不够可靠（详见第 8 节）。

---

## 4. 第二步：本地测试

### 4.1 写一个不走 MCP 协议的测试脚本（`test_server.js`）

直接从 `server.js` **import 内部函数**，绕开协议层，快速验证逻辑：

```js
import { isLocalTz, currentTimeInTimezone } from "./server.js";

// 断言测试：验证核心函数逻辑（不走 MCP 协议）
const r = JSON.parse(currentTimeInTimezone("Asia/Shanghai"));
if (r.timezone !== "Asia/Shanghai") throw new Error("时区错误");
if (!isLocalTz("")) throw new Error("空字符串应视为本地时间");
```

### 4.2 用 MCP 握手验证协议层

4.1 只验证了核心函数，但**没验证协议层**（server 能否通过 stdio 正确握手、响应 `tools/call`）。写一个临时脚本，把 server 作为子进程启动，向它的 stdin 发 `initialize` 请求，看 stdout 是否返回响应：

```js
import { spawn } from "node:child_process";

const child = spawn("node", ["server.js"]);

// 读取 server 在 stdout 上返回的响应
child.stdout.on("data", (d) => {
  const msg = JSON.parse(d.toString());
  if (msg.id === 1) {
    console.log("握手成功：", msg.result.serverInfo);   // → { name: "local-time-server", version: "1.0.0" }
    child.kill();                                       // 验证完成，关闭子进程
  }
});

// 向 server 的 stdin 发送 initialize 握手请求
child.stdin.write(JSON.stringify({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } }
}) + "\n");
// 期望 stdout 返回 {"result":{"serverInfo":{...}},"id":1}
```

> 这一点很重要：**单元测试通过不代表协议层可用**，务必实测握手。

---

## 5. 第三步：准备 npm 发布

### 5.1 完善 `package.json`

发布到 npm 需要这些字段：

```jsonc
{
  "name": "local-time-mcp-server",      // 必须是全网唯一，先 npm view 检查
  "version": "1.0.0",
  "type": "module",
  "main": "server.js",
  "bin": {                              // 支持 npx 命令行运行的关键！
    "local-time-mcp-server": "server.js"
  },
  "files": ["server.js", "README.md"],  // 白名单，只打包必要文件，减小体积
  "engines": { "node": ">=18" },        // 声明 Node 版本
  "scripts": {
    "start": "node server.js",
    "test": "node test_server.js",
    "prepublishOnly": "npm test"        // 发布前自动跑测试
  },
  "keywords": ["mcp", "time"],
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/xxx/xxx.git" },
  "homepage": "https://github.com/xxx/xxx#readme",
  "bugs": { "url": "https://github.com/xxx/xxx/issues" },
  "dependencies": { "@modelcontextprotocol/sdk": "^1.30.0" }
}
```

### 5.2 检查包名是否可用

```bash
npm view local-time-mcp-server
# 返回 404 = 名字没被占用，可以发布
```

### 5.3 预览打包内容

```bash
npm pack --dry-run
```

检查打出来的文件是不是你想要的。**`files` 白名单能显著减小包体积**（本项目从 19.3kB 减到 8.7kB）。

---

## 6. 第四步：注册 npm 并登录

### 6.1 官网注册

- **官网**：https://www.npmjs.com/signup （注意是 `.com`，**不是** cnpm/淘宝镜像站）
- 填写 username / email / password，去邮箱点验证链接

> ⚠️ **踩坑**：有人会被引导到 `registry.npmmirror.com`（淘宝镜像）。
> 该站**不开放自助注册**（会提示 "Public registration is not allowed"），且不被 npm 官方承认。
> 请认准 `npmjs.com`。

### 6.2 登录（注意 registry）

如果你本机配置过淘宝镜像（`npm config get registry` 返回 `registry.npmmirror.com`），
**登录/发布会走镜像而失败**。需要临时切到官方源：

```bash
npm config get registry        # 查看当前源
npm config set registry https://registry.npmjs.org/   # 切到官方源
npm login                       # 输入 username/password/email
npm whoami                      # 确认登录成功，返回你的用户名
```

> 发布完成后，如果日常 `npm install` 想用国内镜像加速，可以切回去。

---

## 7. 第五步：发布到 npm（含 2FA 的坑）

### 7.1 直接发布可能被 2FA 拦下

```bash
npm publish
```

**新账号大概率会遇到**：

```
403 Forbidden - Two-factor authentication ... is required to publish packages.
```

这是 npm 官方政策：**新账号必须开启 2FA 才能发布**。

### 7.2 开启 2FA 的坑（Security Key 问题）

npm 的 2FA 有两种：**Security Key**（硬件密钥）和 **Authenticator App**（手机动态码）。

**关键坑**：如果你绑定了 **Security Key**，那么 `npm publish` 在终端里依然会报：

```
EOTP - This operation requires a one-time password from your authenticator.
```

因为 **CLI 发布只认 Authenticator App 的 6 位 TOTP 动态码**，Security Key 不给这个码。
你的手机 App 里也不会有 npm 条目（因为根本没绑 Authenticator App）。

### 7.3 推荐方案：用 Access Token 发布（绕过 2FA）

**推荐用 Access Token**，因为它适合命令行 / CI 自动化，且发布时**不需要每次输手机动态码**。步骤如下：

**① 生成 token**
1. 打开官网 https://www.npmjs.com/settings/~/tokens
2. 点 **Generate New Token**
3. **Type 选 "Publish"**（发布类型）
4. **务必勾选 "Bypass 2FA"**（关键！这样才能绕过手机验证码）
5. 点生成，复制得到的 `npm_xxxx...`（**只显示这一次**，立即保存）

**② 配置到本地并发布**
```bash
# 把 token 写进本地 npm 配置（等价于登录）
npm config set //registry.npmjs.org/:_authToken=npm_xxxx

npm publish          # 直接发布，无需输手机验证码
```

**③ 用完吊销（安全）**
发布完成后，去 https://www.npmjs.com/settings/~/tokens 点 **Revoke** 吊销该 token，防止长期暴露。

> **注意**：token 是敏感凭据，不要提交到代码仓库；泄露了可随时在官网吊销，不影响账号密码。

> ⚠️ **踩坑**：如果 token 生成时**没勾 "Bypass 2FA"**，`npm publish` 仍会报 `EOTP`。
> 恢复码（recovery codes）也**不能**用来发布，它是账号找回用的。

### 7.3b 其他方式：Authenticator App（可选）

如果你想用手机动态码发布（每次输 6 位），而不是 token：
1. 官网 → Settings → Two-Factor，**关掉** Security Key，重新选 **Authenticator app**
2. 用手机 Google/Microsoft Authenticator / Authy 扫 QR
3. 之后每次 `npm publish` 输入手机里的 6 位动态码即可

> 两种方式二选一即可。token 适合自动化（CI/CD），Authenticator App 适合手动场景。

### 7.4 验证发布

```bash
npm view local-time-mcp-server versions dist-tags.latest
# 应该能看到你发布的版本，latest 指向它
```

发布成功后，任何人都可以：
```bash
npx local-time-mcp-server@latest      # 一键运行
# 或
npm install -g local-time-mcp-server  # 全局安装
```

---

## 8. 第六步：跨平台兼容性处理

这是发布后**最容易忽视**但**影响面最大**的一环。以下是真实踩过的坑：

### 8.1 CRLF 换行导致 Mac 无法执行（严重）

**问题**：在 Windows 上编辑的 `server.js` 用了 **CRLF** 换行，导致首行 shebang 变成 `#!/usr/bin/env node\r`，在 macOS/Linux 上直接执行会报 `env: node\r: No such file or directory`。

**解决**：新建一个 **`.gitattributes`** 文件，强制 `server.js` 等关键文件在任意平台检出时都用 **LF** 换行，Windows 上也不会再被改回 CRLF：

```gitattributes
server.js            text eol=lf
*.sh                 text eol=lf
.github/workflows/*  text eol=lf
*                    text=auto
```

### 8.2 `isMain` 的路径判定（跨平台）

**问题**：判断"是否作为入口直接运行"时，如果写 `process.argv[1].endsWith("server.js")`，在 macOS 符号链接、Windows cmd-shim 下可能误判。

**解决**：用 `import.meta.url` + `realpathSync` 做**归一化对比**（即 3.3 节的完整实现，可直接复用）。

### 8.3 用 CI 矩阵真机验证 Mac / Windows

单靠本地无法确认跨平台，用 GitHub Actions 跑 **OS × Node 矩阵**，在 **macOS / Windows / Ubuntu** 上都执行测试（完整配置见 10.2b 的 `ci.yml`）：

```yaml
strategy:
  fail-fast: false
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    node-version: [18, 20, 22]
```

> **这才是验证 Mac/Windows 兼容性的最终手段**——本地改完、push 后由 CI 在真实 Mac/Windows 环境跑一遍。

---

## 9. 第七步：配置到 AI 助手使用

### 9.1 编辑 MCP 配置文件

AI 助手（CodeBuddy / WorkBuddy / Claude Desktop）通过配置文件启动你的 server。

**方式一：用 npx（推荐，无需克隆仓库）**

```json
{
  "mcpServers": {
    "local-time": {
      "type": "stdio",
      "command": "npx",
      "args": ["local-time-mcp-server@latest"]
    }
  }
}
```

**方式二：本地源码路径**（开发调试时）

```json
{
  "mcpServers": {
    "local-time": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/path/to/local-time-mcp/server.js"]
    }
  }
}
```

### 9.2 在 AI 助手中启用

1. 打开 AI 助手右上角**连接器管理**（Connectors）页面
2. 找到 `local-time`，点击 **Trust（信任）**
3. 在对话中测试

### 9.3 MCP 工具什么时候会被调用？

**配置 MCP 后，时间问题"不一定"都会走 MCP，是否调用由 LLM 判断：**

| 问题 | LLM 倾向 |
|------|---------|
| "现在几点？""东京现在几点？" | **几乎一定调用** `get_current_time`（LLM 没有实时时钟）|
| "2026年8月6日是星期几"（纯推算）| 可能自己算，也可能用工具 |
| "什么是时区"（概念）| 通常**不调用**，直接回答 |
| "距离春节还有多久" | 倾向调用 `time_diff` |

> 关键是：**LLM 没有实时时钟**，所以"当前时间"类问题，配置了时间 MCP 后基本会被接管；
> 而推算、概念类问题，LLM 可能自己处理。若想引导，可在提示词（prompt）中说明"优先使用 time 工具"。

---

## 10. 第八步：CI/CD 自动发布

### 10.1 目标

每次提交代码后，**打一个 tag 就自动发布 npm 并自动更新版本号**，不用手动改 `package.json`。

### 10.2 工作流文件（`.github/workflows/publish.yml`）

```yaml
name: Publish to npm
on:
  push:
    tags: ["v*"]          # 推送 v* tag 触发

permissions:
  contents: write          # 需要写权限来回写版本号

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { ref: main, fetch-depth: 0 }   # 检出 main，避免 detached HEAD
      - uses: actions/setup-node@v4
        with: { node-version: 22, registry-url: https://registry.npmjs.org/ }
      - run: npm ci
      - run: npm test                          # 发布前校验
      - name: 同步版本号到 tag                 # 版本号 = tag 去掉 v
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          npm version "$VERSION" --no-git-tag-version --allow-same-version
          sed -i "s/version: \"[0-9.]*\"/version: \"$VERSION\"/" server.js
      - name: 发布
        env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} }
        run: npm publish
      - name: 回写版本号
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add package.json package-lock.json server.js
          git commit -m "chore: release v${GITHUB_REF_NAME#v}" || echo 无需提交
          git push origin main
```

### 10.2b 配套测试工作流（`.github/workflows/ci.yml`）

除发布外，再配一个 **CI 测试工作流**：每次推送到 `main` 或开 PR 时，用 **OS × Node 矩阵**自动跑测试（就是 8.3 说的跨平台验证手段）：

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ matrix.node-version }} }
      - run: npm ci
      - run: npm test
```

> 用矩阵在 **macOS / Windows / Ubuntu × Node 18/20/22** 上真机跑测试，提前发现跨平台问题。

### 10.3 配置 GitHub Secret

自动发布需要 npm token：
1. npm 官网生成 **Publish + Bypass 2FA** 的 token
2. GitHub 仓库 → **Settings → Secrets → Actions** → 新建 secret，Name 填 **`NPM_TOKEN`**

### 10.4 使用方式（以后发布只需两句）

```bash
git add . && git commit -m "改动" && git push   # 提交代码
git tag v1.0.5 && git push origin v1.0.5        # 打 tag 触发自动发布
```

### 10.5 CI 踩坑记录

- **依赖拉取失败**：`package-lock.json` 的 `resolved` 地址如果指向淘宝镜像
  `registry.npmmirror.com`，GitHub 服务器访问会超时。需重新生成指向官方源：
  ```bash
  rm -rf node_modules package-lock.json
  npm cache clean --force
  npm install --package-lock-only --registry=https://registry.npmjs.org/
  ```
- **Node 18/20 矩阵失败**：`npm install -g npm@latest` 的 `engines` 只支持 Node 22+，
  在 Node 18/20 上会失败。**不要**在 CI 里强制升级 npm，用 setup-node 自带的即可。
- **版本号回写失败（detached HEAD）**：tag 触发时 checkout 的是 detached tag，
  需显式 `ref: main` 检出分支，push 时用 `git push origin main`。

---

## 11. 常见坑汇总

| # | 坑 | 现象 | 解决 |
|---|----|------|------|
| 1 | 注册去了淘宝镜像 | "Public registration is not allowed" | 用 `npmjs.com` |
| 2 | registry 是镜像源 | `npm login/publish` 失败 | 临时切 `registry.npmjs.org` |
| 3 | 2FA 绑了 Security Key | `npm publish` 报 EOTP | 改用 Authenticator App 或 Bypass 2FA token |
| 4 | token 没勾 Bypass 2FA | 仍报 EOTP | 重新生成勾选 Bypass |
| 5 | server.js 是 CRLF | Mac 执行 `node\r: not found` | 转 LF + `.gitattributes` |
| 6 | `endsWith("server.js")` 判断入口 | 跨平台误判 | 用 `import.meta.url` + realpath |
| 7 | lock 文件 resolved 指向镜像 | CI 拉依赖超时 | 用官方源重新生成 lock |
| 8 | CI 升级 npm@latest | Node 18/20 失败 | 去掉升级步骤 |
| 9 | 版本号回写 detached HEAD | push 失败 exit 128 | checkout main 分支 |

---

## 12. FAQ

**Q1：发布到 npm 需要花钱吗？**
不用，npm 个人账号发布公共包免费。

**Q2：`files` 白名单不写会不会有问题？**
不写会把 `node_modules` 之外所有文件打进包（包括测试、docs、私有配置）。建议用 `files` 精简。

**Q3：MCP 工具是"自动拦截"时间问题吗？**
不是。是否调用由 LLM 判断，但"当前实时时间"这类问题（LLM 无实时时钟）几乎一定会走 MCP。

**Q4：改了代码怎么发新版本？**
打更高版本的 tag 并推送即可，CI 会自动完成测试、改版本号、发布、回写。

**Q5：npx 和全局安装有什么区别？**
`npx` 按需临时下载运行（不污染环境），`npm i -g` 全局常驻。都通过 `bin` 字段生效。

---

## 相关文档

- [mcp核心概念.md](mcp核心概念.md) —— MCP 是什么：角色、原语、真实报文、设计思想
- [mcp端到端流程.md](mcp端到端流程.md) —— MCP 怎么发生：从配置到关闭的完整流程
- [返回 README](../README.md)
