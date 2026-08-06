# MCP 端到端流程：从配置到关闭

> 本文是 MCP 的**流程篇**，讲"怎么发生"：按**连续时间线**把 MCP 从打开 CodeBuddy 到关闭走一遍。
> 想看"是什么"（角色、原语、真实报文），见姊妹篇 [mcp核心概念.md](mcp核心概念.md)。
>
> 以本仓库真实案例为主线：**CodeBuddy + local-time MCP Server（server.js，Node.js）**。

---

## 0. 案例背景与配置

### 0.1 配置

配置文件 `~/.codebuddy/mcp.json`：

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

### 0.2 配置字段详解

配置文件里的每个字段，决定了 Host 如何启动和对待 server 子进程。分两类：

**① MCP 官方标准字段（stdio）**：

| 字段 | 含义 | 本例值 |
|------|------|--------|
| `type` | 传输方式。`stdio` = 通过标准输入输出通信，Server 作为子进程启动 | `"stdio"` |
| `command` | 要执行的**程序名**（可执行文件），Host 用它启动子进程 | `"node"` |
| `args` | 传给 `command` 的命令行参数。`[server.js]` 即"让 node 运行 server.js" | `["D:/.../server.js"]` |
| `env`（可选） | 给子进程设置的**环境变量**（如 API Key），不在本例 | — |
| `cwd`（可选） | 子进程的**工作目录**，不在本例 | — |

启动命令组合起来就是：`node D:/MyProjects/local-time-mcp/server.js`。

**② Host（WorkBuddy/CodeBuddy）扩展字段**（不属于 MCP 官方规范，是宿主自身的配置）：

| 字段 | 含义 | 示例值 |
|------|------|--------|
| `disabled` | 该连接器是否**禁用**。`false` = 启用；`true` = 禁用（Host 不会启动它） | `false` |
| `autoApprove` | **自动批准**的工具列表。某些 Host 对工具调用需要用户确认；若把某工具名放进此数组，则该工具调用**免确认自动执行**。空数组 = 都不自动批准 | `[]` |
| `timeout` | 调用该 server 的**超时时间**（毫秒）。超过这个时长 server 未响应，Host 判定调用失败 | `60000`（60 秒） |

> ⚠️ `disabled`、`autoApprove`、`timeout` **不是 MCP 协议的一部分**，是 WorkBuddy/CodeBuddy 对连接器的宿主级扩展，不同 Host 可能字段不同。MCP 官方只规定 `type`/`command`/`args`/`env` 等启动与通信字段。

> 💡 官方还允许 `env`（给子进程注入环境变量）和 `cwd`（工作目录）等字段，以及用 `${VAR}` 语法引用环境变量。本案例未用到。

---

## 1. 时间线：一次完整的 MCP 生命周期

> 本篇明确区分两个阶段：
> - **启动阶段**：Host 打开时自动完成（启动进程、握手、发现工具），**与你是否提问无关**。
> - **调用阶段**：每次提问触发一次（大模型决策、tools/call、执行、组织回答）。

### ① 准备：写好 server.js（还没人运行它）

你定义了 4 个工具（`get_current_time` / `format_time` / `time_diff` / `list_timezones`），每个工具都包含：名字、描述、参数 schema（Zod）、执行回调。

此刻 server.js 只是磁盘上的一个文件，`node_modules` 里躺着它的静态依赖。**还没人执行它。**

---

### ② 打开 CodeBuddy：进入"启动阶段"（自动完成，不需要你提问）

你双击打开 CodeBuddy。**在你还没问任何问题之前**，Host 就会自动做一整轮启动准备：

```
CodeBuddy (Host) 启动
   │ 1. 读取 ~/.codebuddy/mcp.json
   │ 2. 为每个连接器准备一个 Client
   │ 3. 用配置启动 server 子进程
   ▼
执行：node D:/MyProjects/local-time-mcp/server.js
   │
   ▼
server.js 子进程诞生，开始执行
```

server.js 一启动就执行 `server.connect(transport)`：
- **监听 stdin**（Node 事件循环阻塞在读取 stdin）
- 成为**常驻待命**的服务，等着收消息

**此刻谁在干什么**：Host 在"启动进程"，Client 刚刚建立，server.js 在"待命"。

---

### ③ 握手 initialize + initialized（启动阶段，做一次）

握手是 **Client 与 server 建立连接时的第一步**。它确定"双方用同一个协议版本、server 能提供什么能力"（官方叫**能力协商** capability negotiation）。

**官方完整握手是三步**（只有都完成，才允许后续请求）：

```
① Client ──stdin──▶ {"jsonrpc":"2.0","id":1,"method":"initialize",
                      "params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{...}}}
② Server ──stdout──▶ {"result":{"protocolVersion":"2024-11-05",
                      "capabilities":{"tools":{"listChanged":true}},
                      "serverInfo":{"name":"local-time-server","version":"1.0.0"}},"jsonrpc":"2.0","id":1}
③ Client ──stdin──▶ {"jsonrpc":"2.0","method":"notifications/initialized"}   ← 通知"初始化完成"
```

