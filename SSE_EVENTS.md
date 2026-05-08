# OpenCode SSE 事件文档

本文档列出了 Agent 与大模型、工具、人类之间交互所需的 SSE 事件、HTTP 请求和响应。

---

## 一、基础信息

### SSE 端点

| 端点 | 描述 |
|------|------|
| `http://127.0.0.1:4096/event` | 系统 SSE 事件 (OpenCode Web 页面使用此端点) |
| `http://127.0.0.1:8899/sse` | LLM SSE 事件 (插件提供) |

### 认证方式

```http
Authorization: Basic base64("opencode:密码")
```

### OpenCode Web 页面

当使用 `opencode dev` 或 `opencode serve` 启动服务时，会自动打开一个 Web UI 界面。

这个界面是 **TUI (Terminal UI) 的 Web 版本**，使用 SolidJS 编写，源码位于：

```
packages/opencode/src/cli/cmd/tui/
```

**核心文件：**
- `context/sdk.tsx` - SSE 连接管理
- `app.tsx` - 主应用组件
- `routes/session/index.tsx` - 会话页面

**连接方式：**

```typescript
// sdk.tsx:71-88
async function startSSE() {
  const events = await sdk.global.event({ signal: ctrl.signal })
  for await (const event of events.stream) {
    handleEvent(event)  // 处理事件
  }
}
```

**事件流转：**

```
OpenCode 服务端 (Bus)
      ↓ (所有事件)
SSE /event 端点
      ↓
Web UI 的 SDK
      ↓ (emit)
SolidJS 组件更新 UI
```

> OpenCode Web 页面只连接系统 SSE (`/event`)，不直接连接插件的 LLM SSE。LLM 请求信息需要通过插件或其他方式获取。

---

## 二、交互类型与对应事件

### 1. 人类 → Agent 请求/响应

人类发送消息给 Agent，Agent 返回响应。

#### 事件来源：OpenCode 原生 SSE (`/event`)

#### SSE 事件列表

| 事件类型 | 说明 | 请求参数 | 响应体 |
|---------|------|---------|--------|
| `server.connected` | 连接成功 | - | `{ "type": "server.connected", "properties": {} }` |
| `message.updated` | 用户消息发送 | sessionID, messageID | 包含消息内容、角色 |
| `message.part.updated` | 消息部分更新 | sessionID, part | 包含 text, tool, reasoning 等 |
| `message.part.delta` | 流式输出片段 | sessionID, partID, delta | LLM 输出的增量内容 |
| `session.status` | 会话状态 | sessionID, status: idle/busy | - |

#### HTTP 请求

```http
POST http://127.0.0.1:4096/session/{sessionId}/message
Content-Type: application/json

{
  "parts": [
    { "type": "text", "text": "用户消息内容" }
  ]
}
```

#### 响应体

```json
{
  "id": "msg_xxx",
  "sessionID": "ses_xxx",
  "info": {
    "role": "user",
    "content": "用户消息内容"
  },
  "parts": [...]
}
```

#### Agent 返回给人类的响应

**事件类型：** `message.part.updated` 和 `message.part.delta`

**响应结构：**

| 事件类型 | 说明 | 响应体 |
|---------|------|--------|
| `message.part.delta` | 响应流式输出片段 | `{ delta: "输出的增量内容" }` |
| `message.part.updated` | 响应完成 | `{ part: { type: "text", text: "完整响应", reason: "stop" } }` |
| `message.part.updated` | 带思考过程 | `{ part: { type: "reasoning", text: "思考过程" } }` |

**响应事件详情：**

**1. 流式输出片段 (message.part.delta):**

```json
{
  "type": "message.part.delta",
  "properties": {
    "sessionID": "ses_xxx",
    "messageID": "msg_xxx",
    "partID": "prt_xxx",
    "field": "text",
    "delta": "你好！我是基于"
  }
}
```

**2. 响应完成 (message.part.updated):**

```json
{
  "type": "message.part.updated",
  "properties": {
    "sessionID": "ses_xxx",
    "part": {
      "id": "prt_xxx",
      "type": "text",
      "text": "你好！我是基于你本地的 `ollama/qwen3-coder:30b-32k-i` 模型运行的。有什么我可以帮你的吗？",
      "reason": "stop"
    }
  }
}
```

**3. 思考过程 (message.part.updated):**

