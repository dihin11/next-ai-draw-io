#!/usr/bin/env node
/**
 * MCP SSE Server for Next AI Draw.io
 *
 * Enables AI agents to generate and edit draw.io diagrams with SVG export.
 * Supports multiple sessions, each containing multiple diagrams.
 *
 * Transport: HTTP Streamable (MCP specification)
 */

// Setup DOM polyfill for Node.js (required for XML operations)
import { DOMParser } from "linkedom"
;(globalThis as any).DOMParser = DOMParser

// Create XMLSerializer polyfill using outerHTML
class XMLSerializerPolyfill {
    serializeToString(node: any): string {
        if (node.outerHTML !== undefined) {
            return node.outerHTML
        }
        if (node.documentElement) {
            return node.documentElement.outerHTML
        }
        return ""
    }
}
;(globalThis as any).XMLSerializer = XMLSerializerPolyfill

import http from "node:http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"
import {
    applyDiagramOperations,
    type DiagramOperation,
} from "./diagram-operations.js"
import { log } from "./logger.js"
import {
    createDiagram,
    createSession,
    deleteDiagram,
    deleteSession,
    getDiagram,
    getSession,
    listDiagrams,
    startCleanupInterval,
    stopCleanupInterval,
    updateDiagram,
} from "./session-manager.js"
import { svgRenderer } from "./svg-renderer.js"
import { validateAndFixXml } from "./xml-validation.js"
import fs from "node:fs/promises"
import path from "node:path"

// Server configuration
const config = {
    port: parseInt(process.env.PORT || "6002", 10),
}

// Export directory
const EXPORTS_DIR = process.env.EXPORTS_DIR || "/tmp/mcp-drawio-exports"

// Create MCP server
const server = new McpServer({
    name: "next-ai-drawio",
    version: "0.2.0",
})

// Register prompt with workflow guidance
server.prompt(
    "diagram-workflow",
    "Guidelines for creating and editing draw.io diagrams",
    () => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `# Draw.io Diagram Creation Guidelines

## Workflow
1. Call start_session to create a new session (returns session_id)
2. Use create_diagram with session_id to create diagrams (returns diagram_id)
3. Each session can contain multiple diagrams

## Exporting Diagrams
1. Use export_diagram with format option:
   - "svg": Standard SVG (for display only)
   - "drawio_svg": SVG with embedded diagram data (editable)
   - "drawio": Original XML format
2. Choose output mode:
   - "content": Returns SVG/XML string directly
   - "url": Saves file and returns URL

## Draw.io XML Schema Reference

### Basic Structure
\`\`\`xml
<mxGraphModel>
  <root>
    <mxCell id="0" />  <!-- Root cell, always present -->
    <mxCell id="1" />  <!-- Default parent for all elements -->
    <!-- Your diagram elements go here -->
  </root>
</mxGraphModel>
\`\`\`

### Vertex (Shape/Box)
\`\`\`xml
<mxCell id="2" parent="1" vertex="1" value="Box Label"
  style="rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=14;">
  <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
</mxCell>
\`\`\`

### Edge (Line/Arrow)
\`\`\`xml
<mxCell id="3" parent="1" edge="1" source="2" target="4"
  style="edgeStyle=orthogonalEdgeStyle;rounded=0;strokeWidth=2;">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
\`\`\`

### Common Style Examples
- **Rectangle**: \`rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;\`
- **Rounded Box**: \`rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;\`
- **Diamond (Decision)**: \`shape=mxgraph.flowchart.decision;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;\`
- **Cylinder (Database)**: \`shape=cylinder3;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;\`
- **Document**: \`shape=mxgraph.basic.document;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;\`

### Important Rules
- **IDs**: Start from "2", "0" and "1" are reserved
- **Coordinates**: Keep within reasonable bounds (x=0-2000, y=0-1500)
- **Connect edges**: source and target must point to valid vertex IDs
- **Positioning**: Plan layout manually, draw.io won't auto-arrange
- **Unique IDs**: Every cell must have a unique ID`,
                },
            },
        ],
    })
)

