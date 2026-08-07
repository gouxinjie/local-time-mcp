# MCP 核心概念：角色、原语与协议

> MCP（Model Context Protocol，模型上下文协议）是一套**开放协议**，用于让 AI 应用（Host）以标准化的方式接入外部工具、数据源和交互界面。
>
> 本文是 MCP 的**概念篇**，讲"是什么"：角色、原语、传输方式、真实报文、设计思想。
> 想看完整生命周期怎么串起来，见姊妹篇 [mcp端到端流程.md](mcp端到端流程.md)。


## 1. 一句话理解 MCP

MCP 解决的痛点是：**大模型（LLM）本身只会"说话"，不会执行动作**。它无法读你的文件、查数据库、发请求。MCP 给 LLM 提供了"手"和"眼睛"——通过一组标准化的接口，让 LLM 能调用外部能力，并把结果拿回来继续推理。

类比：
- 对 LLM 而言，MCP 相当于 **USB-C 接口**：任何支持这个标准的"外设"（工具、数据源）都能即插即用。
- 对开发者而言，MCP 是 **"AI 的 USB 标准"**：写一次 Server，就能被所有支持 MCP 的 AI 助手复用。

> 一句话总结：**LLM 负责"想"，MCP 负责"做"**。LLM 通过 MCP 把意图翻译成对工具的调用，拿到结果后继续推理，最终把答案讲给你听。

**架构 + 流程一张图看懂（角色分层 + 数据往返）**

```text
        ┌─────────────────────┐
        │       你（用户）      │
        └──────────┬──────────┘
                   │ ① 提问「帮我查一下上个月的销售数据」
                   ▼
  ╔═════════════════════════════════════════════════════╗
  ║                      HOST (AI 应用，如 CodeBuddy)     ║
  ║                                                     ║
  ║   ┌─────────────────────┐                           ║
  ║   │      大模型 LLM      │  ② 理解意图：需要查数据库     ║
  ║   └──────────┬──────────┘                           ║
  ║              │ ③ 决定调用工具，按 MCP 协议发起请求      ║
  ║              ▼                                      ║
  ║   ┌─────────────────────┐                           ║
  ║   │      MCP Client     │  ← 协议连接器，替 LLM       ║
  ║   └──────────┬──────────┘    跟某个 Server 一对一通信  ║
  ║              │ ④ JSON-RPC (stdio/HTTP)              ║
  ╚══════════════╪══════════════════════════════════════╝
                 ▼
        ┌─────────────────────┐
        │      MCP Server     │  ⑤ 执行真实逻辑
        └──────────┬──────────┘
                   │ ⑥ 调用/查询
                   ▼
        ┌─────────────────────┐
        │      外部系统        │  ← 数据库、GitHub、文件、企业 API
        └──────────┬──────────┘
                   │ ⑦ 数据沿 MCP 原路返回
                   ▼
        ┌─────────────────────┐
        │      大模型 LLM      │  ⑧ 拿到结果继续推理
        └──────────┬──────────┘     （回到 Host 内的 LLM）
                   │ ⑨ 整理成你想要的格式
                   ▼
        ┌─────────────────────┐
        │       你（用户）      │  ← 获得答案
        └─────────────────────┘
```

---

## 2. 三个角色（别搞混）

### 2.1 角色表（职责对照官方规范）

| 角色 | 官方定义 | 在本案例中 | 职责 |
|------|---------|-----------|------|
| **Host** | LLM 应用程序，**发起连接**的一方 | **CodeBuddy**（整个程序） | 初始化连接、启动/关闭 server 子进程（stdio 模式）、管理会话、**管理用户授权与数据访问**、整合结果 |
| **Client** | 宿主应用内的**连接器**，与某个 Server **一一对应** | **CodeBuddy 内部针对 `local-time` 的 Client** | 与 server.js 一对一通信：发请求、收响应、翻译协议（tools/list、tools/call 都是它发的） |
| **Server** | 提供上下文和能力的服务 | **`server.js`**（本项目） | 暴露 Resources/Prompts/Tools，监听 stdin、执行工具、经 stdout 返回 |