```json
{
  "type": "message.part.updated",
  "properties": {
    "sessionID": "ses_xxx",
    "part": {
      "id": "prt_xxx",
      "type": "reasoning",
      "text": "用户在打招呼，我应该友好地回应并介绍自己的能力"
    }
  }
}
```

#### Agent 响应的拼接方法

**步骤 1：收集流式片段**

监听 `message.part.delta`，累积 `delta`：

```javascript
let agentResponse = ""

eventSource.addEventListener("message.part.delta", (e) => {
  const data = JSON.parse(e.data)
  agentResponse += data.properties.delta
})
```

**步骤 2：获取完整响应**

当收到 `message.part.updated` 且 `reason: "stop"` 时：

```javascript
eventSource.addEventListener("message.part.updated", (e) => {
  const data = JSON.parse(e.data)
  const part = data.properties.part
  
  if (part.type === "text" && part.reason === "stop") {
    // Agent 完整响应
    console.log("Agent 响应:", part.text)
  }
  
  if (part.type === "reasoning") {
    // 思考过程
    console.log("思考:", part.text)
  }
})
```

**完整响应结构：**

```javascript
const finalResponse = {
  text: "Agent 最终响应给人类的内容",
  reasoning: "思考过程（如果有）",
  toolCalls: ["工具调用列表（如果有）"]
}

// 示例
{
  "text": "你好！我是基于你本地的 `ollama/qwen3-coder:30b-32k-i` 模型运行的。有什么我可以帮你的吗？",
  "reasoning": "用户在打招呼，我应该友好地回应",
  "toolCalls": null
}
```

**重要：** Agent 给人类的响应和 Agent 与大模型的响应是**同一个事件流**，都是通过 `message.part.delta` 和 `message.part.updated` 事件获取。

---

### 2. Agent → 大模型 请求/响应

Agent 与 LLM 之间的交互。

#### 事件来源

| 交互 | 事件来源 |
|------|----------|
| 请求 | 插件 SSE (`http://127.0.0.1:8899/sse`) |
| 响应 | OpenCode 原生 SSE (`http://127.0.0.1:4096/event`) |

#### SSE 事件列表

| 事件类型 | 说明 | 数据结构 |
|---------|------|----------|
| `llm.system` | System Prompt | `{ type, timestamp, data: { system: [...] } }` |
| `llm.messages` | 完整消息列表 | `{ type, timestamp, data: { messageCount, messages: [...] } }` |
| `llm.params` | 模型参数 | `{ type, timestamp, data: { sessionID, agent, model, userMessage } }` |
| `llm.headers` | HTTP 头 | `{ type, timestamp, data: { sessionID, headers } }` |

#### 详细数据结构

**llm.system 事件:**
```json
{
  "type": "llm.system",
  "timestamp": "2026-04-16T12:08:46.014Z",
  "data": {
    "system": [
      "You are opencode, an interactive CLI tool...",
      "Additional system prompt..."
    ]
  }
}
```

**llm.messages 事件:**
```json
{
  "type": "llm.messages",
  "timestamp": "2026-04-16T12:08:46.005Z",
  "data": {
    "messageCount": 5,
    "messages": [
      {
        "role": "user",
        "contentLength": 5856,
        "parts": [
          { "type": "text", "content": "<EXTREMELY_IMPORTANT>..." },
          { "type": "text", "content": "用户实际消息" }
        ]
      },
      {
        "role": "assistant",
        "contentLength": 168,
        "parts": [
          { "type": "text", "content": "Agent 响应内容" }
        ]
      }
    ]
  }
}
```

**llm.params 事件:**
```json
{
  "type": "llm.params",
  "timestamp": "2026-04-16T12:08:46.015Z",
  "data": {
    "sessionID": "ses_xxx",
    "agent": "build",
    "model": "qwen3-coder:30b-32k-i",
    "userMessage": "用户消息内容"
  }
}
```

#### 发送给大模型的完整请求（拼接方式）

**拼接公式：**

```
LLM 请求 = llm.system[0] + 转换后的 messages
```

**步骤 1：System Prompt**

从 `llm.system` 事件中取 `system[0]`，作为 system 消息：

```json
{ "role": "system", "content": "llm.system[0]" }
```

**步骤 2：转换 Messages**

从 `llm.messages` 事件中遍历 `messages` 数组，将每条消息转换为：

| 原 role | 转换后 role |
|---------|------------|
| `user` | `user` |
| `assistant` | `assistant` |