// Tool: start_session
server.registerTool(
    "start_session",
    {
        description:
            "Start a new diagram session. " +
            "Returns a session_id that can be used to create and manage multiple diagrams. " +
            "Each session can contain multiple diagrams for a single report/document.",
        inputSchema: {},
    },
    async () => {
        try {
            const session = createSession()

            log.info(`Session started: ${session.id}`)

            return {
                content: [
                    {
                        type: "text",
                        text: `Session started successfully!\n\nSession ID: ${session.id}\n\nYou can now create diagrams using create_diagram with this session_id.`,
                    },
                ],
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error)
            log.error("start_session failed:", message)
            return {
                content: [{ type: "text", text: `Error: ${message}` }],
                isError: true,
            }
        }
    }
)

// Tool: create_diagram
server.registerTool(
    "create_diagram",
    {
        description: `Create a new diagram in a session from mxGraphModel XML.

CRITICAL: You MUST provide 'session_id' and 'xml' arguments in EVERY call.

XML FORMAT - Full mxGraphModel structure:
<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="2" value="Shape" style="rounded=1;" vertex="1" parent="1">
      <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>

LAYOUT CONSTRAINTS:
- Keep all elements within x=0-800, y=0-600 (single page viewport)
- Use unique IDs starting from "2" (0 and 1 are reserved)
- Set parent="1" for top-level shapes
- Space shapes 150-200px apart for clear edge routing

COMMON STYLES:
- Shapes: rounded=1; fillColor=#hex; strokeColor=#hex
- Edges: endArrow=classic; edgeStyle=orthogonalEdgeStyle; curved=1
- Text: fontSize=14; fontStyle=1 (bold); align=center`,
        inputSchema: {
            session_id: z.string().describe("The session ID from start_session"),
            diagram_id: z
                .string()
                .optional()
                .describe("Optional custom diagram ID. Auto-generated if not provided."),
            xml: z
                .string()
                .describe("REQUIRED: The complete mxGraphModel XML."),
        },
    },
    async ({ session_id, diagram_id, xml: inputXml }) => {
        try {
            const session = getSession(session_id)
            if (!session) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Session not found: ${session_id}. Please call start_session first.`,
                        },
                    ],
                    isError: true,
                }
            }

            // Validate and auto-fix XML
            let xml = inputXml
            const { valid, error, fixed, fixes } = validateAndFixXml(xml)
            if (fixed) {
                xml = fixed
                log.info(`XML auto-fixed: ${fixes.join(", ")}`)
            }
            if (!valid && error) {
                log.error(`XML validation failed: ${error}`)
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: XML validation failed - ${error}`,
                        },
                    ],
                    isError: true,
                }
            }

            const diagram = createDiagram(session_id, xml, diagram_id)
            if (!diagram) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Failed to create diagram. ID may already exist.`,
                        },
                    ],
                    isError: true,
                }
            }

            log.info(`Diagram created: ${diagram.id} in session ${session_id}`)

            return {
                content: [
                    {
                        type: "text",
                        text: `Diagram created successfully!\n\nSession ID: ${session_id}\nDiagram ID: ${diagram.id}\nXML length: ${xml.length} characters\n\nUse export_diagram to export as SVG.`,
                    },
                ],
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error)
            log.error("create_diagram failed:", message)
            return {
                content: [{ type: "text", text: `Error: ${message}` }],
                isError: true,
            }
        }
    }
)

// Tool: edit_diagram
server.registerTool(
    "edit_diagram",
    {
        description:
            "Edit an existing diagram by ID-based operations (update/add/delete cells).\n\n" +
            "⚠️ RECOMMENDED: Call get_diagram first to see current structure.\n\n" +
            "Operations:\n" +
            "- add: Add a new cell. Provide cell_id (new unique id) and new_xml.\n" +
            "- update: Replace an existing cell by its id. Provide cell_id and complete new_xml.\n" +
            "- delete: Remove a cell by its id. Only cell_id is needed.\n\n" +
            "For add/update, new_xml must be a complete mxCell element including mxGeometry.",
        inputSchema: {
            session_id: z.string().describe("The session ID"),
            diagram_id: z.string().describe("The diagram ID to edit"),
            operations: z
                .array(
                    z.object({
                        operation: z
                            .enum(["update", "add", "delete"])
                            .describe("Operation to perform"),
                        cell_id: z.string().describe("The id of the mxCell"),
                        new_xml: z
                            .string()
                            .optional()
                            .describe("Complete mxCell XML (required for update/add)"),
                    })
                )
                .describe("Array of operations to apply"),
        },
    },
    async ({ session_id, diagram_id, operations }) => {
        try {
            const diagram = getDiagram(session_id, diagram_id)
            if (!diagram) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Diagram not found: ${diagram_id} in session ${session_id}`,
                        },
                    ],
                    isError: true,
                }
            }

            log.info(`Editing diagram ${diagram_id} with ${operations.length} operation(s)`)

            // Validate and auto-fix new_xml for each operation
            const validatedOps = operations.map((op) => {
                if (op.new_xml) {
                    const { valid, error, fixed, fixes } = validateAndFixXml(op.new_xml)
                    if (fixed) {
                        log.info(`Operation ${op.operation} ${op.cell_id}: XML auto-fixed: ${fixes.join(", ")}`)
                        return { ...op, new_xml: fixed }
                    }
                    if (!valid && error) {
                        log.warn(`Operation ${op.operation} ${op.cell_id}: XML validation failed: ${error}`)
                    }
                }
                return op
            })

            // Apply operations
            const { result, errors } = applyDiagramOperations(
                diagram.xml,
                validatedOps as DiagramOperation[]
            )

            if (errors.length > 0) {
                const errorMessages = errors
                    .map((e) => `${e.type} ${e.cellId}: ${e.message}`)
                    .join("\n")
                log.warn(`Edit had ${errors.length} error(s): ${errorMessages}`)
            }

            // Update diagram
            updateDiagram(session_id, diagram_id, result)

            log.info(`Diagram edited successfully: ${diagram_id}`)

            const successMsg = `Diagram edited successfully!\n\nApplied ${operations.length} operation(s).`
            const errorMsg =
                errors.length > 0
                    ? `\n\nWarnings:\n${errors.map((e) => `- ${e.type} ${e.cellId}: ${e.message}`).join("\n")}`
                    : ""

            return {
                content: [
                    {
                        type: "text",
                        text: successMsg + errorMsg,
                    },
                ],
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error)
            log.error("edit_diagram failed:", message)
            return {
                content: [{ type: "text", text: `Error: ${message}` }],
                isError: true,
            }
        }
    }
)

