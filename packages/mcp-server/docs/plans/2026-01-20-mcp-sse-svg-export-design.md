# MCP SSE + SVG 导出功能设计

## 概述

将 MCP 服务从 Stdio 模式转换为 SSE 模式，并添加基于 Puppeteer 的 SVG 渲染导出功能，支持部署到 Pod 供外部调用。

## 需求背景

- 当前导出只支持 `.drawio` XML 格式
- 需要支持 `.drawio.svg` 格式以便嵌入 Markdown 文档
- 需要将 MCP 转为 SSE 传输，部署到 Pod 供外部调用
- 一个 session 代表一份报告，需要支持多张图

## 设计决策

| 决策项 | 选择 | 理由 |
|-------|------|------|
| Headless 启动模式 | 常驻模式 | Pod 部署场景，内存不是主要问题，响应延迟更重要 |
| Session/图关系 | 一个 session 多个 diagram | 一个 session = 一份报告 = 多张图 |
| Browser 进程共享 | 是 | 所有 session 共用一个 Browser 进程，节省资源 |
| Headless 引擎 | Puppeteer | 专注 Chromium，社区资源多 |
| SVG 渲染方式 | embed.diagrams.net + Puppeteer | 复用现有架构，不依赖额外 API |
| 端口模式 | 单端口 (6002) | 部署简单，只需暴露一个端口 |
| SVG 格式 | svg / drawio_svg / drawio | 灵活支持多种格式 |
| 导出返回 | content / url | 灵活支持内容返回或 URL 返回 |
| MCP 传输 | 仅 SSE | 移除 Stdio，完全切换到 SSE |

## 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    MCP SSE Server                       │
│                     (Port 6002)                         │
├─────────────────────────────────────────────────────────┤
│  GET  /sse       → SSE 连接                             │
│  POST /messages  → MCP 消息处理                         │
│  GET  /exports/* → 静态文件服务（导出的 SVG/drawio）      │
├─────────────────────────────────────────────────────────┤
│                  Session Manager                        │
│   session_1: { diagram_a, diagram_b, ... }              │
│   session_2: { diagram_x, diagram_y, ... }              │
├─────────────────────────────────────────────────────────┤
│                 Puppeteer Browser                       │
│              (常驻单进程，共享使用)                       │
│   └── Page Pool (按需创建/销毁)                          │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
              embed.diagrams.net (渲染)
```

## 数据模型

```typescript
interface Diagram {
  id: string           // diagram-xxx
  xml: string          // drawio XML
  createdAt: Date
}

interface Session {
  id: string           // session-xxx
  diagrams: Map<string, Diagram>
  createdAt: Date
}

const sessions = new Map<string, Session>()
```

## MCP 工具接口

### 1. start_session
```typescript
// 输入：无
// 输出：{ session_id: string }
```

### 2. create_diagram
```typescript
// 输入
{
  session_id: string,
  diagram_id?: string,     // 可选，不传则自动生成
  xml: string
}
// 输出：{ diagram_id: string }
```

### 3. edit_diagram
```typescript
// 输入
{
  session_id: string,
  diagram_id: string,
  operations: [{ operation, cell_id, new_xml }]
}
// 输出：{ success: boolean, warnings?: string[] }
```

### 4. get_diagram
```typescript
// 输入
{
  session_id: string,
  diagram_id: string
}
// 输出：{ xml: string }
```

### 5. list_diagrams
```typescript
// 输入
{
  session_id: string
}
// 输出：{ diagrams: [{ id, created_at }] }
```

### 6. export_diagram
```typescript
// 输入
{
  session_id: string,
  diagram_id: string,
  format: "svg" | "drawio_svg" | "drawio",  // 默认 svg
  output: "content" | "url"                  // 默认 content
}
// 输出（content 模式）：{ content: string, format: string }
// 输出（url 模式）：{ url: string, format: string }
```

## SVG 渲染模块

```typescript
// src/svg-renderer.ts
class SvgRenderer {
  private browser: Browser | null = null
  
  async init(): Promise<void>
  async render(xml: string, options: { format: "svg" | "drawio_svg" }): Promise<string>
  async shutdown(): Promise<void>
}
```

**渲染流程：**
1. 创建临时 Page，加载 `embed.diagrams.net/?embed=1&proto=json`
2. 等待 `init` 事件
3. postMessage 发送 `{ action: 'load', xml }`
4. postMessage 发送 `{ action: 'export', format: 'svg' }`
5. 监听 `export` 事件获取 SVG
6. 若 `drawio_svg` 格式，将原始 XML 嵌入 SVG
7. 关闭 Page，返回 SVG 字符串

## 文件服务

```
/exports/{session_id}/{diagram_id}.svg
/exports/{session_id}/{diagram_id}.drawio.svg
/exports/{session_id}/{diagram_id}.drawio
```

**清理策略：** Session 过期（默认 1 小时）时清理对应目录

## 文件变更清单

### 新增文件
- `src/svg-renderer.ts` - Puppeteer SVG 渲染模块
- `src/session-manager.ts` - Session/Diagram 管理模块

### 修改文件
- `package.json` - 添加 puppeteer 依赖
- `src/http-server.ts` - 添加 SSE 路由 + 静态文件服务
- `src/index.ts` - 重构 MCP 工具接口

### 移除文件
- `src/history.ts` - 浏览器历史功能（SSE 模式不需要）

### 移除功能
- 浏览器自动打开逻辑
- 前端预览 HTML 页面
- Stdio 传输支持