从 `parts` 数组中提取内容：
- `type: "text"` → 内容为 `part.content`
- `type: "tool"` → 跳过（工具调用在下一轮）
- `type: "reasoning"` → 内容为 `part.content`

**完整示例：**

```javascript
// 输入来自 SSE 事件
const systemPrompt = llmSystemEvent.data.system[0]  // "You are opencode..."
const messages = llmMessagesEvent.data.messages

// 拼接成 LLM 请求
const llmRequest = {
  messages: [
    { role: "system", content: systemPrompt },
    ...messages.map(msg => {
      const textContent = msg.parts
        .filter(p => p.type === "text")
        .map(p => p.content)
        .join("\n")
      return { role: msg.role, content: textContent }
    })
  ]
}
```

**最终发送给大模型的 JSON：**

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are opencode, an interactive CLI tool that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.\n\nIMPORTANT: You must NEVER generate..."
    },
    {
      "role": "user",
      "content": "<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n**IMPORTANT: The using-superpowers skill content is included below. It is ALREADY LOADED - you are currently following it. Do NOT use the Skill tool to load \\"using-superpowers\\" again - that would be redundant.**\n\n...\nhi"
    },
    {
      "role": "assistant",
      "content": "你好！我是基于你本地的 `ollama/qwen3-coder:30b-32k-i` 模型运行的。有什么我可以帮你的吗？"
    },
    {
      "role": "user",
      "content": "太棒了，你能做什么"
    }
  ],
  "model": "qwen3-coder:30b-32k-i"
}
```

**请求发送方式：**

```javascript
// 实际发送给大模型的 API（由 OpenCode 服务端处理）
// 不通过 SSE，客户端只需解析 SSE 事件来了解请求内容
```

> 注意：LLM 请求的实际发送由 OpenCode 服务端完成，客户端通过监听 SSE 事件来获取请求的完整内容用于展示。

#### 大模型响应（流式输出）

**事件来源：** OpenCode 原生 SSE (`http://127.0.0.1:4096/event`)

**SSE 事件列表：**

| 事件类型 | 说明 | 响应体 |
|---------|------|--------|
| `message.part.delta` | 流式输出片段 | `{ delta: "输出片段" }` |
| `message.part.updated` | 输出完成 | `{ part: { type: "text", text: "完整内容", reason: "stop" } }` |
| `message.part.updated` | 决定使用工具 | `{ part: { type: "text", text: "我将使用工具...", reason: "tool_use" } }` |

#### 响应数据结构

**1. 流式片段 (message.part.delta):**

```json
{
  "type": "message.part.delta",
  "properties": {
    "sessionID": "ses_xxx",
    "messageID": "msg_xxx",
    "partID": "prt_xxx",
    "field": "text",
    "delta": "你好！我是基于"
  }
}
```

**2. 输出完成 (message.part.updated):**

```json
{
  "type": "message.part.updated",
  "properties": {
    "sessionID": "ses_xxx",
    "part": {
      "id": "prt_xxx",
      "type": "text",
      "text": "你好！我是基于你本地的 `ollama/qwen3-coder:30b-32k-i` 模型运行的。有什么我可以帮你的吗？",
      "reason": "stop"
    }
  }
}
```

**3. 决定使用工具 (message.part.updated):**

```json
{
  "type": "message.part.updated",
  "properties": {
    "sessionID": "ses_xxx",
    "part": {
      "id": "prt_xxx",
      "type": "text",
      "text": "我将使用 glob 工具来查找 JSON 文件",
      "reason": "tool_use"
    }
  }
}
```

#### 大模型响应的拼接方法

**步骤 1：收集流式片段**

监听 `message.part.delta` 事件，累积 `delta` 字段：

```javascript
let fullResponse = ""

eventSource.addEventListener("message.part.delta", (e) => {
  const data = JSON.parse(e.data)
  fullResponse += data.properties.delta  // 累加每个片段
})
```

**步骤 2：获取完整响应**

当收到 `message.part.updated` 且 `reason: "stop"` 时，完整响应已生成：

```javascript
eventSource.addEventListener("message.part.updated", (e) => {
  const data = JSON.parse(e.data)
  const part = data.properties.part
  
  if (part.type === "text" && part.reason === "stop") {
    // 完整响应
    const completeResponse = part.text
    console.log("完整响应:", completeResponse)
  }
  
  if (part.type === "text" && part.reason === "tool_use") {
    // LLM 决定使用工具
    const toolDecision = part.text
    console.log("决定使用工具:", toolDecision)
  }
})
```

