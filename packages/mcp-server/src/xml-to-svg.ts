/**
 * XML to SVG Converter
 * Converts mxGraphModel XML to SVG without browser dependency
 *
 * This is a simplified converter that handles basic shapes and connections.
 * For complex diagrams with custom shapes, browser-based export is recommended.
 */

import { DOMParser } from "linkedom"

interface Point {
    x: number
    y: number
}

interface CellGeometry {
    x: number
    y: number
    width: number
    height: number
    sourcePoint?: Point
    targetPoint?: Point
    points?: Point[]
}

interface ParsedCell {
    id: string
    value: string
    style: Record<string, string>
    geometry?: CellGeometry
    isVertex: boolean
    isEdge: boolean
    parent: string
    source?: string
    target?: string
}

/**
 * Parse style string into key-value pairs
 */
function parseStyle(styleStr: string): Record<string, string> {
    const style: Record<string, string> = {}
    if (!styleStr) return style

    const parts = styleStr.split(";").filter((p) => p.trim())
    for (const part of parts) {
        const [key, value] = part.split("=")
        if (key) {
            style[key.trim()] = value?.trim() || "1"
        }
    }
    return style
}

/**
 * Parse mxGeometry element
 */
function parseGeometry(geoElement: Element | null): CellGeometry | undefined {
    if (!geoElement) return undefined

    const geo: CellGeometry = {
        x: parseFloat(geoElement.getAttribute("x") || "0"),
        y: parseFloat(geoElement.getAttribute("y") || "0"),
        width: parseFloat(geoElement.getAttribute("width") || "0"),
        height: parseFloat(geoElement.getAttribute("height") || "0"),
    }

    // Parse source/target points for edges
    const sourcePoint = geoElement.querySelector('mxPoint[as="sourcePoint"]')
    const targetPoint = geoElement.querySelector('mxPoint[as="targetPoint"]')

    if (sourcePoint) {
        geo.sourcePoint = {
            x: parseFloat(sourcePoint.getAttribute("x") || "0"),
            y: parseFloat(sourcePoint.getAttribute("y") || "0"),
        }
    }

    if (targetPoint) {
        geo.targetPoint = {
            x: parseFloat(targetPoint.getAttribute("x") || "0"),
            y: parseFloat(targetPoint.getAttribute("y") || "0"),
        }
    }

    // Parse waypoints
    const points = geoElement.querySelectorAll('Array[as="points"] mxPoint')
    if (points.length > 0) {
        geo.points = Array.from(points).map((p) => ({
            x: parseFloat(p.getAttribute("x") || "0"),
            y: parseFloat(p.getAttribute("y") || "0"),
        }))
    }

    return geo
}

/**
 * Parse mxCell element
 */
function parseCell(cellElement: Element): ParsedCell {
    const styleStr = cellElement.getAttribute("style") || ""
    const geoElement = cellElement.querySelector("mxGeometry")

    return {
        id: cellElement.getAttribute("id") || "",
        value: cellElement.getAttribute("value") || "",
        style: parseStyle(styleStr),
        geometry: parseGeometry(geoElement),
        isVertex: cellElement.getAttribute("vertex") === "1",
        isEdge: cellElement.getAttribute("edge") === "1",
        parent: cellElement.getAttribute("parent") || "1",
        source: cellElement.getAttribute("source") || undefined,
        target: cellElement.getAttribute("target") || undefined,
    }
}

/**
 * Convert hex color to SVG-compatible format
 */
function normalizeColor(color: string | undefined, defaultColor: string): string {
    if (!color || color === "none") return defaultColor
    if (color.startsWith("#")) return color
    // Handle named colors or other formats
    return color
}

/**
 * Determine if a color is dark (for choosing contrasting text color)
 */
function isDarkColor(color: string): boolean {
    if (!color || color === "none" || !color.startsWith("#")) return false
    
    // Parse hex color
    let hex = color.slice(1)
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
    }
    
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    
    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance < 0.5
}

/**
 * Escape HTML/XML entities in text
 */
function escapeXml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
}

/**
 * Encode string to HTML entities (for draw.io .drawio.svg compatibility)
 * Draw.io uses HTML entities (&lt;, &gt;, etc.) instead of URL encoding (%3C, etc.)
 */
function htmlEncode(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
}

/**
 * Generate SVG path for an edge
 */
