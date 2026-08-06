# Local Time MCP Server (Node.js)

一个用于学习 MCP（Model Context Protocol）的入门级 Server，提供本地时间相关的工具。

[![npm version](https://img.shields.io/npm/v/local-time-mcp-server?color=cb3837&label=npm%20version)](https://www.npmjs.com/package/local-time-mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/local-time-mcp-server?color=cb3837&label=npm%20downloads)](https://www.npmjs.com/package/local-time-mcp-server)
[![license](https://img.shields.io/npm/l/local-time-mcp-server?color=cb3837&label=license)](https://www.npmjs.com/package/local-time-mcp-server)

> 📖 **MCP 文档：**
> - [docs/mcp核心概念.md](docs/mcp核心概念.md) —— MCP 是什么：角色、原语、真实报文、设计思想
> - [docs/mcp端到端流程.md](docs/mcp端到端流程.md) —— MCP 怎么发生：从配置到关闭的完整流程

## 这是什么？

MCP 是一种让 AI 助手（如 WorkBuddy/CodeBuddy、Claude Desktop 等）调用外部工具的协议。
这个项目演示了**从零编写一个 Node.js MCP Server → 配置到 AI 助手 → 实际使用**的完整流程。

MCP 是语言无关的协议（stdio 传输 = 标准输入输出 + JSON-RPC）。本仓库使用官方
`@modelcontextprotocol/sdk` 实现。

```
┌─────────────┐     stdio      ┌─────────────────┐
│  AI 助手     │ ←───────────→ │  MCP Server      │
│ (WorkBuddy)  │   JSON-RPC     │  (server.js)     │
│              │                │                  │
│  "现在几点？" │ ──调用工具──→ │  get_current_time│
│              │ ←─返回结果───  │  ()              │
└─────────────┘                └─────────────────┘
```

## 提供的工具

| 工具名 | 功能 | 示例调用场景 |
|--------|------|-------------|
| `get_current_time` | 获取当前时间（支持时区） | "现在几点了？" "东京现在几点？" |
| `format_time` | 格式化指定时间点 | "把2026年1月1日格式化一下" |
| `time_diff` | 计算两个时间点的差值 | "距离2026年春节还有多久？" |
| `list_timezones` | 列出可用时区 | "有哪些亚洲时区？" |

## 通过 npm 安装（推荐）

已发布到 npm，可直接用 `npx` 一键运行，无需克隆本仓库：

```bash
npx local-time-mcp-server@latest
```

或全局安装后使用：

```bash
npm install -g local-time-mcp-server
local-time-mcp-server
```

> 需要 Node.js 18+ 环境。

## 从源码运行

### 1. 安装依赖

需要 Node.js 18+ 环境（已安装 Node 20 亦可）。

```bash
cd local-time-mcp
npm install              # 安装 @modelcontextprotocol/sdk
```

### 2. 直接测试（不走 MCP 协议）

```bash
npm test                 # 等价于 node test_server.js
```

这会直接调用工具逻辑，验证功能是否正确。

### 3. 启动 MCP Server

```bash
node server.js
```

MCP Client 会作为子进程启动它；你也可以直接运行以查看是否报错。

## 配置到 WorkBuddy / CodeBuddy

编辑 MCP 配置文件 `~/.workbuddy/mcp.json`（不存在则新建），添加：

**方式一：通过 npx 运行（推荐，无需克隆仓库）**

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

**方式二：本地源码路径**

```json
{
  "mcpServers": {
    "local-time": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/MyProjects/local-time-mcp/server.js"]
    }
  }
}
```

> **注意**：
> - 方式二中 `args` 的 `server.js` 路径**必须替换为你在本机克隆/存放该项目的实际路径**。
> - 如果你的 `node` 不在 PATH 中，请用完整路径，如 `"command": "D:/Software/Node/node.exe"`。

## 信任并启用

1. 打开 WorkBuddy，进入右上角**连接器管理**页面
2. 找到 `local-time` 连接器，点击 **Trust**（信任）
3. 现在你可以在对话中使用它了！

## 试试看

在 WorkBuddy 中直接问：
- "现在本地几点了？"
- "纽约现在几点？"
- "距离 2026 年 12 月 31 日还有多少天？"
- "列出所有亚洲时区"

## GitHub 集成

### 推送到 GitHub

```bash
# 初始化 git 仓库
cd local-time-mcp
git init
git add .
git commit -m "Initial commit: local time MCP server (Node.js)"

# 在 GitHub 上创建仓库后
git remote add origin https://github.com/<你的用户名>/local-time-mcp.git
git branch -M main
git push -u origin main
```

### 从 GitHub 克隆后配置

其他人（或你在另一台机器上）克隆后，只需：

1. `npm install`
2. 把 `mcp_config_example.json` 中的路径改成克隆后的实际路径
3. 写入 `~/.workbuddy/mcp.json`

## 发布到 npm

本包已支持发布到 npm，配置了 `bin`、`files`、`engines`、`repository` 等发布字段。

发布后即可通过 `npx local-time-mcp-server@latest` 一键运行，参见「通过 npm 安装」。

### 自动发布（GitHub Actions）

本项目已配置 CI/CD 自动发布：**每次打一个 `v*` 版本 tag 并推送，就会自动测试并发布到 npm，版本号由 tag 自动决定**，无需手动改 `package.json`。

```bash
# 1. 提交并推送你的代码改动
git add .
git commit -m "feat: xxx"
git push

# 2. 打版本 tag（版本号去掉 v 就是 npm 版本号，如 v1.0.2 → 1.0.2）
git tag v1.0.2
git push origin v1.0.2
```

推送 tag 后，GitHub Actions 会自动：

1. `npm test` 运行测试（失败则中止）
2. 自动把 `package.json` / `server.js` 的版本号改为 tag 版本（如 `1.0.2`）
3. `npm publish` 发布到 npm
4. 把版本号变更提交回仓库，保持同步

### 手动发布（不依赖 CI）

```bash
npm test                 # 发布前校验（prepublishOnly 会自动执行）
npm login                # 登录 npm 账号（首次）
npm publish              # 发布
```

> 因为账号启用了 Security Key 类型的 2FA，命令行发布需使用 **勾选 "Bypass 2FA" 的 Publish token**（详见下文「CI 密钥配置」），GitHub Actions 发布已通过 token 自动处理。

### CI 密钥配置（一次性）

首次启用自动发布前，需要在 GitHub 仓库配置一个密钥 `NPM_TOKEN`：

1. 在 npm 官网生成一个 **Publish 类型、勾选 "Bypass 2FA"** 的 token：https://www.npmjs.com/settings/~/tokens
2. 在 GitHub 仓库 → **Settings → Secrets and variables → Actions** → 新建 repository secret，Name 填 **`NPM_TOKEN`**，Value 填入刚才的 token
3. 之后每次打 `v*` tag 即可自动发布

## 项目结构

```
local-time-mcp/
├── server.js               # MCP Server 主程序（核心，npm bin 入口）
├── test_server.js          # 工具逻辑测试脚本（不走 MCP 协议）
├── package.json            # 依赖、脚本与 npm 发布配置（bin/files/engines）
├── mcp_config_example.json # WorkBuddy/CodeBuddy 配置示例
├── .github/
│   └── workflows/
│       ├── ci.yml          # 每次推送/PR 自动跑测试
│       └── publish.yml     # 打 v* tag 自动发布到 npm
├── docs/
│   ├── mcp核心概念.md          # MCP 是什么：角色、原语、真实报文、设计思想
│   └── mcp端到端流程.md        # MCP 怎么发生：从配置到关闭的完整流程
├── .gitignore
└── README.md
```

## 项目结构

```
local-time-mcp/
├── server.js               # MCP Server 主程序（核心，npm bin 入口）
├── test_server.js          # 工具逻辑测试脚本（不走 MCP 协议）
├── package.json            # 依赖、脚本与 npm 发布配置（bin/files/engines）
├── mcp_config_example.json # WorkBuddy/CodeBuddy 配置示例
├── docs/
│   ├── mcp核心概念.md          # MCP 是什么：角色、原语、真实报文、设计思想
│   └── mcp端到端流程.md        # MCP 怎么发生：从配置到关闭的完整流程
├── .gitignore
└── README.md
```

## MCP 协议工作原理（简要）

```
1. 启动：WorkBuddy 根据 mcp.json 中的 command+args 启动 server.js 子进程
2. 握手：通过 stdin/stdout 交换 JSON-RPC 消息，完成 initialize 握手
3. 发现：WorkBuddy 发送 tools/list 请求，Server 返回所有 server.tool() 注册的工具
4. 调用：用户提问 → LLM 判断需要调用哪个工具 → WorkBuddy 发送 tools/call
        → Server 执行对应函数 → 返回结果 → LLM 整合后回复用户
5. 退出：WorkBuddy 关闭时，子进程自动终止
```

## 扩展思路

- 增加日历工具：获取某天是星期几、是否节假日
- 增加定时提醒：结合 cron 实现定时通知
- 增加 Resource：暴露一个时间相关的只读资源
- 增加 Prompt：预设一些时间相关的 prompt 模板
- 切换传输方式：从 stdio 改为 SSE（Server-Sent Events）支持远程访问
- 完善 CI/CD：接入 GitHub Actions 在发版时自动发布到 npm
