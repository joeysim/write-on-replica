#!/usr/bin/env swift
// Draws the app's icon and writes packaging/AppIcon.icns.
//
//   swift scripts/make-icon.swift [out.icns]
//
// The icon is the app's own mark for a word with alternatives: a letter in the text colour,
// the pen-stroke underline and the row of dots beneath it, on the page's dark blue. It is
// drawn here, at every size macOS asks for, so there is no artwork to keep in step.
import AppKit

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let output = CommandLine.arguments.count > 1 ? URL(fileURLWithPath: CommandLine.arguments[1]) : root.appendingPathComponent("packaging/AppIcon.icns")

// The app's palette (design spec 4.1).
let ground = (top: NSColor(srgbRed: 13 / 255, green: 20 / 255, blue: 46 / 255, alpha: 1), bottom: NSColor(srgbRed: 5 / 255, green: 10 / 255, blue: 28 / 255, alpha: 1))
let ink = NSColor(srgbRed: 245 / 255, green: 209 / 255, blue: 192 / 255, alpha: 1)
let accent = NSColor(srgbRed: 129 / 255, green: 124 / 255, blue: 212 / 255, alpha: 1)

/// Draws the icon on a canvas `side` pixels square. All measures are for a 1024 canvas.
func draw(side: Int) -> NSBitmapImageRep {
    let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let context = NSGraphicsContext.current!.cgContext
    context.scaleBy(x: CGFloat(side) / 1024, y: CGFloat(side) / 1024)

    // The plate: the shape and size of a macOS app icon, with its soft shadow.
    let plate = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 186, yRadius: 186)
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: -10), blur: 22, color: NSColor.black.withAlphaComponent(0.32).cgColor)
    ground.bottom.setFill()
    plate.fill()
    context.restoreGState()
    NSGradient(starting: ground.bottom, ending: ground.top)!.draw(in: plate, angle: 90)
    // A hairline of light along the top edge, as the system's own icons have.
    context.saveGState()
    plate.addClip()
    NSColor.white.withAlphaComponent(0.07).setStroke()
    let rim = NSBezierPath(roundedRect: NSRect(x: 102, y: 102, width: 820, height: 820), xRadius: 184, yRadius: 184)
    rim.lineWidth = 4
    rim.stroke()
    context.restoreGState()

    // The letter.
    let font = NSFont.monospacedSystemFont(ofSize: 470, weight: .bold)
    let letter = NSAttributedString(string: "W", attributes: [.font: font, .foregroundColor: ink])
    let size = letter.size()
    let baseline: CGFloat = 430
    letter.draw(at: NSPoint(x: 512 - size.width / 2, y: baseline + font.descender))

    // The underline, a pen stroke: a little uneven, thinner where it starts.
    let (left, right, line): (CGFloat, CGFloat, CGFloat) = (512 - size.width / 2 + 6, 512 + size.width / 2 - 6, baseline - 62)
    let stroke = NSBezierPath()
    stroke.move(to: NSPoint(x: left, y: line - 3))
    stroke.curve(to: NSPoint(x: right, y: line + 2), controlPoint1: NSPoint(x: left + 120, y: line + 9), controlPoint2: NSPoint(x: right - 150, y: line - 8))
    stroke.lineWidth = 20
    stroke.lineCapStyle = .round
    accent.setStroke()
    stroke.stroke()

    // The dots: the one showing is filled, the others are open.
    let (radius, gap, row): (CGFloat, CGFloat, CGFloat) = (27, 92, line - 86)
    for index in 0..<3 {
        let centre = NSPoint(x: 512 + CGFloat(index - 1) * gap, y: row)
        let dot = NSBezierPath(ovalIn: NSRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2))
        if index == 0 {
            accent.setFill()
            dot.fill()
        } else {
            dot.lineWidth = 11
            accent.setStroke()
            dot.stroke()
        }
    }
    NSGraphicsContext.restoreGraphicsState()
    return bitmap
}

let set = FileManager.default.temporaryDirectory.appendingPathComponent("WriteOn-\(ProcessInfo.processInfo.processIdentifier).iconset")
try? FileManager.default.removeItem(at: set)
try FileManager.default.createDirectory(at: set, withIntermediateDirectories: true)
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
        let png = draw(side: points * scale).representation(using: .png, properties: [:])!
        try png.write(to: set.appendingPathComponent(name))
    }
}
let tool = Process()
tool.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
tool.arguments = ["-c", "icns", set.path, "-o", output.path]
try tool.run()
tool.waitUntilExit()
if CommandLine.arguments.contains("--keep-png") {
    try? FileManager.default.copyItem(at: set.appendingPathComponent("icon_512x512@2x.png"), to: output.deletingPathExtension().appendingPathExtension("png"))
}
try? FileManager.default.removeItem(at: set)
guard tool.terminationStatus == 0 else {
    FileHandle.standardError.write(Data("make-icon: iconutil failed\n".utf8))
    exit(1)
}
print("wrote \(output.path)")