function generateEdgePath(
    cell: ParsedCell,
    cells: Map<string, ParsedCell>
): string {
    const geo = cell.geometry
    if (!geo) return ""

    const style = cell.style
    let startX = 0,
        startY = 0,
        endX = 0,
        endY = 0

    // Get exit/entry positions from style (0-1 range, relative to shape)
    const exitX = parseFloat(style.exitX || "0.5")
    const exitY = parseFloat(style.exitY || "0.5")
    const entryX = parseFloat(style.entryX || "0.5")
    const entryY = parseFloat(style.entryY || "0.5")

    // Get source position
    if (cell.source && cells.has(cell.source)) {
        const sourceCell = cells.get(cell.source)!
        if (sourceCell.geometry) {
            const sg = sourceCell.geometry
            startX = sg.x + sg.width * exitX
            startY = sg.y + sg.height * exitY
        }
    } else if (geo.sourcePoint) {
        startX = geo.sourcePoint.x
        startY = geo.sourcePoint.y
    }

    // Get target position
    if (cell.target && cells.has(cell.target)) {
        const targetCell = cells.get(cell.target)!
        if (targetCell.geometry) {
            const tg = targetCell.geometry
            endX = tg.x + tg.width * entryX
            endY = tg.y + tg.height * entryY
        }
    } else if (geo.targetPoint) {
        endX = geo.targetPoint.x
        endY = geo.targetPoint.y
    }

    // Check if orthogonal edge style
    const isOrthogonal = style.edgeStyle === "orthogonalEdgeStyle" || 
                         style.edgeStyle === "elbowEdgeStyle" ||
                         style.orthogonal === "1"

    // Build path
    let path = `M ${startX} ${startY}`

    if (geo.points && geo.points.length > 0) {
        // Use explicit waypoints
        for (const point of geo.points) {
            path += ` L ${point.x} ${point.y}`
        }
    } else if (isOrthogonal && (startX !== endX && startY !== endY)) {
        // Generate orthogonal path (right-angle turns)
        // Determine routing direction based on exit/entry points
        
        // exitX=1 means exiting from right, exitX=0 means exiting from left
        // entryX=0 means entering from left, entryX=1 means entering from right
        // exitY=0.5 means horizontal exit, exitY=0 or 1 means vertical tendency
        
        const horizontalFirst = exitX === 1 || exitX === 0 || Math.abs(exitX - 0.5) > Math.abs(exitY - 0.5)
        
        if (horizontalFirst) {
            // Go horizontal first, then vertical
            const midX = (startX + endX) / 2
            
            // If source exits from right (exitX=1) and target enters from left (entryX=0)
            // Simple horizontal then vertical routing
            if (exitX >= 0.5 && entryX <= 0.5) {
                path += ` L ${midX} ${startY}`
                path += ` L ${midX} ${endY}`
            } else if (exitX <= 0.5 && entryX >= 0.5) {
                // Exiting left, entering right
                path += ` L ${midX} ${startY}`
                path += ` L ${midX} ${endY}`
            } else {
                // Same side connection - need extra bend
                const offset = 20
                if (exitX >= 0.5) {
                    path += ` L ${Math.max(startX, endX) + offset} ${startY}`
                    path += ` L ${Math.max(startX, endX) + offset} ${endY}`
                } else {
                    path += ` L ${Math.min(startX, endX) - offset} ${startY}`
                    path += ` L ${Math.min(startX, endX) - offset} ${endY}`
                }
            }
        } else {
            // Go vertical first, then horizontal
            const midY = (startY + endY) / 2
            
            if (exitY >= 0.5 && entryY <= 0.5) {
                path += ` L ${startX} ${midY}`
                path += ` L ${endX} ${midY}`
            } else if (exitY <= 0.5 && entryY >= 0.5) {
                path += ` L ${startX} ${midY}`
                path += ` L ${endX} ${midY}`
            } else {
                const offset = 20
                if (exitY >= 0.5) {
                    path += ` L ${startX} ${Math.max(startY, endY) + offset}`
                    path += ` L ${endX} ${Math.max(startY, endY) + offset}`
                } else {
                    path += ` L ${startX} ${Math.min(startY, endY) - offset}`
                    path += ` L ${endX} ${Math.min(startY, endY) - offset}`
                }
            }
        }
    }

    path += ` L ${endX} ${endY}`

    return path
}

/**
 * Generate SVG for a vertex (shape)
 */