**完整响应结构：**

```javascript
// 最终拼接的响应
const llmResponse = {
  content: "完整响应内容",
  reasoning: "思考过程（如果有）",
  toolUse: "是否决定使用工具"
}

// 响应内容示例
{
  "content": "你好！我是基于你本地的 `ollama/qwen3-coder:30b-32k-i` 模型运行的。有什么我可以帮你的吗？",
  "reasoning": "用户发送了问候，我应该友好地回应并询问有什么可以帮助的",
  "toolUse": null  // 或 "我将使用 glob 工具查找文件"
}
```

---

### 3. Agent → 工具 请求/响应

Agent 调用工具（Tool Use）。

#### 事件来源：OpenCode 原生 SSE (`/event`)

#### SSE 事件列表

| 事件类型 | 说明 | 响应体 |
|---------|------|--------|
| `message.part.updated` | 工具调用请求 | `part.type: "tool", part.tool: "glob", part.input: {...}` |
| `message.part.updated` | 工具调用完成 | `part.type: "tool", part.state.status: "completed", part.state.output: "..."` |

#### 工具调用请求事件详情

```json
{
  "type": "message.part.updated",
  "properties": {
    "sessionID": "ses_xxx",
    "part": {
      "id": "prt_xxx",
      "type": "tool",
      "tool": "glob",
      "callID": "call_xxx",
      "input": {
        "pattern": "**/*.json"
      }
    }
  }
}
```

#### 工具结果返回事件详情

```json
{
  "type": "message.part.updated",
  "properties": {
    "sessionID": "ses_xxx",
    "part": {
      "type": "tool-result",
      "tool": "glob",
      "callID": "call_xxx",
      "content": "file1.json\nfile2.json"
    }
  }
}
```

---

## 三、权限确认（补充）

#### 事件来源：OpenCode 原生 SSE (`/event`)

| 事件类型 | 说明 | 响应体 |
|---------|------|--------|
| `permission.asked` | 需要权限确认 | `{ sessionID, tool, args, patterns }` |
| `permission.replied` | 用户回复 | `{ sessionID, requestID, reply: "allow"/"reject" }` |

#### 权限确认 API

```http
POST http://127.0.0.1:4096/session/{sessionId}/permission
Content-Type: application/json

{
  "requestID": "xxx",
  "reply": "allow" | "reject",
  "message": "可选的反馈信息"
}
```

---

## 四、事件时序图

```
人类              Agent              大模型              工具
  │                  │                  │                  │
  │ POST /message   │                  │                  │
  │ ──────────────> │                  │                  │
  │                  │                  │                  │
  │ (SSE: message.updated)              │                  │
  │ <────────────── │                  │                  │
  │                  │                  │                  │
  │                  │  (llm.system)    │                  │
  │                  │ ────────────────> │                  │
  │                  │  (llm.messages)  │                  │
  │                  │ ────────────────> │                  │
  │                  │                  │                  │
  │                  │  (SSE: message.part.delta)          │
  │                  │ <────────────── │                  │
  │                  │                  │                  │
  │                  │ (SSE: message.part.updated type=tool)│
  │                  │ ────────────────────────────────>   │
  │                  │                  │                  │
  │                  │                  │ (SSE: message.part.updated type=tool-result)
  │                  │ <────────────────────────────────   │
  │                  │                  │                  │
  │ (SSE: message.part.updated type=text reason=stop)      │
  │ <────────────── │                  │                  │
  │                  │                  │                  │
```

---

## 五、连接示例代码

### OpenCode 原生 SSE (端口 4096)

```javascript
const eventSource = new EventSource("http://127.0.0.1:4096/event")

// 监听所有事件
eventSource.onmessage = (e) => {
  const event = JSON.parse(e.data)
  console.log(event.type, event.properties)
}

// 监听特定事件
eventSource.addEventListener("message.part.updated", (e) => {
  const data = JSON.parse(e.data)
  console.log("消息更新:", data.properties)
})
```

### 插件 SSE (端口 8899)

```javascript
const eventSource = new EventSource("http://127.0.0.1:8899/sse")

eventSource.onmessage = (e) => {
  const event = JSON.parse(e.data)
  console.log(event.type, event.data)
}
```