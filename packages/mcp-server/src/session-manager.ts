/**
 * Session Manager for MCP SSE Server
 * Manages multiple sessions, each containing multiple diagrams
 */

import { log } from "./logger.js"

export interface Diagram {
    id: string
    xml: string
    createdAt: Date
}

export interface Session {
    id: string
    diagrams: Map<string, Diagram>
    createdAt: Date
    lastAccessedAt: Date
}

// Session store
const sessions = new Map<string, Session>()

// Configuration
const SESSION_TTL = 60 * 60 * 1000 // 1 hour

/**
 * Generate a unique ID
 */
function generateId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Create a new session
 */
export function createSession(): Session {
    const session: Session = {
        id: generateId("session"),
        diagrams: new Map(),
        createdAt: new Date(),
        lastAccessedAt: new Date(),
    }
    sessions.set(session.id, session)
    log.info(`Session created: ${session.id}`)
    return session
}

/**
 * Get a session by ID
 */
export function getSession(sessionId: string): Session | undefined {
    const session = sessions.get(sessionId)
    if (session) {
        session.lastAccessedAt = new Date()
    }
    return session
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): boolean {
    const deleted = sessions.delete(sessionId)
    if (deleted) {
        log.info(`Session deleted: ${sessionId}`)
    }
    return deleted
}

/**
 * Create a new diagram in a session
 */
export function createDiagram(
    sessionId: string,
    xml: string,
    diagramId?: string
): Diagram | null {
    const session = getSession(sessionId)
    if (!session) {
        log.error(`Session not found: ${sessionId}`)
        return null
    }

    const id = diagramId || generateId("diagram")
    
    // Check if diagram ID already exists
    if (session.diagrams.has(id)) {
        log.error(`Diagram ID already exists: ${id}`)
        return null
    }

    const diagram: Diagram = {
        id,
        xml,
        createdAt: new Date(),
    }
    session.diagrams.set(id, diagram)
    log.info(`Diagram created: ${id} in session ${sessionId}`)
    return diagram
}

/**
 * Get a diagram from a session
 */
export function getDiagram(
    sessionId: string,
    diagramId: string
): Diagram | null {
    const session = getSession(sessionId)
    if (!session) {
        return null
    }
    return session.diagrams.get(diagramId) || null
}

/**
 * Update a diagram's XML
 */
export function updateDiagram(
    sessionId: string,
    diagramId: string,
    xml: string
): Diagram | null {
    const session = getSession(sessionId)
    if (!session) {
        return null
    }

    const diagram = session.diagrams.get(diagramId)
    if (!diagram) {
        return null
    }

    diagram.xml = xml
    log.info(`Diagram updated: ${diagramId} in session ${sessionId}`)
    return diagram
}

/**
 * Delete a diagram from a session
 */
export function deleteDiagram(
    sessionId: string,
    diagramId: string
): boolean {
    const session = getSession(sessionId)
    if (!session) {
        return false
    }

    const deleted = session.diagrams.delete(diagramId)
    if (deleted) {
        log.info(`Diagram deleted: ${diagramId} from session ${sessionId}`)
    }
    return deleted
}

/**
 * List all diagrams in a session
 */
export function listDiagrams(
    sessionId: string
): Array<{ id: string; createdAt: Date }> | null {
    const session = getSession(sessionId)
    if (!session) {
        return null
    }

    return Array.from(session.diagrams.values()).map((d) => ({
        id: d.id,
        createdAt: d.createdAt,
    }))
}

/**
 * Clean up expired sessions
 */
export function cleanupExpiredSessions(): void {
    const now = Date.now()
    for (const [sessionId, session] of sessions) {
        if (now - session.lastAccessedAt.getTime() > SESSION_TTL) {
            sessions.delete(sessionId)
            log.info(`Cleaned up expired session: ${sessionId}`)

            // Clean up export files on disk
            const EXPORTS_DIR = process.env.EXPORTS_DIR || "/tmp/mcp-drawio-exports"
            import("node:fs/promises").then(({ rm }) => {
                const sessionDir = `${EXPORTS_DIR}/${sessionId}`
                rm(sessionDir, { recursive: true, force: true }).catch((error) => {
                    const err = error as NodeJS.ErrnoException
                    if (err.code !== "ENOENT") {
                        log.error(`Failed to clean up exports for expired session ${sessionId}:`, error)
                    }
                })
                log.info(`Export files cleaned up for expired session: ${sessionId}`)
            })
        }
    }
}

/**
 * Get all session IDs (for debugging)
 */
export function getAllSessionIds(): string[] {
    return Array.from(sessions.keys())
}

/**
 * Get session count
 */
export function getSessionCount(): number {
    return sessions.size
}

// Start cleanup interval
let cleanupIntervalId: NodeJS.Timeout | null = null

export function startCleanupInterval(): void {
    if (!cleanupIntervalId) {
        cleanupIntervalId = setInterval(cleanupExpiredSessions, 5 * 60 * 1000)
        log.info("Session cleanup interval started")
    }
}

export function stopCleanupInterval(): void {
    if (cleanupIntervalId) {
        clearInterval(cleanupIntervalId)
        cleanupIntervalId = null
        log.info("Session cleanup interval stopped")
    }
}
