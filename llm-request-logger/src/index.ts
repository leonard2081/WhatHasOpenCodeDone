// 简单的类型定义，避免依赖外部包
interface PluginInput {
  client: any
  project: any
  directory: string
  worktree: string
  serverUrl: URL
  $: any
}

interface Model {
  id: string
  providerID: string
  [key: string]: any
}

interface ProviderContext {
  source: string
  info: any
  options: Record<string, any>
}

interface UserMessage {
  content: string
  [key: string]: any
}

interface Message {
  id: string
  role: string
  [key: string]: any
}

interface Part {
  type: string
  text?: string
  [key: string]: any
}

interface ChatParamsInput {
  sessionID: string
  agent: string
  model: Model
  provider: ProviderContext
  message: UserMessage
}

interface ChatParamsOutput {
  temperature: number
  topP: number
  topK: number
  maxOutputTokens: number | undefined
  options: Record<string, any>
}

interface ChatHeadersInput {
  sessionID: string
  agent: string
  model: Model
  provider: ProviderContext
  message: UserMessage
}

interface ChatHeadersOutput {
  headers: Record<string, string>
}

interface ChatMessagesTransformInput {}

interface ChatMessagesTransformOutput {
  messages: Array<{
    info: Message
    parts: Part[]
  }>
}

interface ChatSystemTransformInput {
  sessionID?: string
  model: Model
}

interface ChatSystemTransformOutput {
  system: string[]
}

interface Hooks {
  "chat.params"?: (input: ChatParamsInput, output: ChatParamsOutput) => Promise<void>
  "chat.headers"?: (input: ChatHeadersInput, output: ChatHeadersOutput) => Promise<void>
  "experimental.chat.messages.transform"?: (input: ChatMessagesTransformInput, output: ChatMessagesTransformOutput) => Promise<void>
  "experimental.chat.system.transform"?: (input: ChatSystemTransformInput, output: ChatSystemTransformOutput) => Promise<void>
}

type Plugin = (input: PluginInput) => Promise<Hooks>

// ==================== 配置 ====================
const LOG_FILE = "llm-requests.log"
const SSE_PORT = 8899
const SSE_PATH = "/sse"

// ==================== 日志功能 ====================
function getTimestamp(): string {
  return new Date().toISOString()
}

function formatLog(level: string, message: string, data?: any): string {
  const timestamp = getTimestamp()
  let log = `[${timestamp}] [${level}] ${message}`
  if (data !== undefined) {
    log += "\n" + JSON.stringify(data, null, 2)
  }
  return log + "\n"
}

async function appendLog(message: string): Promise<void> {
  try {
    const fs = await import("fs/promises")
    await fs.appendFile(LOG_FILE, message)
  } catch (e) {
    console.log(message)
  }
}

// ==================== SSE 服务器 ====================
interface PendingResponse {
  controller: any
}

const pendingSSE: PendingResponse[] = []
let sseAborted = false

async function startSSEServer(): Promise<void> {
  // 使用 Bun 全局对象
  const server = (Bun as any).serve({
    port: SSE_PORT,
    fetch(req: Request, server: any) {
      const url = new URL(req.url)
      
      // SSE 端点
      if (url.pathname === SSE_PATH) {
        sseAborted = false
        
        const stream = new ReadableStream({
          start(controller: any) {
            pendingSSE.push({ controller })
            
            // 发送连接成功消息
            const encoder = new TextEncoder()
            const connectMsg = `data: ${JSON.stringify({ type: "connected", message: "SSE connected" })}\n\n`
            controller.enqueue(encoder.encode(connectMsg))
            
            // 客户端断开时移除
            req.signal.addEventListener("abort", () => {
              sseAborted = true
              const idx = pendingSSE.findIndex(p => p.controller === controller)
              if (idx >= 0) pendingSSE.splice(idx, 1)
            })
          },
          cancel() {
            sseAborted = true
          }
        })
        
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          }
        })
      }
      
      // 健康检查端点
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok", clients: pendingSSE.length }), {
          headers: { "Content-Type": "application/json" }
        })
      }
      
      return new Response("Not Found", { status: 404 })
    }
  })
  
  console.log(`[LLM-Logger] SSE server started on http://localhost:${SSE_PORT}${SSE_PATH}`)
  console.log(`[LLM-Logger] Health check: http://localhost:${SSE_PORT}/health`)
}