- ① Client 声明自己的能力（sampling 等）。
- ② Server 回报自己支持的**协议版本**和**能力**（这里声明支持 tools）。
- ③ Client 发 `notifications/initialized` **通知**，确认初始化完成。**此通知没有响应**。

**此刻谁在干什么**：Client 在"试探 + 确认"，Server 在"报家门"。**它只在连接时做一次**，不会每次提问都重打招呼。

---

### ④ tools/list：把"货架清单"告诉 Client（启动阶段，做一次）

Client 想知道 server 有哪些工具，于是请求工具列表。把清单缓存好并注入大模型上下文，让大模型一"睁眼"就知道有哪些工具可用。**不会每次提问都重新拉一遍**。

```
Client ──stdin──▶ {"method":"tools/list","params":{}}
Server ──stdout──▶ {"result":{"tools":[
   {"name":"get_current_time","description":"...","inputSchema":{"properties":{"tz":{...}}}},
   {"name":"format_time","description":"...","inputSchema":{...}},
   {"name":"time_diff","description":"...","inputSchema":{...}},
   {"name":"list_timezones","description":"...","inputSchema":{...}}
]},"jsonrpc":"2.0","id":2}
```

**关键**：这里的 `inputSchema` 就是你在 `server.tool()` 里写的 Zod schema，SDK 转成了标准 JSON Schema。
Client 拿到清单后，会把它**注入对话上下文**，让大模型知道"有这 4 个工具可用、每个怎么填参数"。

> 补充：如果 server 后续**动态增删了工具**，会通过 `notifications/tools/list_changed` 通知 Client，Client 再刷新清单——但本项目工具是启动时就固定好的，不会用到。

> ⚠️ **②③④ 都是"启动阶段"**：Host 一打开就自动做，**与你是否提问无关**。做完这些，一切就绪，进入"等待用户"的状态。

---

### ⑤ 你提问，进入"调用阶段"（从这里开始，才由提问触发）

你输入："现在几点了？" —— 前面的握手和 tools/list 在启动阶段早就做好了，这里只做"调用"这一件事。

```
你的提问 ──▶ 大模型（它上下文里已有启动阶段注入的工具清单）
   │
   ▼
大模型 推理 #1（纯文本推理）：
   "这个问题需要查当前时间 → 用 get_current_time"
   "参数：用默认本地时区即可"
   ──▶ 输出一个信号："调用 get_current_time"
```

**此刻谁在干什么**：**只有大模型在"想"**。它判断该用哪个工具、参数填什么，但**它没有任何能力去运行 server.js**——它只输出一个调用意图，等着 Client 去执行。

---

### ⑥ Client 翻译并发送 tools/call（协议层动手）

Host 里的 Client 拿到大模型的意图，翻译成 JSON-RPC，**往 server.js 的 stdin 写入一行**：

```
Client ──stdin──▶ {"jsonrpc":"2.0","id":3,"method":"tools/call",
                     "params":{"name":"get_current_time","arguments":{"tz":"Asia/Shanghai"}}}
```

**此刻谁在干什么**：Client 在"传话"。它把大模型的"意图"变成协议消息。

---

### ⑦ server.js 真正执行工具（等待发生在这里）

server.js 一直监听 stdin，收到 `tools/call` 后：

```
收到 {"method":"tools/call","name":"get_current_time","arguments":{"tz":"Asia/Shanghai"}}
   │ 1. 解析 JSON，看到 method=tools/call
   │ 2. 从工具注册表（server.tool() 登记的 Map）按 name 取出回调
   │ 3. 把 arguments 传进去，真正执行：currentTimeInTimezone("Asia/Shanghai")
   │ 4. Node 运行时算出当前上海时间
   ▼
包装成响应，写往 stdout：
Server ──stdout──▶ {"result":{"content":[{"type":"text","text":"{...}"}]},"jsonrpc":"2.0","id":3}
```

**此刻谁在干什么**：**server.js 真正"干活"**（Node 运行时执行函数）。

**关于"等待"**：
- **Client 在这里阻塞等待** server.js 返回。
- **大模型不是"在等待"**——它第一次推理已经结束。是 Client 拿到结果后，会发起**第二次推理**。

---

### ⑧ 结果回大模型，组织回答

```
Client 从 stdout 读到响应
   │ 剥壳：只提取 result.content 里的工具结果，丢掉 jsonrpc/id/result 这些协议包装
   ▼
把"原问题 + 工具结果"一起再交给大模型
   │
   ▼
大模型 推理 #2：组织自然语言回答
   "现在上海时间是 2026年08月06日 10:21:49，UTC+8"
   │
   ▼
显示在 CodeBuddy 界面上
```

