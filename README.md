# OpenCode Interaction Recording

This document explains how to combine the llm-request-logger plugin with the openCodeWeb project to achieve complete interaction recording.

## 1. System Architecture

```
                          OpenCode Agent
    Human Message ──────>                       <────── LLM Response
                         │                           │
                         ▼                           ▼
              ┌─────────────────┐       ┌─────────────────┐
              │   OpenCode      │       │  llm-request    │
              │   SSE :4096     │       │  -logger        │
              │   /event        │       │  SSE :8899      │
              └────────┬────────┘       └────────┬────────┘
                       │                         │
                       │         ┌───────────────┘
                       │         │
                       ▼         ▼
              ┌─────────────────────┐
              │   openCodeWeb      │
              │   (index.html)     │
              └─────────────────────┘
```

## 2. Data Flow Analysis

### 2.1 Interaction Types and Data Sources

| Interaction | Description | Data Source | Port |
|------------|-------------|-------------|------|
| Human -> Agent | User sends message | OpenCode SSE /event | 4096 |
| Agent -> LLM | Request to LLM | llm-request-logger SSE /sse | 8899 |
| LLM -> Agent | LLM response | OpenCode SSE /event | 4096 |
| Agent -> Tool | Tool call | OpenCode SSE /event | 4096 |
| Tool -> Agent | Tool result | OpenCode SSE /event | 4096 |

### 2.2 Event Mapping

#### Human -> Agent
- **Data Source**: OpenCode SSE (http://127.0.0.1:4096/event)
- **Event**: message.updated

#### Agent -> LLM
- **Data Source**: llm-request-logger SSE (http://127.0.0.1:8899/sse)
- **Events**: llm.params, llm.headers, llm.messages, llm.system

#### LLM -> Agent
- **Data Source**: OpenCode SSE (http://127.0.0.1:4096/event)
- **Events**: message.part.delta, message.part.updated

#### Agent -> Tool
- **Data Source**: OpenCode SSE (http://127.0.0.1:4096/event)
- **Event**: message.part.updated (type: tool)

#### Tool -> Agent
- **Data Source**: OpenCode SSE (http://127.0.0.1:4096/event)
- **Event**: message.part.updated (type: tool-result)

## 3. Configuration

### 3.1 opencode.json Configuration

```json
{
  "mcp": {
    "ue-insight-trace": {
      "type": "local",
      "command": ["C:\\Python314\\python.exe", "-m", "ue_mcp_server.server"],
      "cwd": "C:\\Work\\Repo\\GUSD\\UE_553\\MCP\\ue_mcp_server",
      "enabled": true,
      "timeout": 10000,
      "environment": {
        "UE_INSIGHTS_BACKEND_URL": "http://127.0.0.1:7777/query"
      }
    }
  },
  "plugin": [
    "C:\\Work\\Demo\\AI\\OpenCode\\llm-request-logger"
  ]
}
```

### 3.2 Running the Demo

1. Start OpenCode with the plugin configured
2. Start the server.py proxy in openCodeWeb directory:
   ```bash
   python server.py
   ```
3. Open index.html in a browser
4. The SSE demo page will connect to both SSE endpoints and display all interactions

## 4. Log Files

- **llm-requests.log**: Contains detailed LLM request logs from llm-request-logger
  - chat.params: Model parameters
  - chat.headers: HTTP headers
  - chat.messages: Messages sent to LLM
  - chat.system: System prompt

## 5. Complete Interaction Flow

```
Human              Agent              LLM               Tool
  │                  │                  │                 │
  │ POST /message   │                  │                 │
  │ ──────────────> │                  │                 │
  │                  │                  │                 │
  │ (SSE: message.updated)            │                 │
  │ <────────────── │                  │                 │
  │                  │                  │                 │
  │                  │  (llm.params)    │                 │
  │                  │  (llm.headers)   │                 │
  │                  │  (llm.messages)  │                 │
  │                  │  (llm.system)    │                 │
  │                  │ ────────────────> │                 │
  │                  │                  │                 │
  │                  │  (SSE: message.part.delta)         │
  │                  │ <────────────── │                 │
  │                  │                  │                 │
  │                  │ (SSE: message.part.updated type=tool)│
  │                  │ ────────────────────────────────>   │
  │                  │                  │                 │
  │                  │                  │ (SSE: message.part.updated type=tool-result)
  │                  │ <────────────────────────────────   │
  │                  │                  │                 │
  │ (SSE: message.part.updated type=text reason=stop)      │
  │ <────────────── │                  │                 │
  │                  │                  │                 │
```
