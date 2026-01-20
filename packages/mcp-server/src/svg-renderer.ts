/**
 * SVG Renderer using Puppeteer and draw.io embed
 * Renders drawio XML to SVG using headless browser
 */

import puppeteer, { type Browser, type Page } from "puppeteer"
import { log } from "./logger.js"

// Configurable draw.io embed URL for private deployments
const DRAWIO_BASE_URL =
    process.env.DRAWIO_BASE_URL || "https://embed.diagrams.net"

export interface RenderOptions {
    format: "svg" | "drawio_svg"
}

class SvgRenderer {
    private browser: Browser | null = null
    private initPromise: Promise<void> | null = null

    /**
     * Initialize the browser instance
     */
    async init(): Promise<void> {
        if (this.browser) {
            return
        }

        // Prevent multiple concurrent initializations
        if (this.initPromise) {
            return this.initPromise
        }

        this.initPromise = this.doInit()
        return this.initPromise
    }

    private async doInit(): Promise<void> {
        try {
            log.info("Initializing Puppeteer browser...")
            this.browser = await puppeteer.launch({
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-web-security",
                ],
            })
            log.info("Puppeteer browser initialized")
        } catch (error) {
            this.initPromise = null
            throw error
        }
    }

    /**
     * Render drawio XML to SVG
     */
    async render(xml: string, options: RenderOptions): Promise<string> {
        if (!this.browser) {
            await this.init()
        }

        if (!this.browser) {
            throw new Error("Browser not initialized")
        }

        const page = await this.browser.newPage()

        try {
            // Set viewport for consistent rendering
            await page.setViewport({ width: 1920, height: 1080 })

            return await this.renderInPage(page, xml, options)
        } finally {
            await page.close()
        }
    }

    private async renderInPage(
        page: Page,
        xml: string,
        options: RenderOptions
    ): Promise<string> {
        log.info(`Rendering SVG using draw.io embed from: ${DRAWIO_BASE_URL}`)

        // Create a wrapper HTML page that embeds draw.io in an iframe
        // and handles the postMessage communication
        const wrapperHtml = this.createWrapperHtml(xml)

        // Set page content directly (data URL)
        await page.setContent(wrapperHtml, { waitUntil: "domcontentloaded" })

        // Wait for and get the SVG result
        const result = await page.evaluate(() => {
            return new Promise<{ success: boolean; data?: string; error?: string }>((resolve) => {
                const timeout = setTimeout(() => {
                    resolve({ success: false, error: "Timeout waiting for SVG export (90s)" })
                }, 90000)

                // Listen for our custom result event
                window.addEventListener("DRAWIO_RESULT", ((e: CustomEvent) => {
                    clearTimeout(timeout)
                    resolve(e.detail)
                }) as EventListener)
            })
        })

        if (!result.success || !result.data) {
            throw new Error(result.error || "SVG export failed")
        }

        log.info(`SVG export successful, length: ${result.data.length}`)

        let svgContent = result.data

        // Handle base64 data URI format
        if (svgContent.startsWith("data:image/svg+xml;base64,")) {
            const base64Data = svgContent.replace("data:image/svg+xml;base64,", "")
            svgContent = Buffer.from(base64Data, "base64").toString("utf-8")
        }

        // If drawio_svg format, embed the original XML in the SVG
        if (options.format === "drawio_svg") {
            svgContent = this.embedXmlInSvg(svgContent, xml)
        }

        return svgContent
    }

    /**
     * Create wrapper HTML page that embeds draw.io
     */
    private createWrapperHtml(xml: string): string {
        // Escape XML for embedding in JavaScript
        const escapedXml = JSON.stringify(xml)

        return `<!DOCTYPE html>
<html>
<head>
    <title>Draw.io SVG Export</title>
    <style>
        body { margin: 0; overflow: hidden; }
        iframe { width: 100%; height: 100vh; border: none; }
    </style>
</head>
<body>
    <iframe id="drawio" src="${DRAWIO_BASE_URL}/?embed=1&proto=json&spin=0&modified=0"></iframe>
    <script>
        const diagramXml = ${escapedXml};
        const iframe = document.getElementById('drawio');
        
        let initReceived = false;
        let loadReceived = false;
        
        function sendToDrawio(msg) {
            if (iframe.contentWindow) {
                iframe.contentWindow.postMessage(JSON.stringify(msg), '*');
            }
        }
        
        window.addEventListener('message', function(e) {
            if (e.source !== iframe.contentWindow) return;
            
            try {
                const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                
                console.log('[draw.io event]:', msg.event);
                
                if (msg.event === 'init') {
                    initReceived = true;
                    console.log('[draw.io] init received, loading diagram...');
                    sendToDrawio({
                        action: 'load',
                        xml: diagramXml,
                        autosave: 0
                    });
                } else if (msg.event === 'load') {
                    loadReceived = true;
                    console.log('[draw.io] load received, exporting SVG...');
                    // Small delay to ensure render is complete
                    setTimeout(() => {
                        sendToDrawio({
                            action: 'export',
                            format: 'svg'
                        });
                    }, 500);
                } else if (msg.event === 'export' && msg.data) {
                    console.log('[draw.io] export received, SVG length:', msg.data.length);
                    // Dispatch result event
                    window.dispatchEvent(new CustomEvent('DRAWIO_RESULT', {
                        detail: { success: true, data: msg.data }
                    }));
                }
            } catch (err) {
                // Ignore non-JSON messages
            }
        });
        
        // Fallback timeout check
        setTimeout(() => {
            if (!initReceived) {
                console.error('[draw.io] No init received after 30s');
                window.dispatchEvent(new CustomEvent('DRAWIO_RESULT', {
                    detail: { success: false, error: 'draw.io init timeout' }
                }));
            }
        }, 30000);
    </script>
</body>
</html>`
    }

    /**
     * Embed drawio XML in SVG for editable .drawio.svg format
     */
    private embedXmlInSvg(svg: string, xml: string): string {
        // Encode the XML as base64 for embedding
        const encodedXml = Buffer.from(xml).toString("base64")

        // Insert the content attribute into the SVG root element
        // draw.io uses content="..." attribute to store the diagram data
        if (svg.startsWith("<svg")) {
            const insertPos = svg.indexOf(">")
            if (insertPos > 0) {
                return (
                    svg.slice(0, insertPos) +
                    ` content="${encodedXml}"` +
                    svg.slice(insertPos)
                )
            }
        }

        return svg
    }

    /**
     * Shutdown the browser instance
     */
    async shutdown(): Promise<void> {
        if (this.browser) {
            log.info("Shutting down Puppeteer browser...")
            await this.browser.close()
            this.browser = null
            this.initPromise = null
            log.info("Puppeteer browser closed")
        }
    }

    /**
     * Check if browser is initialized
     */
    isInitialized(): boolean {
        return this.browser !== null
    }
}

// Export singleton instance
export const svgRenderer = new SvgRenderer()
