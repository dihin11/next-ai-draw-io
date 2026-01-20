# Findings

## 现有代码分析

### index.ts
- 使用 `@modelcontextprotocol/sdk` 的 `McpServer` 和 `StdioServerTransport`
- 当前工具：`start_session`, `create_new_diagram`, `edit_diagram`, `get_diagram`, `export_diagram`
- `currentSession` 单例模式，只支持一个 session 一个图
- `export_diagram` 只支持 `.drawio` 格式

### http-server.ts
- 内嵌 HTTP 服务器，端口 6002-6020
- 提供 draw.io embed iframe 预览页面
- API: `/api/state`, `/api/history`, `/api/restore`, `/api/history-svg`
- `stateStore` 存储 session 状态

### diagram-operations.ts
- 处理 mxCell 的 add/update/delete 操作
- 纯 XML 操作，不需要修改

### xml-validation.ts
- XML 验证和自动修复
- 不需要修改

### history.ts
- 历史记录管理，用于浏览器预览的撤销功能
- SSE 模式不需要，可以删除

## MCP SDK SSE 支持
- SDK 提供 `SSEServerTransport` 用于 HTTP SSE 传输
- 需要两个端点：GET /sse (建立连接) 和 POST /messages (接收消息)

## Puppeteer draw.io 渲染
- draw.io embed 通过 postMessage 通信
- 关键消息：`init`(就绪), `load`(加载 XML), `export`(导出)
- 导出格式：xml, svg, png, pdf 等