// 广播消息给所有连接的客户端
function broadcast(eventType: string, data: any): void {
  // 始终打印日志，方便调试
  console.log(`[LLM-Logger] Broadcasting: ${eventType}, clients: ${pendingSSE.length}, aborted: ${sseAborted}`)
  
  // 即使没有客户端连接，也尝试发送（可能是刚断开或即将连接）
  if (sseAborted) return
  
  if (pendingSSE.length === 0) {
    // 没有客户端时打印到控制台，供调试
    console.log(`[LLM-Logger] No SSE clients for event: ${eventType}`)
    // 不 return，继续尝试发送
  }
  
  const encoder = new TextEncoder()
  const message = {
    type: eventType,
    timestamp: getTimestamp(),
    data: data
  }
  const sseData = `data: ${JSON.stringify(message)}\n\n`
  const encoded = encoder.encode(sseData)
  
  // 发送给所有客户端，清理断开的
  const validClients: PendingResponse[] = []
  for (const client of pendingSSE) {
    try {
      client.controller.enqueue(encoded)
      validClients.push(client)
    } catch (e) {
      // 客户端已断开，忽略
    }
  }
  pendingSSE.length = 0
  pendingSSE.push(...validClients)
}

// ==================== 插件主逻辑 ====================
export const LLMRequestLoggerPlugin: Plugin = async (_input: PluginInput): Promise<Hooks> => {
  
  // 启动 SSE 服务器
  await startSSEServer()
  
  return {
    "chat.params": async (ctx, output) => {
      console.log(`[LLM-Logger] chat.params triggered: agent=${ctx.agent}, model=${ctx.model?.id}`)
      
      const logMessage = formatLog("INFO", "=== LLM Request (chat.params) ===", {
        sessionID: ctx.sessionID,
        agent: ctx.agent,
        model: {
          id: ctx.model?.id,
          providerID: ctx.model?.providerID,
        },
        provider: {
          id: ctx.provider?.info?.id,
          source: ctx.provider?.source,
        },
        userMessage: ctx.message?.content,
        params: {
          temperature: output.temperature,
          topP: output.topP,
          topK: output.topK,
          maxOutputTokens: output.maxOutputTokens,
          options: output.options,
        },
      })
      await appendLog(logMessage)
      
      // SSE 广播
      broadcast("llm.params", {
        sessionID: ctx.sessionID,
        agent: ctx.agent,
        model: ctx.model?.id,
        userMessage: ctx.message?.content
      })
    },

    "chat.headers": async (ctx, output) => {
      console.log(`[LLM-Logger] chat.headers triggered: agent=${ctx.agent}`)
      
      const logMessage = formatLog("INFO", "=== LLM Request (chat.headers) ===", {
        sessionID: ctx.sessionID,
        agent: ctx.agent,
        model: ctx.model?.id,
        headers: output.headers,
      })
      await appendLog(logMessage)
      
      // SSE 广播
      broadcast("llm.headers", {
        sessionID: ctx.sessionID,
        headers: output.headers
      })
    },

    "experimental.chat.messages.transform": async (_ctx, output) => {
      console.log(`[LLM-Logger] chat.messages.transform triggered: ${output.messages.length} messages`)
      
      const messagesSummary = output.messages.map((msg) => ({
        role: msg.info.role,
        contentLength: msg.parts.reduce((acc, p) => {
          if (p.type === "text") return acc + (p.text?.length || 0)
          return acc
        }, 0),
        parts: msg.parts.map((p) => ({
          type: p.type,
          content: p.type === "text" ? p.text : undefined,
        })),
      }))

      const logMessage = formatLog("INFO", "=== LLM Messages (transform) ===", {
        messageCount: messagesSummary.length,
        messages: messagesSummary,
      })
      await appendLog(logMessage)
      
      // SSE 广播 - 不截断
      broadcast("llm.messages", {
        messageCount: messagesSummary.length,
        messages: messagesSummary
      })
    },

    "experimental.chat.system.transform": async (_ctx, output) => {
      console.log(`[LLM-Logger] chat.system.transform triggered`)
      
      const logMessage = formatLog("INFO", "=== LLM System Prompt ===", {
        system: output.system,
      })
      await appendLog(logMessage)
      
      // SSE 广播 - 不截断
      broadcast("llm.system", {
        system: output.system
      })
    },
  }
}