```
                        ┌───────────────────────────────────────────────┐
                        │                   HOST                        │
                        │               (CodeBuddy, AI 应用)             │
                        │                                               │
                        │   ┌─────────────┐       ┌──────────────────┐  │
                        │   │    LLM      │ 决策  │   MCP Client     │  │
                        │   │  (大模型)    │──────▶│  (协议连接器)      │  │
                        │   └─────────────┘       └────────┬─────────┘  │
                        └───────────────────────────────────┼──────────┘
                                                            │  JSON-RPC 2.0
                                                            │  (stdio / Streamable HTTP)
                                                            ▼
                                                ┌─────────────────────┐
                                                │     MCP Server      │
                                                │   (server.js)       │
                                                │  Tools/Resources/   │
                                                │  Prompts            │
                                                └──────────┬──────────┘
                                                           │  调用
                                                           ▼
                                                ┌─────────────────────┐
                                                │    外部系统          │
                                                │  (文件/DB/GitHub/API) │
                                                └─────────────────────┘
```

### 2.2 关键澄清

- **CodeBuddy 不是 Client，它是 Host。** Client 是 Host 内部的组件。
- 一个 Host（CodeBuddy）可以**同时**管理多个 Client，每个 Client 连一个 Server（比如 `local-time`、`TDesign` 各一个）。
- **stdio 模式下，Server 是 Host 启动的子进程**，运行在 Host 所在的机器上；而 Streamable HTTP 模式下，Server 是独立常驻的服务进程，不隶属于 Host（详见 4.1 传输方式）。
- 官方规范强调：**Host 负责用户授权与数据访问控制**——比如工具调用（代表任意代码执行）需先获得用户同意，这也是 CodeBuddy 里需要"Trust（信任）"连接器的原因。

---

## 3. 核心原语（Primitives）

> 先澄清一个易混淆点：`@modelcontextprotocol/sdk` 同时提供 **Server 端**（`McpServer`）和 **Client 端**（`Client`）的 API。**本仓库 `server.js` 只用到 Server 端**，用来暴露工具给 Host 调用；Client 端则是 Host（如 CodeBuddy）内部用来连 Server 的。所以当你"写一个 MCP Server"时，只需要接触 Server 端 API——协议里那句"一个 Client 对一个 Server"，Server 端只需要做好自己的本分。

MCP 围绕三类能力展开，称为 **Primitives**——Server 暴露给 LLM 的"能力入口"。

| 原语 | 作用 | 类比 | 本项目是否有 |
|------|------|------|-------------|
| **Tools（工具）** | LLM 主动调用执行操作（有副作用） | 函数调用 / Function Calling | ✅ `get_current_time` 等 4 个 |
| **Resources（资源）** | 暴露**只读**数据，供 LLM 读取上下文 | 文件、数据库查询结果 | ❌（暂无） |
| **Prompts（提示词）** | 预定义的**交互模板**，复用常见任务流程 | 代码片段 / 模板 | ❌（暂无） |

### 3.1 Tools —— 最常用

- **特点**：由 **LLM 决定是否调用**（Model-controlled）。
- **使用模式**：`tools/list`（发现）→ `tools/call`（调用）→ 返回结果。

本项目 4 个工具的定义方式（`get_current_time`、`format_time`、`time_diff`、`list_timezones`），结构一致，以 `get_current_time` 为例：

```javascript
server.tool(
  "get_current_time",                    // 工具名
  "获取当前时间。传 'local' 获取本地时间...", // 描述（LLM 靠它判断何时调用）
  { tz: z.string().optional()... },       // 参数 schema（Zod 校验）
  async ({ tz }) => { ... }               // 实际执行逻辑
);
```

### 3.2 Resources —— 只读数据

- **特点**：由 **Host 决定加载**（Host-controlled），为 LLM 补充上下文。
- **标识**：用 `URI`（如 `file:///...`、`time://now`）唯一标识。
- **使用模式**：`resources/list` → `resources/read`。

```javascript
server.resource("time-now", "time://now", async (uri) => ({
  contents: [{ uri, text: new Date().toISOString() }],
}));
```

### 3.3 Prompts —— 模板

- **特点**：由 **用户或 Host 主动触发**（User-controlled），复用复杂任务流程。
- **使用模式**：`prompts/list` → `prompts/get`。

### 3.4 三个原语的"谁控制"对比

