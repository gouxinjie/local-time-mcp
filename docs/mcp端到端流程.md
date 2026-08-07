# MCP 端到端流程：从配置到关闭

> 本文是 MCP 的**流程篇**，讲"怎么发生"：按时间顺序，把 MCP 从打开 CodeBuddy 到关闭，完整走一遍。
> 想看"是什么"（角色、原语、真实报文），见姊妹篇 [mcp核心概念.md](mcp核心概念.md)。
>
> 以本仓库真实案例为主线：**CodeBuddy + local-time MCP Server（server.js，Node.js）**。

---

## 0. 一分钟看懂全程

MCP 的整个生命周期，其实只干一件事：**让你的大模型（LLM）能调用你写的 server.js**。

把整个流程压成一句话：

> **你配置好 server.js → 打开 CodeBuddy 时，Host 自动把 server.js 启动起来、跟它"打招呼"（握手）、问它有哪些工具（tools/list）→ 之后每次你提问，Host 就替大模型去调对应工具 → 拿到结果再交给大模型组织回答 → 你关闭 CodeBuddy，server.js 随之结束。**

下图把整个过程画成一整条时间线（**先看这张图，再往下读细节**）：

```text
[你写好 server.js 并配置好]              ← 准备工作，还没人运行它
   │
[打开 CodeBuddy]
   ▼
╔══════════════ 启动阶段：Host 自动做，与你是否提问无关 ══════════════╗
║  ① 启动进程：node 运行 server.js（它开始监听 stdin，进入待命）      ║
║  ② 握手：Client ↔ server 约定协议版本、互相报能力（做一次）          ║
║  ③ 发现工具：Client 问 tools/list，把清单注入大模型上下文（做一次）   ║
╚═══════════════════════════════════════════════════════════════════╝
   │  （此刻一切就绪，只等你提问）
   ▼
[你输入"现在几点了？"]                  ← 从这里起，才由"提问"触发
   ▼
╔══════════════ 调用阶段：每次提问触发一次 ═══════════════════════════╗
║  ① 大模型 推理#1：判断"该用 get_current_time"（只是思考，不执行）    ║
║  ② Client 把意图翻译成 tools/call，经 stdin 发给 server.js         ║
║  ③ server.js 真正执行工具函数，经 stdout 返回结果  ← 等待发生在这    ║
║  ④ Client 剥壳，把结果交给大模型                                    ║
║  ⑤ 大模型 推理#2：组织成自然语言回答 → 显示给你                      ║
╚═══════════════════════════════════════════════════════════════════╝
   │  （server.js 一直活着，等下一次提问）
   ▼
[你再提问] → 重复调用阶段 ①~⑤（不用重新握手/发现）
   │
[关闭 CodeBuddy]
   ▼
server.js 子进程被终止
```

- **启动阶段**：Host 一打开就自动完成，**跟你提不提问没关系**。
- **调用阶段**：**每次提问**触发一次。
- 两个阶段之间：**握手和发现只做一次**，之后的每次提问都复用，所以很快。

> 如果你刚接触 MCP，建议先读 [mcp核心概念.md](mcp核心概念.md) 里的"角色"（Host/Client/Server）和"一张图看懂"再回来，会更容易跟上。

---

## 1. 案例背景与配置

### 1.1 配置

在 CodeBuddy 里启用这个 server，靠的是配置文件 `~/.codebuddy/mcp.json`：

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

简单说，这段配置告诉 CodeBuddy：**"local-time 这个连接器，就是用 `node` 命令去跑 `server.js`，走 stdio 通信。"**

### 1.2 配置字段详解

配置文件告诉 Host **怎么启动** server 子进程。字段分两类：

**① MCP 官方标准字段**（所有 Host 通用）：

| 字段 | 含义 | 本例值 |
|------|------|--------|
| `type` | 传输方式。`stdio` = 通过标准输入输出通信，Server 作为子进程启动 | `"stdio"` |
| `command` | 要执行的**程序名**，Host 用它启动子进程 | `"node"` |
| `args` | 传给 `command` 的参数。`[server.js]` 即"让 node 运行 server.js" | `["D:/.../server.js"]` |
| `env`（可选） | 给子进程设置的环境变量（如 API Key），本例没用 | — |
| `cwd`（可选） | 子进程的工作目录，本例没用 | — |

合起来，启动命令就是：`node D:/MyProjects/local-time-mcp/server.js`。

**② Host 扩展字段**（不属于 MCP 官方规范，是 CodeBuddy 自身的）：

| 字段 | 含义 | 示例值 |
|------|------|--------|
| `disabled` | 该连接器是否禁用。`false` = 启用；`true` = 禁用（Host 不会启动它） | `false` |
| `autoApprove` | **自动批准**的工具列表。某些工具调用需要用户确认；放进此数组的**免确认自动执行**。空数组 = 都不自动批准 | `[]` |
| `timeout` | 调用该 server 的超时时间（毫秒）。超过未响应则判定调用失败 | `60000`（60 秒） |

