# Next AI Draw.io MCP Server Configuration

## HTTP Streamable Mode (推荐)

适用于支持 HTTP 传输的 MCP 客户端（如 Cursor, Windsurf 等）：

```json
{
  "mcpServers": {
    "next-ai-drawio": {
      "url": "http://localhost:6005/mcp",
      "type": "http",
      "headers": {
        "Content-Type": "application/json"
      }
    }
  }
}
```

## Stdio Mode (已废弃)

**注意：** 当前版本已完全切换到 HTTP Streamable 模式，不再支持 Stdio 传输。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `6002` | 服务监听端口 |
| `DRAWIO_BASE_URL` | `https://embed.diagrams.net` | draw.io embed 服务地址 |
| `EXPORTS_DIR` | `/tmp/mcp-drawio-exports` | 导出文件保存目录 |
| `SESSION_TIMEOUT` | `3600000` | Session 超时时间（毫秒） |

## Docker 部署示例

```yaml
version: "3.8"

services:
  drawio-mcp:
    image: node:18-slim
    working_dir: /app
    volumes:
      - ./packages/mcp-server:/app
      - /tmp/mcp-drawio-exports:/tmp/mcp-drawio-exports
    ports:
      - "6005:6005"
    environment:
      - PORT=6005
      - DRAWIO_BASE_URL=https://embed.diagrams.net
    command: npm start
```

## Kubernetes 部署示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: drawio-mcp
spec:
  replicas: 1
  selector:
    matchLabels:
      app: drawio-mcp
  template:
    metadata:
      labels:
        app: drawio-mcp
    spec:
      containers:
      - name: drawio-mcp
        image: node:18-slim
        workingDir: /app
        ports:
        - containerPort: 6005
        env:
        - name: PORT
          value: "6005"
        - name: DRAWIO_BASE_URL
          value: "https://embed.diagrams.net"
        volumeMounts:
        - name: app
          mountPath: /app
        - name: exports
          mountPath: /tmp/mcp-drawio-exports
      volumes:
      - name: app
        emptyDir: {}
      - name: exports
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: drawio-mcp
spec:
  selector:
    app: drawio-mcp
  ports:
  - port: 6005
    targetPort: 6005
```

## 快速开始

1. **本地开发：**
   ```bash
   npm install
   npm run build
   npm start
   ```

2. **测试连接：**
   ```bash
   curl http://localhost:6005/health
   ```

3. **在 Claude Desktop 中配置：**
   - 将 HTTP Streamable 模式的配置添加到 Claude Desktop 的 MCP 配置文件中
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Linux: `~/.config/Claude/claude_desktop_config.json`