| 原语 | 谁决定触发 | 数据方向 | 有无副作用 |
|------|-----------|---------|-----------|
| Tools | LLM | 双向（可写） | 有 |
| Resources | Host | Server → LLM（只读） | 无 |
| Prompts | 用户/Host | Host → Server（读模板） | 无 |

---

## 4. 通信协议：JSON-RPC 2.0 + Transport

MCP 的"语言"是 **JSON-RPC 2.0**。所有请求/响应都是 JSON 消息，通过 **Transport**（传输层）交换。

### 4.1 传输方式

| 传输方式 | 说明 | 适用场景 |
|---------|------|---------|
| **stdio** | 通过标准输入输出通信，Server 作为子进程启动 | 本地、单机（本项目） |
| Streamable HTTP | 通过 HTTP/SSE 通信 | 远程、跨机、Web |

stdio 的"三件套"在 Node SDK 中：

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "local-time-server", version: "1.0.4" });
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 4.2 stdin / stdout 具体是什么

stdio（标准输入输出）是**操作系统给每个进程默认配备的三个"数据管道"**：

| 管道 | 简称 | 作用 | 在 MCP 中 |
|------|------|------|-----------|
| 标准输入 | **stdin** | 程序**读入**数据 | 读 Client 发来的 JSON-RPC 请求 |
| 标准输出 | **stdout** | 程序**输出**数据 | 写出 JSON-RPC 响应 |
| 标准错误 | **stderr** | 程序**输出错误**信息 | 打印日志（不参与协议） |

在 **stdio** 传输下，**Server 是被 Host 作为"子进程"启动的**。Host 的 Client 和 Server 子进程之间，就通过这一根 stdin 和一根 stdout 连线：

```
   ┌──────────────┐                              ┌──────────────┐
   │  client 进程  │                              │ server.js 子进程│
   └──────┬───────┘                              └──────┬───────┘
          │                                            │
          │ ① 往 Server 的 stdin 写入（请求）            │
          │───────────────────────────────────────────▶│
          │    {"id":2,"method":"tools/list","params":{}}│
          │                                            │
          │                                            │ ② 处理工具逻辑
          │                                            │   （发现有哪些工具）
          │ ③ 从 Server 的 stdout 读取（响应）           │
          │◀───────────────────────────────────────────│
          │    {"id":2,"result":{"tools":[...]}}       │
          │                                            │
          ▼                                            ▼
```

- **写请求** = 往 Server 的 **stdin** 里 `write` 一个 JSON 消息。
- **读响应** = 监听 Server 的 **stdout**，按换行切分出一条条 JSON 消息。
- **每条消息**以 `jsonrpc`、`id`（请求与响应用 `id` 对应）、`method`、`result`/`error` 这些字段组成 —— 这就是 **JSON-RPC 2.0**。

> 注：JSON 本身允许跨行，但 MCP 的 stdio 实现（`StdioServerTransport`）约定**按换行符分隔消息**，即"一行一条消息"（`readline` 逐行读取），因此发送方需把每条消息序列化后放在同一行。

`StdioServerTransport` 这个类，做的正是"往 stdin 读、往 stdout 写、按行切分 JSON、用 id 匹配请求响应"这些琐事。

---

## 5. 真实报文长什么样（tools/list 与 tools/call）

以上是抽象描述，下面给出一份**本项目的真实报文**（实际运行时抓取）。MCP stdio 下，**每行 JSON = 一条消息**。

### ① 握手 initialize + initialized（官方完整握手是三步）

**① Client → Server（写往 Server 的 stdin）：**

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
  "protocolVersion":"2024-11-05","capabilities":{},
  "clientInfo":{"name":"my-app","version":"1.0.4"}
}}
```

**② Server → Client（写往 stdout）：**

```json
{"result":{
  "protocolVersion":"2024-11-05",
  "capabilities":{"tools":{"listChanged":true}},
  "serverInfo":{"name":"local-time-server","version":"1.0.4"}
},"jsonrpc":"2.0","id":1}
```

**③ Client → Server（写往 stdin，通知"初始化完成"，无响应）：**

```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

> 完整握手 = 三步：initialize 请求 → initialize 响应 → initialized 通知。**三步都完成才允许后续请求**（如 tools/list）。