> ⚠️ `disabled`、`autoApprove`、`timeout` **不是 MCP 协议的一部分**，是 CodeBuddy 的宿主级扩展，不同 Host 字段可能不同。MCP 官方只规定 `type`/`command`/`args`/`env` 等启动与通信字段。

> 💡 官方还允许 `env`（注入环境变量）和 `cwd`（工作目录），以及用 `${VAR}` 语法引用环境变量。本案例未用到。

---

## 2. 启动阶段：打开 CodeBuddy 时自动发生

启动阶段干三件事：**启动进程 → 握手 → 发现工具**。全部是 Host 自动完成的，**与你是否提问无关**。

### 2.1 准备：写好 server.js（还没人运行它）

你定义了 4 个工具（`get_current_time` / `format_time` / `time_diff` / `list_timezones`），每个工具都包含：名字、描述、参数 schema（Zod）、执行回调。

此刻 server.js 只是磁盘上的一个文件，`node_modules` 里躺着它的静态依赖。**还没人执行它。**

### 2.2 启动进程：node 把 server.js 拉起来

双击打开 CodeBuddy，在你问任何问题之前，Host 就自动启动所有配置好的连接器：

```text
CodeBuddy (Host) 启动
   │ 1. 读取 ~/.codebuddy/mcp.json
   │ 2. 为每个连接器准备一个 Client
   │ 3. 用配置启动 server 子进程
   ▼
执行：node D:/MyProjects/local-time-mcp/server.js
   ▼
server.js 子进程诞生，开始执行
```

server.js 一启动就执行 `server.connect(transport)`：
- **监听 stdin**（Node 事件循环阻塞在读取 stdin）
- 成为**常驻待命**的服务，等着收消息

> 白话理解：现在 Host（CodeBuddy）和 server.js 之间的"电话线"（stdin/stdout）已经接好了，两边都在等着通话。

### 2.3 握手：双方先"对暗号"

通信前，Client 和 Server 必须先**握手（initialize）**，确认"咱俩说的是同一个版本、你能提供什么能力"。这一步官方叫**能力协商**。

握手是三步（只有都完成，才允许后续请求）：

```text
① Client ──stdin──▶ {"jsonrpc":"2.0","id":1,"method":"initialize",
                      "params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{...}}}
② Server ──stdout──▶ {"result":{"protocolVersion":"2024-11-05",
                      "capabilities":{"tools":{"listChanged":true}},
                      "serverInfo":{"name":"local-time-server","version":"1.0.4"}},"jsonrpc":"2.0","id":1}
③ Client ──stdin──▶ {"jsonrpc":"2.0","method":"notifications/initialized"}   ← 通知"初始化完成"
```

- ① Client 报上自己想用的协议版本和能力。
- ② Server 回报它支持的版本（并声明自己支持 tools）。
- ③ Client 发一个**通知**确认"初始化完成"。**这个通知没有响应**。

握手只在**连接时做一次**，不会每次提问都重来一遍。

### 2.4 发现工具：问 server 有哪些"货"

Client 想知道 server 有哪些工具可用，于是请求工具列表（`tools/list`）：

```text
Client ──stdin──▶ {"method":"tools/list","params":{}}
Server ──stdout──▶ {"result":{"tools":[
   {"name":"get_current_time","description":"...","inputSchema":{"properties":{"tz":{...}}}},
   {"name":"format_time","description":"...","inputSchema":{...}},
   {"name":"time_diff","description":"...","inputSchema":{...}},
   {"name":"list_timezones","description":"...","inputSchema":{...}}
]},"jsonrpc":"2.0","id":2}
```

关键点：
- 这里的 `inputSchema` 就是你在 `server.tool()` 里写的 Zod schema，SDK 自动转成了标准 JSON Schema。
- Client 拿到清单后，会把它**注入大模型上下文**，让大模型"睁眼就知道有这 4 个工具可用、每个怎么填参数"。这也是 tools/list **只做一次**的原因——之后每次提问都能复用这份清单。

> 补充：如果 server 后续**动态增删了工具**，会通过 `notifications/tools/list_changed` 通知 Client 刷新——但本项目工具启动时就固定了，不会用到。

> 小结：**启动阶段做完，一切就绪，进入"等待用户"状态。** 你还没开口，但背后已经全准备好了。

---

## 3. 调用阶段：每次提问触发一次

启动阶段是"接线"，调用阶段才是"干活"。你每次提问，都会走一遍 ①→⑤。

### 3.1 提问：大模型"想"一下用什么工具

你输入："现在几点了？"——前面的握手和 tools/list 在启动阶段早做好了，这里只做"调用"这一件事。

大模型先做**第一次推理**（纯文本思考，不执行任何东西）：

```text
你的提问 ──▶ 大模型（上下文里已有启动阶段注入的工具清单）
   │
   ▼
大模型 推理 #1：
   "这个问题需要查当前时间 → 用 get_current_time"
   "参数：用默认本地时区即可"
   ──▶ 输出一个信号："调用 get_current_time"
```

