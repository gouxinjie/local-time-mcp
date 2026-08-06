# Local Time MCP Server

一个用于学习 MCP（Model Context Protocol）的入门级 Server，提供本地时间相关的工具。

## 这是什么？

MCP 是一种让 AI 助手（如 WorkBuddy/CodeBuddy、Claude Desktop 等）调用外部工具的协议。
这个项目演示了**从零编写一个 MCP Server → 配置到 AI 助手 → 实际使用**的完整流程。

```
┌─────────────┐     stdio      ┌─────────────────┐
│  AI 助手     │ ←───────────→ │  MCP Server      │
│ (WorkBuddy)  │   JSON-RPC     │  (server.py)     │
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

## 快速开始

### 1. 安装依赖

```bash
cd local-time-mcp
pip install -r requirements.txt
```

### 2. 直接测试（不走 MCP 协议）

```bash
python test_server.py
```

这会直接调用工具函数，验证逻辑是否正确。

### 3. 配置到 WorkBuddy / CodeBuddy

编辑 MCP 配置文件 `~/.workbuddy/mcp.json`（不存在则新建），添加：

```json
{
  "mcpServers": {
    "local-time": {
      "command": "python",
      "args": ["C:/Users/xinjie/WorkBuddy/2026-08-06-08-28-44/local-time-mcp/server.py"]
    }
  }
}
```

> **注意**：如果你的 `python` 不在 PATH 中，请用完整路径，如 `"command": "C:/Users/xinjie/.workbuddy/binaries/python/versions/3.13.12/python.exe"`

### 4. 信任并启用

1. 打开 WorkBuddy，进入右上角**连接器管理**页面
2. 找到 `local-time` 连接器，点击 **Trust**（信任）
3. 现在你可以在对话中使用它了！

### 5. 试试看

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
git commit -m "Initial commit: local time MCP server"

# 在 GitHub 上创建仓库后
git remote add origin https://github.com/<你的用户名>/local-time-mcp.git
git branch -M main
git push -u origin main
```

### 从 GitHub 克隆后配置

其他人（或你在另一台机器上）克隆后，只需：

1. `pip install -r requirements.txt`
2. 把 `mcp_config_example.json` 中的路径改成克隆后的实际路径
3. 写入 `~/.workbuddy/mcp.json`

## 项目结构

```
local-time-mcp/
├── server.py               # MCP Server 主程序（核心）
├── test_server.py          # 工具函数测试脚本（不走 MCP 协议）
├── requirements.txt        # Python 依赖
├── mcp_config_example.json # WorkBuddy/CodeBuddy 配置示例
├── .gitignore
└── README.md
```

## MCP 协议工作原理（简要）

```
1. 启动：WorkBuddy 根据 mcp.json 中的 command+args 启动 server.py 子进程
2. 握手：通过 stdin/stdout 交换 JSON-RPC 消息，完成 initialize 握手
3. 发现：WorkBuddy 发送 tools/list 请求，Server 返回所有 @mcp.tool() 注册的工具
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