### ② tools/list —— 列出有哪些工具

**请求（stdin）：**

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

**响应（stdout）——截取一个工具为例：**

```json
{"result":{"tools":[
  {
    "name": "get_current_time",
    "description": "获取当前时间。传 'local' 获取本地时间，或传 IANA 时区名...",
    "inputSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {"tz": {"type": "string", "description": "时区名称，默认 'local'"}}
    }
  }
]},"jsonrpc":"2.0","id":2}
```

> `inputSchema` 里的内容，其实就是你在 `server.tool("get_current_time", 描述, { tz: z.string()... })` 中写的**描述 + Zod schema**。SDK 会自动把它转成标准 JSON Schema 返回给 LLM。

### ③ tools/call —— 真正调用工具

**请求（stdin）：**

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
  "name": "get_current_time",
  "arguments": {"tz": "Asia/Shanghai"}
}}
```

**响应（stdout）：**

```json
{"result":{
  "content":[{"type":"text","text":"{\"datetime\":\"2026-08-06T02:21:49Z\",\"timezone\":\"Asia/Shanghai\",\"utc_offset\":\"+0800\",\"readable\":\"2026年08月06日 10:21:49\",\"unix_timestamp\":1785982909}"}]
},"jsonrpc":"2.0","id":3}
```

> `content` 正是你在回调里 `return { content: [{ type: "text", text: ... }] }` 写的东西。

### 字段对照：代码 ↔ 报文

| 你在 `server.tool()` 里写的 | 变成报文里的 |
|---------------------------|-------------|
| 工具名 `"get_current_time"` | `tools.list[].name` |
| 描述字符串 | `tools.list[].description` |
| Zod schema（tz 等参数） | `tools.list[].inputSchema`（JSON Schema） |
| 回调 `return { content:[...] }` | `tools/call` 响应的 `result.content` |

---

## 6. 关键设计思想

### 6.1 分层解耦

- **协议层**（JSON-RPC + Transport）：负责"怎么传"。
- **能力层**（Tools/Resources/Prompts）：负责"传什么"。
- **业务层**（你的函数逻辑）：负责"做什么"。

写 MCP Server，核心就是：**用协议层包裹你的业务函数**，让 LLM 能通过标准接口调用它。

### 6.2 Schema 驱动

工具的**参数 schema**（本项目用 Zod）不只是校验输入，更重要的是**告诉 LLM 每个参数的含义和格式**，LLM 才能生成正确的调用参数。描述写得好不好，直接决定 LLM 会不会用对。

### 6.3 一个 Client 对一个 Server

每个 Server 进程只服务一个 Client 连接。要服务多个应用/连接，就启动多个 Server 进程（或改用支持多会话的 HTTP Transport）。

### 6.4 错误处理要结构化

LLM 需要能**程序化判断**调用是否成功。返回结构化 JSON（而非散落的中文错误串）能让 LLM 更好地决定下一步。本项目的工具统一返回 `{"error": "..."}` 或正常的 JSON 结果。

---

## 7. 官方参考

- **MCP 规范主页（含最新版本）**：<https://modelcontextprotocol.io/specification/2024-11-05>
- **架构与角色**：<https://modelcontextprotocol.io/docs/architecture>
- **基础协议（握手/生命周期/传输）**：<https://modelcontextprotocol.io/specification/2024-11-05/basic/lifecycle>
- **服务器原语（Resources/Prompts/Tools）**：<https://modelcontextprotocol.io/specification/2024-11-05/server/>
- **工具规范（tools/list、tools/call）**：<https://modelcontextprotocol.io/specification/2024-11-05/server/tools>
- **客户端功能（Sampling）**：<https://modelcontextprotocol.io/specification/2024-11-05/client/>

> 注：MCP 仍在演进，各版本规范有差异。本文锚定 `2024-11-05` 撰写，链接也指向该版本；本项目使用的 Node SDK `@modelcontextprotocol/sdk`（1.30）在握手时会协商并实际采用更新的协议版本 `2025-06-18`。两者在本文涉及的握手流程、`tools/list`、`tools/call` 上行为一致，故不影响理解。若需对照最新规范，可将上方链接中的 `2024-11-05` 替换为 `2025-06-18`。