注意：大模型**没有任何能力去运行 server.js**。它只输出一个调用意图，等着 Client 去执行。

### 3.2 传话：Client 把意图翻译成协议消息

Host 里的 Client 拿到大模型的意图，翻译成 JSON-RPC，往 server.js 的 stdin 写入：

```text
Client ──stdin──▶ {"jsonrpc":"2.0","id":3,"method":"tools/call",
                     "params":{"name":"get_current_time","arguments":{"tz":"Asia/Shanghai"}}}
```

Client 在这里只是"传话"，不干活。

### 3.3 干活：server.js 真正执行工具

server.js 一直监听 stdin，收到 `tools/call` 后真正执行：

```text
收到 {"method":"tools/call","name":"get_current_time","arguments":{"tz":"Asia/Shanghai"}}
   │ 1. 解析 JSON，看到 method=tools/call
   │ 2. 从工具注册表（server.tool() 登记的 Map）按 name 取出回调
   │ 3. 把 arguments 传进去，真正执行：currentTimeInTimezone("Asia/Shanghai")
   │ 4. Node 运行时算出当前上海时间
   ▼
包装成响应，写往 stdout：
Server ──stdout──▶ {"result":{"content":[{"type":"text","text":"{...}"}]},"jsonrpc":"2.0","id":3}
```

这里有个容易误会的地方，关于"谁在等待"：
- **Client 在这里阻塞等待** server.js 返回。
- **大模型并不是"在等待"**——它的第一次推理已经结束。是 Client 拿到结果后，会发起**第二次推理**。

### 3.4 回传：Client 剥壳，结果交给大模型

Client 从 stdout 读到响应后：

```text
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

关键点：**只有 stdout 里经 Client 剥壳的工具结果才进入大模型**。stdin 是上行、stderr 是给开发者看日志的，都不进大模型。

### 3.5 连续对话：反复走 3.1~3.4，server.js 一直活着

你继续问："那纽约现在几点？""距离 2026 年底还有多少天？"

每一次提问，都会重复 **3.1 → 3.4**：

```text
你提问 ──▶ 大模型决策 ──▶ Client 发 tools/call ──▶ server.js 执行 ──▶ 结果回大模型 ──▶ 回答
```

关键点：server.js **不会**处理完一次就退出。它一直活着、持续监听 stdin，随时接下一个请求——这就是"常驻待命"。

### 3.6 关闭：server 进程终止

官方把 MCP 生命周期划为三段：**初始化 → 运行 → 关闭**。前面 2.x 是初始化，3.1~3.5 是运行，这里就是**关闭**。

你关闭 CodeBuddy（Host），有两种情况：

```text
方式 A：Host 正常关闭（优雅）
   Client 取消未完成的任务（notifications/cancelled）→ 断开连接
   → Host 关闭所有连接器对应的子进程
   → server.js 子进程被终止

方式 B：Host 被强制退出 / 崩溃
   → server.js 子进程作为其子进程，随之被终止
```

无论哪种方式，最后都是：

```text
server.js 子进程被终止
   │
   ▼
操作系统回收该进程的资源（文件句柄、内存、派生的子进程）
```

关于依赖的归宿：
- `node_modules` 里的**静态依赖还在磁盘上**——下次启动直接用，不重新下载（它跟着"项目"走，不跟"进程"走）。
- 如果 server 运行中动态创建了临时文件/连接，**进程终止不会清理磁盘文件**，要靠代码自己释放。

---

## 4. 对本项目的启发 / 扩展方向

结合 MCP 的三个原语，本项目的扩展空间：

- **加 Resource**：暴露 `time://now` 之类的只读时间资源，供 LLM 作为上下文读取。
- **加 Prompt**：预设"换算时区""计算节假日倒计时"等模板。
- **切传输**：从 stdio 换成 Streamable HTTP，支持远程调用。
- **发布 npm 包**：`npx local-time-mcp-server@latest` 一键使用。

---

## 5. 官方参考

- **MCP 规范主页（含最新版本）**：<https://modelcontextprotocol.io/specification/2024-11-05>
- **基础协议（握手/生命周期/传输）**：<https://modelcontextprotocol.io/specification/2024-11-05/basic/lifecycle>
- **服务器原语（Resources/Prompts/Tools）**：<https://modelcontextprotocol.io/specification/2024-11-05/server/>
- **工具规范（tools/list、tools/call）**：<https://modelcontextprotocol.io/specification/2024-11-05/server/tools>

> 注：MCP 仍在演进，各版本规范有差异。本文锚定 `2024-11-05` 撰写，链接也指向该版本；本项目使用的 Node SDK `@modelcontextprotocol/sdk`（1.30）在握手时会协商并实际采用更新的协议版本 `2025-06-18`。两者在本文涉及的握手流程、`tools/list`、`tools/call` 上行为一致，故不影响理解。若需对照最新规范，可将上方链接中的 `2024-11-05` 替换为 `2025-06-18`。
