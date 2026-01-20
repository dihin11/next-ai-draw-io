# Next AI Draw.io MCP Server - 使用指南

## 服务状态

服务已成功启动在端口 `6005`！

```bash
# 检查服务健康状态
curl http://localhost:6005/health

# 查看服务信息
curl http://localhost:6005/
```

## 可用的 MCP 工具

| 工具名 | 说明 |
|--------|------|
| `start_session` | 创建新的 session（一个报告） |
| `end_session` | 结束并删除 session |
| `create_diagram` | 在 session 中创建新的图表 |
| `edit_diagram` | 编辑现有图表 |
| `get_diagram` | 获取图表的 drawio XML |
| `list_diagrams` | 列出 session 中的所有图表 |
| `delete_diagram` | 删除指定图表 |
| `export_diagram` | 导出图表为 SVG 或 drawio 格式 |

## 使用示例

### 示例 1: 创建一个包含多张图的报告

```json
// 1. 创建 session
{
  "method": "tools/call",
  "params": {
    "name": "start_session",
    "arguments": {}
  }
}

// 响应示例:
{
  "content": [
    {
      "type": "text",
      "text": "Session created: session-abc123"
    }
  ]
}

// 2. 创建第一张图（架构图）
{
  "method": "tools/call",
  "params": {
    "name": "create_diagram",
    "arguments": {
      "session_id": "session-abc123",
      "diagram_id": "architecture",
      "xml": "<mxGraphModel>...</mxGraphModel>"
    }
  }
}

// 3. 创建第二张图（流程图）
{
  "method": "tools/call",
  "params": {
    "name": "create_diagram",
    "arguments": {
      "session_id": "session-abc123",
      "diagram_id": "workflow",
      "xml": "<mxGraphModel>...</mxGraphModel>"
    }
  }
}

// 4. 列出所有图表
{
  "method": "tools/call",
  "params": {
    "name": "list_diagrams",
    "arguments": {
      "session_id": "session-abc123"
    }
  }
}

// 5. 导出第一张图为 SVG
{
  "method": "tools/call",
  "params": {
    "name": "export_diagram",
    "arguments": {
      "session_id": "session-abc123",
      "diagram_id": "architecture",
      "format": "svg",
      "output": "content"
    }
  }
}

// 6. 导出第二张图为 drawio.svg（可再编辑）
{
  "method": "tools/call",
  "params": {
    "name": "export_diagram",
    "arguments": {
      "session_id": "session-abc123",
      "diagram_id": "workflow",
      "format": "drawio_svg",
      "output": "url"
    }
  }
}
```

### 示例 2: 导出格式说明

| format | output | 说明 |
|--------|--------|------|
| `svg` | `content` | 返回纯 SVG 内容 |
| `svg` | `url` | 返回文件 URL |
| `drawio_svg` | `content` | 返回可再编辑的 SVG（含 XML） |
| `drawio_svg` | `url` | 返回文件 URL |
| `drawio` | `content` | 返回 XML 内容 |
| `drawio` | `url` | 返回文件 URL |

### 示例 3: Markdown 报告嵌入

```markdown
# 系统架构报告

## 架构概览

![架构图](http://localhost:6005/exports/session-abc123/architecture.svg)

## 工作流程

![流程图](http://localhost:6005/exports/session-abc123/workflow.drawio.svg)
```

## Claude Desktop 配置

将以下配置添加到 Claude Desktop 配置文件中：

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "next-ai-drawio": {
      "url": "http://localhost:6005/mcp"
    }
  }
}
```

## 环境变量配置

```bash
export PORT=6005
export DRAWIO_BASE_URL=https://embed.diagrams.net
export EXPORTS_DIR=/tmp/mcp-drawio-exports
export SESSION_TIMEOUT=3600000  # 1小时
```

## 部署到 Pod

### Dockerfile

```dockerfile
FROM node:18-slim

WORKDIR /app
COPY . .

RUN npm install
RUN npm run build

EXPOSE 6005
ENV PORT=6005

CMD ["npm", "start"]
```

### docker-compose.yml

```yaml
version: "3.8"

services:
  drawio-mcp:
    build: .
    ports:
      - "6005:6005"
    environment:
      - PORT=6005
      - DRAWIO_BASE_URL=https://embed.diagrams.net
    volumes:
      - /tmp/mcp-drawio-exports:/tmp/mcp-drawio-exports
```

### 启动服务

```bash
# Docker
docker-compose up -d

# 检查日志
docker-compose logs -f

# 测试服务
curl http://localhost:6005/health
```

## 故障排查

### 问题: 端口已被占用
```bash
# 查找占用端口的进程
lsof -i :6005

# 或使用其他端口
PORT=6006 npm start
```

### 问题: Puppeteer 无法启动
```bash
# 检查系统是否安装了必要的依赖
# Ubuntu/Debian
apt-get install -y \
  libnss3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libasound2
```

### 问题: 导出 SVG 失败
- 检查是否能访问 `https://embed.diagrams.net`
- 检查 XML 格式是否正确
- 查看服务日志：`tail -f /tmp/mcp-server-6005.log`
