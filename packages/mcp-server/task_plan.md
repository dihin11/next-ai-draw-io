# Task Plan: MCP SSE + SVG 导出功能

## Goal
将 MCP 服务从 Stdio 模式转换为 SSE 模式，添加 Puppeteer SVG 渲染导出功能，支持多 session 多 diagram。

## Design Document
[docs/plans/2026-01-20-mcp-sse-svg-export-design.md](docs/plans/2026-01-20-mcp-sse-svg-export-design.md)

## Phases

### Phase 1: 添加依赖和基础模块
- [x] 1.1 更新 package.json 添加 puppeteer 依赖
- [x] 1.2 创建 src/session-manager.ts - Session/Diagram 数据管理
- [x] 1.3 创建 src/svg-renderer.ts - Puppeteer SVG 渲染模块
- **Status:** `complete`

### Phase 2: 改造 HTTP 服务器
- [x] 2.1 添加 SSE 路由 (/sse, /messages)
- [x] 2.2 添加静态文件服务 (/exports/*)
- [x] 2.3 移除前端预览 HTML 页面
- [x] 2.4 移除 history 相关 API
- **Status:** `complete`

### Phase 3: 重构 MCP 工具接口
- [x] 3.1 重构 start_session - 只创建 session，不打开浏览器
- [x] 3.2 重构 create_diagram - 支持 session_id + diagram_id
- [x] 3.3 重构 edit_diagram - 支持 session_id + diagram_id
- [x] 3.4 重构 get_diagram - 支持 session_id + diagram_id
- [x] 3.5 新增 list_diagrams 工具
- [x] 3.6 重构 export_diagram - 支持 SVG 格式和 content/url 输出
- [x] 3.7 新增 delete_diagram 工具
- [x] 3.8 新增 end_session 工具
- **Status:** `complete`

### Phase 4: 切换传输层
- [x] 4.1 移除 StdioServerTransport
- [x] 4.2 使用 StreamableHTTPServerTransport
- [x] 4.3 集成 HTTP 服务器到 index.ts
- **Status:** `complete`

### Phase 5: 清理和测试
- [x] 5.1 删除 src/history.ts
- [x] 5.2 删除 src/http-server.ts (功能已集成)
- [x] 5.3 更新 README
- [x] 5.4 构建验证通过
- **Status:** `complete`

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| (none yet) | | |

## Files Modified
| File | Action | Notes |
|------|--------|-------|
| (tracking as we go) | | |