// Tool: get_diagram
server.registerTool(
    "get_diagram",
    {
        description:
            "Get the current diagram XML. " +
            "Call this before edit_diagram to see current cell IDs and structure.",
        inputSchema: {
            session_id: z.string().describe("The session ID"),
            diagram_id: z.string().describe("The diagram ID to get"),
        },
    },
    async ({ session_id, diagram_id }) => {
        try {
            const diagram = getDiagram(session_id, diagram_id)
            if (!diagram) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Diagram not found: ${diagram_id} in session ${session_id}`,
                        },
                    ],
                    isError: true,
                }
            }

            return {
                content: [
                    {
                        type: "text",
                        text: `Current diagram XML:\n\n${diagram.xml}`,
                    },
                ],
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error)
            log.error("get_diagram failed:", message)
            return {
                content: [{ type: "text", text: `Error: ${message}` }],
                isError: true,
            }
        }
    }
)

// Tool: list_diagrams
server.registerTool(
    "list_diagrams",
    {
        description: "List all diagrams in a session.",
        inputSchema: {
            session_id: z.string().describe("The session ID"),
        },
    },
    async ({ session_id }) => {
        try {
            const diagrams = listDiagrams(session_id)
            if (!diagrams) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Session not found: ${session_id}`,
                        },
                    ],
                    isError: true,
                }
            }

            if (diagrams.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No diagrams in session ${session_id}.\n\nUse create_diagram to create one.`,
                        },
                    ],
                }
            }

            const list = diagrams
                .map((d) => `- ${d.id} (created: ${d.createdAt.toISOString()})`)
                .join("\n")

            return {
                content: [
                    {
                        type: "text",
                        text: `Diagrams in session ${session_id}:\n\n${list}`,
                    },
                ],
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error)
            log.error("list_diagrams failed:", message)
            return {
                content: [{ type: "text", text: `Error: ${message}` }],
                isError: true,
            }
        }
    }
)

// Tool: export_diagram
server.registerTool(
    "export_diagram",
    {
        description: `Export a diagram to SVG or other formats.

Formats:
- "svg": Standard SVG for display (cannot be re-edited in draw.io)
- "drawio_svg": SVG with embedded diagram data (can be opened and edited in draw.io)
- "drawio": Original XML format

Output modes:
- "content": Returns the file content directly (good for small files)
- "url": Saves to server and returns URL (good for embedding in markdown)`,
        inputSchema: {
            session_id: z.string().describe("The session ID"),
            diagram_id: z.string().describe("The diagram ID to export"),
            format: z
                .enum(["svg", "drawio_svg", "drawio"])
                .default("svg")
                .describe("Export format"),
            output: z
                .enum(["content", "url"])
                .default("content")
                .describe("Output mode: content string or URL"),
        },
    },
    async ({ session_id, diagram_id, format, output }) => {
        try {
            const diagram = getDiagram(session_id, diagram_id)
            if (!diagram) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Diagram not found: ${diagram_id} in session ${session_id}`,
                        },
                    ],
                    isError: true,
                }
            }

            let content: string

            if (format === "drawio") {
                // Just return the XML as-is
                content = diagram.xml
            } else {
                // Render to SVG using Puppeteer
                log.info(`Rendering SVG for diagram ${diagram_id}...`)
                content = await svgRenderer.render(diagram.xml, {
                    format: format === "drawio_svg" ? "drawio_svg" : "svg",
                })
                log.info(`SVG rendered: ${content.length} characters`)
            }

            if (output === "url") {
                // Save to file and return URL
                const url = await saveExportFile(session_id, diagram_id, format, content)
                return {
                    content: [
                        {
                            type: "text",
                            text: `Diagram exported successfully!\n\nFormat: ${format}\nURL: ${url}\n\nYou can embed this in markdown: ![Diagram](${url})`,
                        },
                    ],
                }
            } else {
                // Return content directly
                return {
                    content: [
                        {
                            type: "text",
                            text: `Diagram exported successfully!\n\nFormat: ${format}\nLength: ${content.length} characters\n\n${content}`,
                        },
                    ],
                }
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error)
            log.error("export_diagram failed:", message)
            return {
                content: [{ type: "text", text: `Error: ${message}` }],
                isError: true,
            }
        }
    }
)

