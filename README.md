# Local Time MCP Server (Node.js)

一个用于学习 MCP（Model Context Protocol）的入门级 Server，提供本地时间相关的工具。

[![npm version](https://img.shields.io/npm/v/local-time-mcp-server?color=cb3837&label=npm%20version)](https://www.npmjs.com/package/local-time-mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/local-time-mcp-server?color=cb3837&label=npm%20downloads)](https://www.npmjs.com/package/local-time-mcp-server)
[![license](https://img.shields.io/npm/l/local-time-mcp-server?color=cb3837&label=license)](https://www.npmjs.com/package/local-time-mcp-server)

> 📖 **MCP 文档：**
> - [mcp核心概念.md](docs/mcp核心概念.md) —— MCP 是什么
> - [mcp端到端流程.md](docs/mcp端到端流程.md) —— MCP 完整流程
> - [mcp从零编写到发布上线.md](docs/mcp从零编写到发布上线.md) —— 从零编写 → 发布 npm → 使用的完整实战

---

## 这个仓库是做什么的？

MCP（Model Context Protocol）是一种**让 AI 助手调用外部工具**的协议。本仓库从零实现了一个 Node.js 的 MCP Server，**演示了完整的 "编写 → 发布到 npm → 配置到 AI 助手 → 实际使用" 流程**，可作为学习和参考的范本。

它只提供 4 个时间相关工具：

| 工具 | 功能 | 示例调用 |
|------|------|---------|
| `get_current_time` | 获取当前时间（支持时区） | "现在几点？""东京现在几点？" |
| `format_time` | 格式化指定时间点 | "把 2026-01-01 格式化一下" |
| `time_diff` | 计算两个时间点的差值 | "距离春节还有多久？" |
| `list_timezones` | 列出可用时区 | "有哪些亚洲时区？" |

已发布到 npm：**[local-time-mcp-server](https://www.npmjs.com/package/local-time-mcp-server)**（需 Node.js 18+）。

---

## 怎么使用

### 方式一：配置到 AI 助手（WorkBuddy / CodeBuddy）—— 最推荐

编辑 MCP 配置文件 `~/.workbuddy/mcp.json`（不存在则新建），通过 **npx** 一键运行，**无需克隆仓库**：

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

配置完成后，在 AI 助手的**连接器管理**页面找到 `local-time` 并点击 **Trust（信任）**，即可在对话中使用。


### 方式二：npx 一键运行（推荐，无需克隆仓库）

```bash
npx local-time-mcp-server@latest
```

或全局安装：

```bash
npm install -g local-time-mcp-server
local-time-mcp-server
```

> **安装之后**：`local-time-mcp-server` 是一个 stdio 类型的 MCP Server，直接运行时会**挂起等待标准输入**（它本身不提供交互界面）。它的作用是**作为子进程被 AI 客户端启动**，所以安装后下一步是把它**配置到 AI 助手**（见下方"方式一"），然后在对话中就能调用时间工具了。

### 试试看

在 AI 助手中直接问：
- "现在本地几点了？"
- "纽约现在几点？"
- "距离 2026 年 12 月 31 日还有多少天？"
- "列出所有亚洲时区"

---

## 发布到 npm

本仓库已配置 **CI/CD 自动发布**：打一个 `v*` 版本 tag 并推送，即自动测试、改版本号并发布到 npm。

```bash
git add . && git commit -m "改动" && git push
git tag v1.0.5 && git push origin v1.0.5
```

详细的发布步骤、2FA 处理、跨平台修复、CI/CD 配置等，见 [mcp从零编写到发布上线.md](docs/mcp从零编写到发布上线.md)。

---

## 项目结构

```
local-time-mcp/
├── server.js               # MCP Server 主程序（npm bin 入口）
├── test_server.js          # 工具逻辑测试脚本
├── package.json            # 依赖与发布配置（bin/files/engines）
├── mcp_config_example.json # MCP 配置示例
├── .github/workflows/      # CI/CD（测试 + 自动发布）
├── docs/                   # MCP 概念与实战文档
├── .gitignore
└── README.md
```
