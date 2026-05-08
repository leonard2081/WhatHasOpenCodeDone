# What Has OpenCode Done

<p align="center">
  <b>Complete interaction recording and visualization for OpenCode AI agent</b><br>
  Capture every human→agent, agent→LLM, LLM→agent, and agent→tool exchange in real time.
</p>

---

## Features

- **Full Interaction Tracing** — Records all four interaction types: Human ↔ Agent, Agent ↔ LLM, Agent ↔ Tool
- **LLM Request Interception** — Hooks into OpenCode's plugin system to capture params, headers, messages, and system prompts
- **Real-Time SSE Streaming** — Dual SSE endpoints serve live event streams to any frontend
- **Web Dashboard** — Brower-based UI to visualize interactions, send prompts, create sessions, and inspect LLM requests
- **Local Logging** — All LLM requests are persisted to `llm-requests.log` for offline analysis
- **Zero Config Web** — The web dashboard is a single HTML file served by a lightweight Python proxy server

## Architecture

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
               │   OpenCodeWeb       │
               │   (index.html)      │
               └─────────────────────┘
```

### Data Flow

| Interaction | Description | Data Source | Port |
|------------|-------------|-------------|------|
| Human → Agent | User sends message | OpenCode SSE `/event` | 4096 |
| Agent → LLM | Request to LLM | llm-request-logger SSE `/sse` | 8899 |
| LLM → Agent | LLM response (streaming) | OpenCode SSE `/event` | 4096 |
| Agent → Tool | Tool invocation | OpenCode SSE `/event` | 4096 |
| Tool → Agent | Tool result | OpenCode SSE `/event` | 4096 |

### SSE Events

Detailed event documentation is available in [SSE_EVENTS.md](./SSE_EVENTS.md).

---

## Prerequisites

- [OpenCode](https://github.com/anomalyco/opencode) (the AI agent)
- [Bun](https://bun.sh) ≥ 1.3 (for building the plugin)
- Python ≥ 3.8 (for the web proxy server)

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/<your-username>/WhatHasOpenCodeDone.git
cd WhatHasOpenCodeDone
```

### 2. Install & Build the Plugin

The `llm-request-logger` plugin intercepts every LLM request made by OpenCode and streams the details via SSE.

```bash
cd llm-request-logger
bun install
bun run build
```

This compiles `src/index.ts` → `dist/index.js`.

### 3. Configure OpenCode to Load the Plugin

Add the plugin path to your `opencode.json` (located at `~/.config/opencode/opencode.json`):

```json
{
  "plugin": [
    "/absolute/path/to/WhatHasOpenCodeDone/llm-request-logger"
  ]
}
```

Replace the path with the actual absolute path on your machine.

> **Note:** If you already have other entries in `opencode.json` (e.g., MCP servers), add the plugin entry alongside them.

### 4. Start the OpenCodeWeb Proxy

The web dashboard needs a local server to proxy SSE streams and forward API requests.

```bash
cd OpenCodeWeb
python server.py
```

The server starts at `http://127.0.0.1:8888`.

### 5. Open the Web Dashboard

Navigate to **http://127.0.0.1:8888** in your browser. The dashboard will:

- Connect to OpenCode's native SSE at `http://127.0.0.1:4096/event`
- Connect to the plugin's SSE at `http://127.0.0.1:8899/sse`
- Display all interactions in real time

---

## How It Works

### llm-request-logger Plugin

The plugin hooks into four OpenCode extension points:

| Hook | Fires when | SSE Event |
|------|-----------|-----------|
| `chat.params` | Model parameters are set | `llm.params` |
| `chat.headers` | HTTP headers are assembled | `llm.headers` |
| `experimental.chat.messages.transform` | Messages are about to be sent | `llm.messages` |
| `experimental.chat.system.transform` | System prompt is prepared | `llm.system` |

Each hook writes a log entry to `llm-requests.log` and broadcasts the data to all connected SSE clients.

**SSE Endpoints exposed by the plugin:**

| Endpoint | Description |
|----------|-------------|
| `http://127.0.0.1:8899/sse` | Server-Sent Events stream |
| `http://127.0.0.1:8899/health` | Health check (returns connected client count) |

### OpenCodeWeb Proxy Server

The Python server (`server.py`) acts as a bridge:

- **`GET /`** — Serves `index.html` (the dashboard)
- **`GET /api/proxy-sse?url=...`** — Proxies SSE streams from OpenCode/plugin to the browser, bypassing CORS
- **`POST /api/send-prompt`** — Forwards user prompts to OpenCode's HTTP API
- **`POST /api/create-session`** — Creates new OpenCode sessions

### Web Dashboard

The single-page dashboard (`index.html`) displays:

- **Live connection status** for both SSE streams
- **Real-time event log** of all interactions
- **Session management** — create sessions and send prompts
- **LLM request inspector** — view system prompts, messages, and parameters

---

## Configuration Reference

### opencode.json

```json
{
  "plugin": [
    "/path/to/llm-request-logger"
  ]
}
```

### Example with MCP Server

```json
{
  "mcp": {
    "ue-insight-trace": {
      "type": "local",
      "command": ["python", "-m", "ue_mcp_server.server"],
      "cwd": "/path/to/ue_mcp_server",
      "enabled": true
    }
  },
  "plugin": [
    "/path/to/llm-request-logger"
  ]
}
```

---

## Project Structure

```
WhatHasOpenCodeDone/
├── llm-request-logger/      # OpenCode plugin (Bun + TypeScript)
│   ├── src/
│   │   └── index.ts         # Plugin entry point
│   ├── package.json
│   └── tsconfig.json
├── OpenCodeWeb/              # Web dashboard
│   ├── index.html            # Single-page dashboard
│   └── server.py             # Python proxy server
├── SSE_EVENTS.md             # Complete SSE event reference
└── README.md
```

---

## Log Files

The plugin writes to `llm-requests.log` in the directory where OpenCode is run:

- `chat.params` — Model ID, provider, temperature, topP, topK, etc.
- `chat.headers` — HTTP headers sent to the LLM provider
- `chat.messages` — Full message history (roles, content lengths, parts)
- `chat.system` — System prompt content

---

## Complete Interaction Flow

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

---

## License

MIT