// Tool: delete_diagram
server.registerTool(
    "delete_diagram",
    {
        description: "Delete a diagram from a session.",
        inputSchema: {
            session_id: z.string().describe("The session ID"),
            diagram_id: z.string().describe("The diagram ID to delete"),
        },
    },
    async ({ session_id, diagram_id }) => {
        try {
            const deleted = deleteDiagram(session_id, diagram_id)
            if (!deleted) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Diagram not found: ${diagram_id} in session ${session_id}`,
                        },
                    ],
                    isError: true,
                }
            }

            return {
                content: [
                    {
                        type: "text",
                        text: `Diagram deleted: ${diagram_id}`,
                    },
                ],
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error)
            log.error("delete_diagram failed:", message)
            return {
                content: [{ type: "text", text: `Error: ${message}` }],
                isError: true,
            }
        }
    }
)

// Tool: end_session
server.registerTool(
    "end_session",
    {
        description: "End a session and clean up all associated diagrams and exports.",
        inputSchema: {
            session_id: z.string().describe("The session ID to end"),
        },
    },
    async ({ session_id }) => {
        try {
            const deleted = deleteSession(session_id)
            if (!deleted) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Session not found: ${session_id}`,
                        },
                    ],
                    isError: true,
                }
            }

            // Clean up export files on disk
            try {
                const sessionDir = path.join(EXPORTS_DIR, session_id)
                await fs.rm(sessionDir, { recursive: true, force: true })
                log.info(`Export files cleaned up: ${sessionDir}`)
            } catch (error) {
                const err = error as NodeJS.ErrnoException
                // Ignore if directory doesn't exist
                if (err.code !== "ENOENT") {
                    log.error(`Failed to clean up exports for ${session_id}:`, error)
                }
            }

            return {
                content: [
                    {
                        type: "text",
                        text: `Session ended: ${session_id}\n\nAll diagrams and exports have been cleaned up.`,
                    },
                ],
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error)
            log.error("end_session failed:", message)
            return {
                content: [{ type: "text", text: `Error: ${message}` }],
                isError: true,
            }
        }
    }
)

// Helper function to save export files
async function saveExportFile(
    sessionId: string,
    diagramId: string,
    format: string,
    content: string
): Promise<string> {
    const sessionDir = path.join(EXPORTS_DIR, sessionId)
    await fs.mkdir(sessionDir, { recursive: true })

    let filename: string
    if (format === "drawio_svg") {
        filename = `${diagramId}.drawio.svg`
    } else if (format === "svg") {
        filename = `${diagramId}.svg`
    } else {
        filename = `${diagramId}.drawio`
    }

    const filePath = path.join(sessionDir, filename)
    await fs.writeFile(filePath, content, "utf-8")
    log.info(`Export saved: ${filePath}`)

    return `http://localhost:${config.port}/exports/${sessionId}/${filename}`
}

