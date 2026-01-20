# Next AI Draw.io MCP Server

MCP (Model Context Protocol) server that enables AI agents to generate and edit draw.io diagrams with **SVG export support**.

**Features:**
- Multiple diagrams per session
- SVG/drawio.svg/drawio export formats
- Streamable HTTP transport for server deployment
- Puppeteer-based SVG rendering

## Quick Start (HTTP Server Mode)

```bash
# Install and run
npx @next-ai-drawio/mcp-server@latest

# Server starts at http://localhost:6002
# MCP endpoint: http://localhost:6002/mcp
```

## Installation

### Server Deployment (Pod/Container)

```bash
npm install @next-ai-drawio/mcp-server
```

```javascript
// Start the server
import "@next-ai-drawio/mcp-server"
```

Or use npx:
```bash
npx @next-ai-drawio/mcp-server
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `6002` | HTTP server port |
| `DRAWIO_BASE_URL` | `https://embed.diagrams.net` | draw.io embed URL for SVG rendering |
| `EXPORTS_DIR` | `/tmp/mcp-drawio-exports` | Directory for exported files |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | GET/POST | MCP Streamable HTTP transport |
| `/exports/{session_id}/{filename}` | GET | Serve exported files |
| `/health` | GET | Health check |
| `/` | GET | Server info |

## MCP Tools

### Session Management

| Tool | Description |
|------|-------------|
| `start_session` | Create a new session, returns `session_id` |
| `end_session` | End a session and cleanup |

### Diagram Operations

| Tool | Description |
|------|-------------|
| `create_diagram` | Create a new diagram from mxGraphModel XML |
| `edit_diagram` | Edit diagram with add/update/delete operations |
| `get_diagram` | Get current diagram XML |
| `list_diagrams` | List all diagrams in a session |
| `delete_diagram` | Delete a diagram |

### Export

| Tool | Description |
|------|-------------|
| `export_diagram` | Export diagram to svg/drawio_svg/drawio format |

**Export Options:**
- `format`: `"svg"` | `"drawio_svg"` | `"drawio"`
  - `svg`: Standard SVG for display
  - `drawio_svg`: SVG with embedded diagram data (re-editable)
  - `drawio`: Original XML format
- `output`: `"content"` | `"url"`
  - `content`: Returns file content directly
  - `url`: Saves file and returns URL

## Usage Example

```typescript
// 1. Start session
const session = await mcp.call("start_session")
// Returns: { session_id: "session-xxx" }

// 2. Create diagram
const diagram = await mcp.call("create_diagram", {
  session_id: session.session_id,
  xml: `<mxGraphModel>
    <root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
      <mxCell id="2" value="Hello" style="rounded=1;" vertex="1" parent="1">
        <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
      </mxCell>
    </root>
  </mxGraphModel>`
})
// Returns: { diagram_id: "diagram-xxx" }

// 3. Export as SVG
const exported = await mcp.call("export_diagram", {
  session_id: session.session_id,
  diagram_id: diagram.diagram_id,
  format: "svg",
  output: "url"
})
// Returns: { url: "http://localhost:6002/exports/session-xxx/diagram-xxx.svg" }

// 4. End session
await mcp.call("end_session", { session_id: session.session_id })
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    MCP HTTP Server                      │
│                     (Port 6002)                         │
├─────────────────────────────────────────────────────────┤
│  /mcp        → Streamable HTTP MCP transport            │
│  /exports/*  → Static file serving                      │
│  /health     → Health check                             │
├─────────────────────────────────────────────────────────┤
│                  Session Manager                        │
│   session_1: { diagram_a, diagram_b, ... }              │
│   session_2: { diagram_x, diagram_y, ... }              │
├─────────────────────────────────────────────────────────┤
│                 Puppeteer Browser                       │
│              (Headless, singleton)                      │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
              embed.diagrams.net (SVG rendering)
```

## Docker

```dockerfile
FROM node:20-slim

# Install Chrome dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
RUN npm install @next-ai-drawio/mcp-server

EXPOSE 6002
CMD ["npx", "@next-ai-drawio/mcp-server"]
```

## Troubleshooting

### Puppeteer fails to start

In containerized environments, you may need to install Chrome dependencies:

```bash
apt-get install -y chromium
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

### Port already in use

Set a custom port via environment variable:

```bash
PORT=6003 npx @next-ai-drawio/mcp-server
```

### SVG export timeout

The SVG rendering requires network access to `embed.diagrams.net` (or your private draw.io instance). Ensure the server can reach this URL.

For private deployments:

```bash
DRAWIO_BASE_URL=https://drawio.your-company.com npx @next-ai-drawio/mcp-server
```

## License

Apache-2.0