**此刻谁在干什么**：Client 在"转交"，大模型在"组织语言"。

**关键**：**只有 stdout 里经 Client 剥壳的工具结果才进入大模型**。stdin 是上行、stderr 是给开发者看日志，都不进大模型。

---

### ⑨ 连续对话：反复走 ⑤~⑧（server.js 一直活着）

你继续问："那纽约现在几点？""距离 2026 年底还有多少天？"

每一次提问，都会重复 **⑤ → ⑧**：

```
你提问 ──▶ 大模型决策 ──▶ Client 发 tools/call ──▶ server.js 执行 ──▶ 结果回大模型 ──▶ 回答
 ⑤ 推理#1      ⑥ 传话         ⑦ 干活          ⑧ 推理#2
```

**关键**：server.js **不会**处理完一次就退出。它一直活着、持续监听 stdin，随时接下一个请求——这就是"常驻待命"。

---

### ⑩ 关闭 CodeBuddy：server 进程终止

官方把 MCP 生命周期划为三段：**初始化 → 运行（操作）→ 关闭**。前面 ②③④ 是初始化，⑤~⑨ 是运行，这里就是**关闭**阶段。

你关闭 CodeBuddy（Host）。关闭有两种方式：

```
方式 A：Host 正常关闭（优雅）
   Client 取消未完成的任务（notifications/cancelled）→ 断开连接
   → Host 关闭所有连接器对应的子进程
   → server.js 子进程被终止

方式 B：Host 被强制退出 / 崩溃
   → server.js 子进程作为其子进程，随之被终止
```

无论哪种方式，最后都会落到：

```
server.js 子进程被终止
   │
   ▼
操作系统回收该进程的资源（文件句柄、内存、派生的子进程）
```

**关于依赖的归宿**：
- `node_modules` 里的**静态依赖还在磁盘上**——下次启动直接用，不重新下载（它跟着"项目"走，不跟"进程"走）。
- 如果 server 运行中动态创建了临时文件/连接，**进程终止不会清理磁盘文件**，要靠代码自己释放。

---

## 2. 全程总览：一条连续的时间线

```
你写好 server.js
   │
[打开 CodeBuddy]
   ▼
╔════════════════════════════ 启动阶段（Host 自动做，与提问无关）════════════════════════════╗
║  CodeBuddy (Host) 启动 → node 启动 server.js 子进程（监听 stdin）                            ║
║  Client ↔ server.js 握手 initialize（做一次）                                              ║
║  Client 请求 tools/list，拿到工具清单 → 注入大模型上下文（做一次）                            ║
╚══════════════════════════════════════════════════════════════════════════════════╝
   │  （此刻一切就绪，等待用户）
   ▼
[你在对话框输入"现在几点了？"]  ←── 从这里起，才由"提问"触发
   ▼
╔════════════════════════════ 调用阶段（每次提问触发一次）════════════════════════════╗
║  ① 大模型 推理#1：决定用 get_current_time（纯思考，不执行）                           ║
║  ② Client 翻译成 tools/call，经 stdin 发给 server.js                                ║
║  ③ server.js 真正执行工具函数，经 stdout 返回结果   ←─ 等待发生在这                   ║
║  ④ Client 剥壳，把结果交给大模型                                                     ║
║  ⑤ 大模型 推理#2：组织回答 → 显示给你                                                ║
╚══════════════════════════════════════════════════════════════════════════════════╝
   │  （server.js 一直活着，等待下一次调用）
   ▼
[你又问"纽约几点？"] → 重复调用阶段 ①~⑤（不再重新握手/发现）
   │
[关闭 CodeBuddy]
   ▼
CodeBuddy 退出 → server.js 子进程终止
```

---

## 3. 对本项目的启发 / 扩展方向

结合 MCP 的三个原语，本项目的扩展空间：

- **加 Resource**：暴露 `time://now` 之类的只读时间资源，供 LLM 作为上下文读取。
- **加 Prompt**：预设"换算时区""计算节假日倒计时"等模板。
- **切传输**：从 stdio 换成 Streamable HTTP，支持远程调用。
- **发布 npm 包**：`npx local-time-mcp-server@latest` 一键使用。

---

## 4. 官方参考

- **MCP 规范主页（含最新版本）**：<https://modelcontextprotocol.io/specification/2024-11-05>
- **基础协议（握手/生命周期/传输）**：<https://modelcontextprotocol.io/specification/2024-11-05/basic/lifecycle>
- **服务器原语（Resources/Prompts/Tools）**：<https://modelcontextprotocol.io/specification/2024-11-05/server/>
- **工具规范（tools/list、tools/call）**：<https://modelcontextprotocol.io/specification/2024-11-05/server/tools>

> 注：MCP 仍在演进，各版本规范有差异。本项目使用 Node SDK `@modelcontextprotocol/sdk`，其默认支持的协议版本为 `2024-11-05`。