function generateVertexSvg(cell: ParsedCell): string {
    const geo = cell.geometry
    if (!geo) return ""

    const style = cell.style
    const fillColor = normalizeColor(style.fillColor, "#ffffff")
    const strokeColor = normalizeColor(style.strokeColor, "#000000")
    const strokeWidth = parseFloat(style.strokeWidth || "1")
    const rounded = style.rounded === "1"
    const rx = rounded ? Math.min(geo.width, geo.height) * 0.1 : 0

    const opacity = style.opacity ? parseFloat(style.opacity) / 100 : 1
    const fillOpacity = style.fillOpacity ? parseFloat(style.fillOpacity) / 100 : opacity
    const strokeOpacity = style.strokeOpacity ? parseFloat(style.strokeOpacity) / 100 : opacity

    let shapeSvg = ""

    // Determine shape type
    if (style.ellipse === "1" || style.shape === "ellipse") {
        const cx = geo.x + geo.width / 2
        const cy = geo.y + geo.height / 2
        const rx = geo.width / 2
        const ry = geo.height / 2
        shapeSvg = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" `
        shapeSvg += `fill="${fillColor}" fill-opacity="${fillOpacity}" `
        shapeSvg += `stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"/>`
    } else if (style.shape === "rhombus" || style.rhombus === "1") {
        const cx = geo.x + geo.width / 2
        const cy = geo.y + geo.height / 2
        const points = `${cx},${geo.y} ${geo.x + geo.width},${cy} ${cx},${geo.y + geo.height} ${geo.x},${cy}`
        shapeSvg = `<polygon points="${points}" `
        shapeSvg += `fill="${fillColor}" fill-opacity="${fillOpacity}" `
        shapeSvg += `stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"/>`
    } else if (style.shape === "triangle") {
        const points = `${geo.x + geo.width / 2},${geo.y} ${geo.x + geo.width},${geo.y + geo.height} ${geo.x},${geo.y + geo.height}`
        shapeSvg = `<polygon points="${points}" `
        shapeSvg += `fill="${fillColor}" fill-opacity="${fillOpacity}" `
        shapeSvg += `stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"/>`
    } else if (style.shape === "cylinder" || style.shape === "cylinder3") {
        // Simplified cylinder as rectangle with rounded top/bottom
        shapeSvg = `<rect x="${geo.x}" y="${geo.y}" width="${geo.width}" height="${geo.height}" rx="${geo.width * 0.3}" `
        shapeSvg += `fill="${fillColor}" fill-opacity="${fillOpacity}" `
        shapeSvg += `stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"/>`
    } else {
        // Default rectangle
        shapeSvg = `<rect x="${geo.x}" y="${geo.y}" width="${geo.width}" height="${geo.height}" rx="${rx}" `
        shapeSvg += `fill="${fillColor}" fill-opacity="${fillOpacity}" `
        shapeSvg += `stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"/>`
    }

    // Add text label
    if (cell.value) {
        const textX = geo.x + geo.width / 2
        const textY = geo.y + geo.height / 2
        const fontSize = parseFloat(style.fontSize || "12")
        // Use explicit fontColor if set, otherwise choose based on background
        let fontColor = style.fontColor
        if (!fontColor || fontColor === "none") {
            fontColor = isDarkColor(fillColor) ? "#FFFFFF" : "#000000"
        }
        const fontStyle = style.fontStyle || "0"
        const fontWeight = parseInt(fontStyle) & 1 ? "bold" : "normal"
        const fontStyleAttr = parseInt(fontStyle) & 2 ? "italic" : "normal"

        // Handle multi-line text by splitting on newlines and HTML entities
        // Draw.io uses &#xa; or \n for line breaks
        let textValue = cell.value
            .replace(/&#xa;/gi, "\n")
            .replace(/&#10;/gi, "\n")
            .replace(/<br\s*\/?>/gi, "\n")
        const lines = textValue.split("\n").filter(line => line.trim())

        if (lines.length === 1) {
            // Single line text
            shapeSvg += `<text x="${textX}" y="${textY}" `
            shapeSvg += `font-family="Arial, sans-serif" font-size="${fontSize}" `
            shapeSvg += `font-weight="${fontWeight}" font-style="${fontStyleAttr}" `
            shapeSvg += `fill="${fontColor}" text-anchor="middle" dominant-baseline="central">`
            shapeSvg += escapeXml(lines[0])
            shapeSvg += `</text>`
        } else {
            // Multi-line text using tspan elements
            const lineHeight = fontSize * 1.2
            const totalHeight = (lines.length - 1) * lineHeight
            const startY = textY - totalHeight / 2

            shapeSvg += `<text x="${textX}" y="${startY}" `
            shapeSvg += `font-family="Arial, sans-serif" font-size="${fontSize}" `
            shapeSvg += `font-weight="${fontWeight}" font-style="${fontStyleAttr}" `
            shapeSvg += `fill="${fontColor}" text-anchor="middle">`
            
            for (let i = 0; i < lines.length; i++) {
                const dy = i === 0 ? 0 : lineHeight
                shapeSvg += `<tspan x="${textX}" dy="${dy}">${escapeXml(lines[i])}</tspan>`
            }
            shapeSvg += `</text>`
        }
    }

    return shapeSvg
}

/**
 * Check if arrow type is open (not filled)
 */
function isOpenArrow(arrowType: string): boolean {
    return arrowType === "open" || arrowType === "openThin" || 
           arrowType === "dash" || arrowType === "cross" ||
           arrowType === "ERone" || arrowType === "ERmany"
}

/**
 * Generate arrow path at a specific point with direction
 * Draw.io style: arrows are separate path elements, not SVG markers
 * Arrow size is fixed (not scaled by strokeWidth)
 */
function generateArrowPath(
    arrowType: string,
    tipX: number,
    tipY: number,
    fromX: number,
    fromY: number,
    strokeColor: string,
    strokeWidth: number,
    filled: boolean = true
): string {
    if (!arrowType || arrowType === "none") return ""
    
    // Calculate direction angle
    const angle = Math.atan2(tipY - fromY, tipX - fromX)
    
    // Arrow size - fixed size like draw.io (approximately 6 pixels for the arrow)
    const arrowLength = 6
    const arrowWidth = 4
    
    // Calculate arrow points
    // The arrow tip is at (tipX, tipY)
    // We need to calculate the back points of the arrow
    const backX = tipX - arrowLength * Math.cos(angle)
    const backY = tipY - arrowLength * Math.sin(angle)
    
    // Perpendicular offset for arrow width
    const perpX = arrowWidth * Math.cos(angle + Math.PI / 2)
    const perpY = arrowWidth * Math.sin(angle + Math.PI / 2)
    
    const isOpen = isOpenArrow(arrowType)
    
    let arrowPath = ""
    
    switch (arrowType) {
        case "classic":
        case "classicThin": {
            // Classic arrow with notch (like draw.io default)
            // M tipX tipY L back-left L notch L back-right Z
            const notchDepth = arrowLength * 0.3
            const notchX = tipX - (arrowLength - notchDepth) * Math.cos(angle)
            const notchY = tipY - (arrowLength - notchDepth) * Math.sin(angle)
            
            arrowPath = `<path d="M ${tipX} ${tipY} L ${backX - perpX} ${backY - perpY} L ${notchX} ${notchY} L ${backX + perpX} ${backY + perpY} Z" `
            arrowPath += `fill="${strokeColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-miterlimit="10"/>`
            break
        }
        case "open":
        case "openThin": {
            // Open arrow (V shape, not filled)
            arrowPath = `<path d="M ${backX - perpX} ${backY - perpY} L ${tipX} ${tipY} L ${backX + perpX} ${backY + perpY}" `
            arrowPath += `fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-miterlimit="10"/>`
            break
        }
        case "block":
        case "blockThin": {
            // Block arrow (simple filled triangle)
            arrowPath = `<path d="M ${tipX} ${tipY} L ${backX - perpX} ${backY - perpY} L ${backX + perpX} ${backY + perpY} Z" `
            arrowPath += `fill="${strokeColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-miterlimit="10"/>`
            break
        }
        case "oval":
        case "circle": {
            // Circle/oval at the end
            const r = arrowWidth
            const cx = backX
            const cy = backY
            arrowPath = `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r}" `
            if (filled) {
                arrowPath += `fill="${strokeColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`
            } else {
                arrowPath += `fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`
            }
            break
        }
        case "diamond":
        case "diamondThin": {
            // Diamond shape
            const halfLen = arrowLength / 2
            const midX = tipX - halfLen * Math.cos(angle)
            const midY = tipY - halfLen * Math.sin(angle)
            const farX = tipX - arrowLength * Math.cos(angle)
            const farY = tipY - arrowLength * Math.sin(angle)
            
            arrowPath = `<path d="M ${tipX} ${tipY} L ${midX - perpX} ${midY - perpY} L ${farX} ${farY} L ${midX + perpX} ${midY + perpY} Z" `
            arrowPath += `fill="${strokeColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-miterlimit="10"/>`
            break
        }
        default: {
            // Default to classic arrow
            const notchDepth = arrowLength * 0.3
            const notchX = tipX - (arrowLength - notchDepth) * Math.cos(angle)
            const notchY = tipY - (arrowLength - notchDepth) * Math.sin(angle)
            
            arrowPath = `<path d="M ${tipX} ${tipY} L ${backX - perpX} ${backY - perpY} L ${notchX} ${notchY} L ${backX + perpX} ${backY + perpY} Z" `
            arrowPath += `fill="${strokeColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-miterlimit="10"/>`
            break
        }
    }
    
    return arrowPath
}

/**
 * Parse path string to get points
 */
function parsePathPoints(pathD: string): Point[] {
    const points: Point[] = []
    const commands = pathD.match(/[ML]\s*[\d.-]+\s*[\d.-]+/g)
    if (commands) {
        for (const cmd of commands) {
            const nums = cmd.match(/[\d.-]+/g)
            if (nums && nums.length >= 2) {
                points.push({ x: parseFloat(nums[0]), y: parseFloat(nums[1]) })
            }
        }
    }
    // Also handle Q (quadratic) commands for curved paths
    const qCommands = pathD.match(/Q\s*[\d.-]+\s*[\d.-]+\s*[\d.-]+\s*[\d.-]+/g)
    if (qCommands) {
        for (const cmd of qCommands) {
            const nums = cmd.match(/[\d.-]+/g)
            if (nums && nums.length >= 4) {
                // End point of quadratic curve
                points.push({ x: parseFloat(nums[2]), y: parseFloat(nums[3]) })
            }
        }
    }
    return points
}

/**
 * Generate SVG for an edge (connection)
 * Uses draw.io style: arrows are separate path elements (not SVG markers)
 */
function generateEdgeSvg(
    cell: ParsedCell,
    cells: Map<string, ParsedCell>
): string {
    const style = cell.style
    const strokeColor = normalizeColor(style.strokeColor, "#000000")
    const strokeWidth = parseFloat(style.strokeWidth || "1")
    const dashed = style.dashed === "1"
    const dashPattern = style.dashPattern || "3 3"
    const opacity = style.opacity ? parseFloat(style.opacity) / 100 : 1
    
    // Rounded corners for orthogonal edges
    const rounded = style.rounded === "1"

    const path = generateEdgePath(cell, cells)
    if (!path) return ""

    // Parse path to get start and end points for arrows
    const pathPoints = parsePathPoints(path)
    
    // Build SVG elements
    const svgParts: string[] = []
    
    // Build the edge path (line)
    let edgePath = `<path d="${path}" `
    edgePath += `fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" `
    edgePath += `stroke-miterlimit="10" `
    
    if (opacity !== 1) {
        edgePath += `stroke-opacity="${opacity}" `
    }
    
    if (dashed) {
        // Support custom dash patterns
        const dashParts = dashPattern.split(" ").map(p => parseFloat(p) * strokeWidth)
        edgePath += `stroke-dasharray="${dashParts.join(" ")}" `
    }
    
    edgePath += `pointer-events="stroke"/>`
    svgParts.push(edgePath)
    
    // Generate arrows as separate path elements (draw.io style)
    const startArrow = style.startArrow
    const endArrow = style.endArrow
    
    // End arrow
    if (endArrow && endArrow !== "none" && pathPoints.length >= 2) {
        const endPoint = pathPoints[pathPoints.length - 1]
        const prevPoint = pathPoints[pathPoints.length - 2]
        const endFill = style.endFill !== "0"
        const arrowSvg = generateArrowPath(
            endArrow, 
            endPoint.x, endPoint.y,
            prevPoint.x, prevPoint.y,
            strokeColor, strokeWidth, endFill
        )
        if (arrowSvg) {
            svgParts.push(arrowSvg)
        }
    }
    
    // Start arrow
    if (startArrow && startArrow !== "none" && pathPoints.length >= 2) {
        const startPoint = pathPoints[0]
        const nextPoint = pathPoints[1]
        const startFill = style.startFill !== "0"
        const arrowSvg = generateArrowPath(
            startArrow,
            startPoint.x, startPoint.y,
            nextPoint.x, nextPoint.y,
            strokeColor, strokeWidth, startFill
        )
        if (arrowSvg) {
            svgParts.push(arrowSvg)
        }
    }

    // Add edge label
    if (cell.value) {
        const geo = cell.geometry
        let labelX = 0,
            labelY = 0

        // Calculate label position (center of edge)
        if (geo?.sourcePoint && geo?.targetPoint) {
            labelX = (geo.sourcePoint.x + geo.targetPoint.x) / 2
            labelY = (geo.sourcePoint.y + geo.targetPoint.y) / 2
        } else if (cell.source && cell.target && cells.has(cell.source) && cells.has(cell.target)) {
            const sourceCell = cells.get(cell.source)!
            const targetCell = cells.get(cell.target)!
            if (sourceCell.geometry && targetCell.geometry) {
                const sg = sourceCell.geometry
                const tg = targetCell.geometry
                // Use exit/entry points for more accurate label positioning
                const exitX = parseFloat(style.exitX || "0.5")
                const exitY = parseFloat(style.exitY || "0.5")
                const entryX = parseFloat(style.entryX || "0.5")
                const entryY = parseFloat(style.entryY || "0.5")
                
                const startX = sg.x + sg.width * exitX
                const startY = sg.y + sg.height * exitY
                const endX = tg.x + tg.width * entryX
                const endY = tg.y + tg.height * entryY
                
                labelX = (startX + endX) / 2
                labelY = (startY + endY) / 2
            }
        }

        if (labelX > 0 || labelY > 0) {
            const fontSize = parseFloat(style.fontSize || "11")
            const fontColor = normalizeColor(style.fontColor, "#000000")
            const labelBgColor = style.labelBackgroundColor
            const labelBorderColor = style.labelBorderColor
            const fontFamily = style.fontFamily || "Helvetica, sans-serif"
            const fontStyle = style.fontStyle || "0"
            const fontWeight = parseInt(fontStyle) & 1 ? "bold" : "normal"
            const fontStyleAttr = parseInt(fontStyle) & 2 ? "italic" : "normal"
            
            // Handle multi-line text
            let textValue = cell.value
                .replace(/&#xa;/gi, "\n")
                .replace(/&#10;/gi, "\n")
                .replace(/<br\s*\/?>/gi, "\n")
            const lines = textValue.split("\n").filter(line => line.trim())

            // Add label background if specified
            if (labelBgColor && labelBgColor !== "none") {
                const padding = 4
                const lineHeight = fontSize * 1.2
                const textWidth = Math.max(...lines.map(l => l.length)) * fontSize * 0.6
                const textHeight = lines.length * lineHeight
                
                let bgSvg = `<rect x="${labelX - textWidth/2 - padding}" y="${labelY - textHeight/2 - padding}" `
                bgSvg += `width="${textWidth + padding*2}" height="${textHeight + padding*2}" `
                bgSvg += `fill="${labelBgColor}" `
                if (labelBorderColor && labelBorderColor !== "none") {
                    bgSvg += `stroke="${labelBorderColor}" stroke-width="1" `
                }
                bgSvg += `/>`
                svgParts.push(bgSvg)
            }

            if (lines.length === 1) {
                let textSvg = `<text x="${labelX}" y="${labelY}" `
                textSvg += `font-family="${fontFamily}" font-size="${fontSize}" `
                textSvg += `font-weight="${fontWeight}" font-style="${fontStyleAttr}" `
                textSvg += `fill="${fontColor}" text-anchor="middle" dominant-baseline="central">`
                textSvg += escapeXml(lines[0])
                textSvg += `</text>`
                svgParts.push(textSvg)
            } else {
                const lineHeight = fontSize * 1.2
                const totalHeight = (lines.length - 1) * lineHeight
                const startY = labelY - totalHeight / 2

                let textSvg = `<text x="${labelX}" y="${startY}" `
                textSvg += `font-family="${fontFamily}" font-size="${fontSize}" `
                textSvg += `font-weight="${fontWeight}" font-style="${fontStyleAttr}" `
                textSvg += `fill="${fontColor}" text-anchor="middle">`
                
                for (let i = 0; i < lines.length; i++) {
                    const dy = i === 0 ? 0 : lineHeight
                    textSvg += `<tspan x="${labelX}" dy="${dy}">${escapeXml(lines[i])}</tspan>`
                }
                textSvg += `</text>`
                svgParts.push(textSvg)
            }
        }
    }

    return svgParts.join("\n  ")
}

export interface XmlToSvgOptions {
    /**
     * If true, embed the original draw.io XML into the SVG file.
     * This creates a .drawio.svg file that can be opened and edited in draw.io.
     * Default: false
     */
    embedXml?: boolean
}

/**
 * Convert mxGraphModel XML to SVG
 * @param xml - The mxGraphModel XML content
 * @param options - Conversion options
 */
export function xmlToSvg(xml: string, options: XmlToSvgOptions = {}): string {
    const { embedXml = false } = options
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, "text/xml")

    // Find the mxGraphModel (may be wrapped in mxfile/diagram)
    let graphModel = doc.querySelector("mxGraphModel")
    let originalXml = xml // Keep original XML for embedding

    if (!graphModel) {
        // Try to find in mxfile structure
        const diagram = doc.querySelector("diagram")
        if (diagram) {
            // The diagram content might be base64 encoded or plain XML
            const content = diagram.textContent?.trim() || ""
            if (content) {
                try {
                    // Try base64 decode
                    const decoded = Buffer.from(content, "base64").toString("utf-8")
                    const innerDoc = parser.parseFromString(decoded, "text/xml")
                    graphModel = innerDoc.querySelector("mxGraphModel")
                } catch {
                    // Not base64, try direct parse
                    const innerDoc = parser.parseFromString(content, "text/xml")
                    graphModel = innerDoc.querySelector("mxGraphModel")
                }
            }
        }
    }

    if (!graphModel) {
        throw new Error("No mxGraphModel found in XML")
    }

    // Parse all cells
    const cellElements = graphModel.querySelectorAll("mxCell")
    const cells = new Map<string, ParsedCell>()

    for (const cellEl of cellElements) {
        const cell = parseCell(cellEl)
        cells.set(cell.id, cell)
    }

    // Calculate bounding box
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity

    for (const cell of cells.values()) {
        if (cell.geometry && (cell.isVertex || cell.isEdge)) {
            const geo = cell.geometry
            minX = Math.min(minX, geo.x)
            minY = Math.min(minY, geo.y)
            maxX = Math.max(maxX, geo.x + geo.width)
            maxY = Math.max(maxY, geo.y + geo.height)

            // Also consider edge points
            if (geo.sourcePoint) {
                minX = Math.min(minX, geo.sourcePoint.x)
                minY = Math.min(minY, geo.sourcePoint.y)
                maxX = Math.max(maxX, geo.sourcePoint.x)
                maxY = Math.max(maxY, geo.sourcePoint.y)
            }
            if (geo.targetPoint) {
                minX = Math.min(minX, geo.targetPoint.x)
                minY = Math.min(minY, geo.targetPoint.y)
                maxX = Math.max(maxX, geo.targetPoint.x)
                maxY = Math.max(maxY, geo.targetPoint.y)
            }
        }
    }

    // Add padding
    const padding = 20
    minX = Math.max(0, minX - padding)
    minY = Math.max(0, minY - padding)
    maxX += padding
    maxY += padding

    const width = maxX - minX
    const height = maxY - minY

    // Generate SVG content
    const svgParts: string[] = []

    // Add vertices (shapes) first
    for (const cell of cells.values()) {
        if (cell.isVertex && cell.id !== "0" && cell.id !== "1") {
            svgParts.push(generateVertexSvg(cell))
        }
    }

    // Add edges (connections) after
    for (const cell of cells.values()) {
        if (cell.isEdge) {
            svgParts.push(generateEdgeSvg(cell, cells))
        }
    }

    // Build final SVG
    const svgContent = svgParts.join("\n  ")

    // Prepare embedded XML content if requested
    let contentAttribute = ""
    let hasXmlDeclaration = true
    let hasDoctype = true
    let svgHeaderAttributes = ""

    if (embedXml) {
        // Wrap XML in mxfile format if not already
        let mxfileXml = originalXml
        if (!originalXml.includes("<mxfile")) {
            // Create mxfile wrapper with mxGraphModel
            mxfileXml = `<mxfile host="mcp-server"><diagram id="d1" name="Page-1">${originalXml}</diagram></mxfile>`
        }
        // Encode to HTML entities (draw.io format uses &lt;, &gt;, etc.)
        // The content attribute must be on the <svg> tag itself, not as a child element
        const encodedXml = htmlEncode(mxfileXml)
        contentAttribute = ` content="${encodedXml}"`

        // draw.io native format doesn't include XML declaration or DOCTYPE
        hasXmlDeclaration = false
        hasDoctype = false

        // Add style attribute for background transparency
        svgHeaderAttributes = ' style="background-color: transparent;"'
    }


    const xmlDeclaration = hasXmlDeclaration ? `<?xml version="1.0" encoding="UTF-8"?>\n` : ""
    const doctypeDeclaration = hasDoctype ? `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n` : ""

    // Build SVG with proper structure (draw.io style - no defs needed, arrows are inline paths)
    // Note: For draw.io compatible .drawio.svg, the content attribute must be on the <svg> element
    const svg = `${xmlDeclaration}${doctypeDeclaration}<svg xmlns="http://www.w3.org/2000/svg"${svgHeaderAttributes} xmlns:xlink="http://www.w3.org/1999/xlink"${embedXml ? ' version="1.1"' : ''}${contentAttribute} width="${width}px" height="${height}px" viewBox="${minX - 0.5} ${minY - 0.5} ${width} ${height}"><defs/><g>${svgContent}</g></svg>
`
    return svg
}

/**
 * Use official draw.io CLI for high-fidelity SVG export
 * Requires draw.io desktop to be installed on the system
 * 
 * Installation:
 * - Linux: Download AppImage from https://github.com/jgraph/drawio-desktop/releases
 *          chmod +x drawio-x86_64-*.AppImage
 *          sudo mv drawio-x86_64-*.AppImage /usr/local/bin/drawio
 * - macOS: brew install --cask drawio
 * - Windows: Download installer from https://github.com/jgraph/drawio-desktop/releases
 * 
 * For headless server (no display), install xvfb:
 *   sudo apt-get install xvfb
 *   xvfb-run drawio --export ...
 */

import { exec } from "child_process"
import { promisify } from "util"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const execAsync = promisify(exec)

export interface DrawioCliOptions {
    /** Input .drawio file path */
    inputPath: string
    /** Output file path */
    outputPath: string
    /** Output format: svg, png, pdf, etc. */
    format?: "svg" | "png" | "pdf" | "jpg" | "vsdx"
    /** Page index to export (0-based), or export all pages if not specified */
    pageIndex?: number
    /** Scale factor for PNG/JPG export */
    scale?: number
    /** Width for PNG/JPG export */
    width?: number
    /** Height for PNG/JPG export */
    height?: number
    /** Border width in pixels */
    border?: number
    /** Transparent background (for PNG) */
    transparent?: boolean
    /** Embed diagram data for SVG (creates .drawio.svg) */
    embedDiagram?: boolean
    /** Custom path to drawio executable */
    drawioPath?: string
    /** Use xvfb-run for headless server */
    useXvfb?: boolean
}

/**
 * Find the draw.io executable on the system
 */
async function findDrawioExecutable(): Promise<string | null> {
    const possiblePaths = [
        // Linux
        "/usr/local/bin/drawio",
        "/usr/bin/drawio",
        "/opt/drawio/drawio",
        `${os.homedir()}/Applications/drawio`,
        // Common AppImage location
        "/usr/local/bin/drawio-x86_64.AppImage",
        // macOS
        "/Applications/draw.io.app/Contents/MacOS/draw.io",
        // Windows (check PATH)
        "drawio",
        "draw.io",
    ]

    for (const execPath of possiblePaths) {
        try {
            // Try to run with --version to check if it exists
            await execAsync(`"${execPath}" --version`, { timeout: 5000 })
            return execPath
        } catch {
            // Try without quotes for PATH lookup
            if (!execPath.includes("/")) {
                try {
                    await execAsync(`${execPath} --version`, { timeout: 5000 })
                    return execPath
                } catch {
                    continue
                }
            }
            continue
        }
    }
    return null
}

/**
 * Check if xvfb-run is available for headless operation
 */
async function isXvfbAvailable(): Promise<boolean> {
    try {
        await execAsync("which xvfb-run", { timeout: 2000 })
        return true
    } catch {
        return false
    }
}

/**
 * Export using official draw.io CLI
 * Returns true if successful, throws error if failed
 */
export async function exportWithDrawioCli(options: DrawioCliOptions): Promise<boolean> {
    const {
        inputPath,
        outputPath,
        format = "svg",
        pageIndex,
        scale,
        width,
        height,
        border,
        transparent,
        embedDiagram,
        drawioPath,
        useXvfb,
    } = options

    // Find draw.io executable
    let execPath: string | undefined = drawioPath
    if (!execPath) {
        const foundPath = await findDrawioExecutable()
        if (!foundPath) {
            throw new Error(
                "draw.io desktop not found. Please install it:\n" +
                "  Linux: Download AppImage from https://github.com/jgraph/drawio-desktop/releases\n" +
                "  macOS: brew install --cask drawio\n" +
                "  Windows: Download installer from releases page"
            )
        }
        execPath = foundPath
    }

    // Check if we need xvfb for headless operation
    const needsXvfb = useXvfb ?? (process.platform === "linux" && !process.env.DISPLAY)
    if (needsXvfb && !(await isXvfbAvailable())) {
        throw new Error(
            "xvfb-run not found. For headless operation, install xvfb:\n" +
            "  sudo apt-get install xvfb"
        )
    }

    // Build command arguments
    const args: string[] = [
        "--export",
        `--format=${format}`,
        `--output="${outputPath}"`,
    ]

    if (pageIndex !== undefined) {
        args.push(`--page-index=${pageIndex}`)
    }
    if (scale !== undefined) {
        args.push(`--scale=${scale}`)
    }
    if (width !== undefined) {
        args.push(`--width=${width}`)
    }
    if (height !== undefined) {
        args.push(`--height=${height}`)
    }
    if (border !== undefined) {
        args.push(`--border=${border}`)
    }
    if (transparent) {
        args.push("--transparent")
    }
    if (embedDiagram) {
        args.push("--embed-diagram")
    }

    // Add input file
    args.push(`"${inputPath}"`)

    // Build full command
    let command = `"${execPath}" ${args.join(" ")}`
    if (needsXvfb) {
        command = `xvfb-run -a ${command}`
    }

    // Execute export
    try {
        const { stdout, stderr } = await execAsync(command, {
            timeout: 60000, // 60 second timeout
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        })

        // Check if output file was created
        if (!fs.existsSync(outputPath)) {
            throw new Error(`Export failed: output file not created. stderr: ${stderr}`)
        }

        return true
    } catch (error: any) {
        throw new Error(`draw.io export failed: ${error.message}\nCommand: ${command}`)
    }
}

/**
 * Check if draw.io CLI is available on the system
 */
export async function isDrawioCliAvailable(): Promise<{
    available: boolean
    path?: string
    version?: string
    xvfbAvailable?: boolean
}> {
    const execPath = await findDrawioExecutable()
    if (!execPath) {
        return { available: false }
    }

    try {
        const { stdout } = await execAsync(`"${execPath}" --version`, { timeout: 5000 })
        const xvfbAvailable = await isXvfbAvailable()
        return {
            available: true,
            path: execPath,
            version: stdout.trim(),
            xvfbAvailable,
        }
    } catch {
        return { available: false }
    }
}

/**
 * Export .drawio file to SVG using the best available method
 * Prefers official draw.io CLI for high fidelity, falls back to simplified converter
 */
export async function exportDrawioToSvg(
    inputPath: string,
    outputPath: string,
    options: {
        embedXml?: boolean
        preferCli?: boolean
        useXvfb?: boolean
    } = {}
): Promise<{ method: "cli" | "simplified"; success: boolean }> {
    const { embedXml = false, preferCli = true, useXvfb } = options

    // Try CLI first if preferred
    if (preferCli) {
        try {
            await exportWithDrawioCli({
                inputPath,
                outputPath,
                format: "svg",
                embedDiagram: embedXml,
                useXvfb,
            })
            return { method: "cli", success: true }
        } catch (error) {
            // Fall back to simplified converter
            console.warn(`draw.io CLI not available, using simplified converter: ${error}`)
        }
    }

    // Use simplified converter
    const xml = fs.readFileSync(inputPath, "utf-8")
    const svg = xmlToSvg(xml, { embedXml })
    fs.writeFileSync(outputPath, svg, "utf-8")
    return { method: "simplified", success: true }
}