// HTTP server instance
let httpServer: http.Server | null = null

// Graceful shutdown handler
let isShuttingDown = false
async function gracefulShutdown(reason: string) {
    if (isShuttingDown) return
    isShuttingDown = true
    log.info(`Shutting down: ${reason}`)

    // Shutdown components
    stopCleanupInterval()
    await svgRenderer.shutdown()
    if (httpServer) {
        httpServer.close()
    }

    process.exit(0)
}

// Handle signals
process.on("SIGINT", () => gracefulShutdown("SIGINT"))
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))

// Handle uncaught errors
process.on("uncaughtException", (error) => {
    log.error("Uncaught exception:", error)
    gracefulShutdown("uncaughtException")
})

process.on("unhandledRejection", (reason) => {
    log.error("Unhandled rejection:", reason)
})

// Start the MCP server
async function main() {
    log.info("Starting MCP Streamable HTTP server for Next AI Draw.io...")

    // Initialize SVG renderer (Puppeteer)
    log.info("Initializing Puppeteer browser...")
    await svgRenderer.init()

    // Start session cleanup interval
    startCleanupInterval()

    // Create transport with session ID generator for stateful mode
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => `mcp-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
    })

    // Connect MCP server to transport
    await server.connect(transport)

    // Create HTTP server
    httpServer = http.createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${config.port}`)

        // CORS headers
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id")
        res.setHeader("Access-Control-Expose-Headers", "mcp-session-id")

        if (req.method === "OPTIONS") {
            res.writeHead(204)
            res.end()
            return
        }

        // MCP endpoint - handles both GET (SSE) and POST (messages)
        if (url.pathname === "/mcp") {
            await transport.handleRequest(req, res)
            return
        }

        // Static file serving for exports
        if (url.pathname.startsWith("/exports/")) {
            await handleExports(req, res, url)
            return
        }

        // Health check
        if (url.pathname === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(JSON.stringify({
                status: "ok",
                uptime: process.uptime(),
            }))
            return
        }

        // Status page
        if (url.pathname === "/") {
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(JSON.stringify({
                name: "next-ai-drawio-mcp",
                version: "0.2.0",
                transport: "streamable-http",
                endpoints: {
                    mcp: "/mcp",
                    exports: "/exports/{session_id}/{diagram_id}.{format}",
                    health: "/health",
                },
            }))
            return
        }

        res.writeHead(404)
        res.end("Not Found")
    })

    // Start listening
    httpServer.listen(config.port, () => {
        log.info(`MCP server running on http://localhost:${config.port}`)
        log.info("Endpoints:")
        log.info(`  MCP:      http://localhost:${config.port}/mcp`)
        log.info(`  Exports:  http://localhost:${config.port}/exports/`)
        log.info(`  Health:   http://localhost:${config.port}/health`)
    })
}

// Handle export file serving
async function handleExports(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
): Promise<void> {
    if (req.method !== "GET") {
        res.writeHead(405)
        res.end("Method Not Allowed")
        return
    }

    const pathParts = url.pathname.split("/").filter(Boolean)
    if (pathParts.length < 3) {
        res.writeHead(400)
        res.end("Invalid export path")
        return
    }

    const sessionId = pathParts[1]
    const filename = pathParts.slice(2).join("/")

    if (sessionId.includes("..") || filename.includes("..")) {
        res.writeHead(400)
        res.end("Invalid path")
        return
    }

    const filePath = path.join(EXPORTS_DIR, sessionId, filename)

    try {
        const content = await fs.readFile(filePath)
        let contentType = "application/octet-stream"
        if (filename.endsWith(".svg")) {
            contentType = "image/svg+xml"
        } else if (filename.endsWith(".drawio")) {
            contentType = "application/xml"
        }
        res.writeHead(200, { "Content-Type": contentType })
        res.end(content)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            res.writeHead(404)
            res.end("File not found")
        } else {
            log.error("Export file read error:", error)
            res.writeHead(500)
            res.end("Internal server error")
        }
    }
}

main().catch((error) => {
    log.error("Fatal error:", error)
    process.exit(1)
})
