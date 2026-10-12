// What the same typing costs in AppKit's own text view, for comparison with the page:
// the time from a character being inserted to the view having laid out and drawn again
// and handed the result to Core Animation, in documents of several sizes.
//
//   swift -O tests/perf/native-baseline.swift [words ...]
//
// Nothing is shown: the process is never activated and its window is off every display,
// transparent and click-through. This is not the app; it is a yardstick.
import AppKit

final class HiddenWindow: NSWindow {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

let WORDS = ["draft", "margin", "sentence", "because", "quiet", "between", "the", "a", "of", "writes", "again", "slowly", "and", "paper", "over", "window"]

func piece(_ words: Int) -> String {
    let count = max(1, Int((Double(words) / 80).rounded()))
    var lines = ["A piece of \(count * 80) words", ""]
    for p in 0..<count {
        let picked = (0..<80).map { w in WORDS[(p * 7 + w * 13 + ((p * w) % 5)) % WORDS.count] }
        lines.append(picked.joined(separator: " ") + ".")
        lines.append("")
    }
    return lines.joined(separator: "\n")
}

func spread(_ values: [Double]) -> String {
    let s = values.sorted()
    func at(_ q: Double) -> Double { s[min(s.count - 1, Int(q * Double(s.count)))] }
    return String(format: "min %.2f  median %.2f  p95 %.2f  max %.2f", s[0], at(0.5), at(0.95), s[s.count - 1])
}

func footprintMB() -> Double {
    var info = rusage_info_v4()
    let ok = withUnsafeMutablePointer(to: &info) { pointer in
        pointer.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(getpid(), RUSAGE_INFO_V4, $0) }
    }
    return ok == 0 ? Double(info.ri_phys_footprint) / 1_048_576 : 0
}

let began = CACurrentMediaTime()
let sizes = CommandLine.arguments.dropFirst().compactMap { Int($0) }
let application = NSApplication.shared
application.setActivationPolicy(.accessory)

let frame = NSRect(x: 0, y: 0, width: 1548, height: 976)
let window = HiddenWindow(contentRect: frame, styleMask: [.titled, .resizable], backing: .buffered, defer: false)
window.alphaValue = 0
window.ignoresMouseEvents = true
window.hasShadow = false
window.collectionBehavior = [.transient, .ignoresCycle, .stationary]
window.setFrameOrigin(NSPoint(x: -30000, y: -30000))

let scroll = NSTextView.scrollableTextView()
scroll.frame = frame
scroll.drawsBackground = true
scroll.backgroundColor = NSColor(srgbRed: 5 / 255, green: 10 / 255, blue: 28 / 255, alpha: 1)
let text = scroll.documentView as! NSTextView
text.isRichText = false
text.drawsBackground = false
text.textContainerInset = NSSize(width: 384, height: 175)
text.insertionPointColor = .white
let paragraph = NSMutableParagraphStyle()
paragraph.minimumLineHeight = 36
paragraph.maximumLineHeight = 36
let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.monospacedSystemFont(ofSize: 20, weight: .regular),
    .foregroundColor: NSColor(srgbRed: 245 / 255, green: 209 / 255, blue: 192 / 255, alpha: 1),
    .paragraphStyle: paragraph,
]
text.typingAttributes = attributes
window.contentView = scroll
window.orderBack(nil)
window.makeFirstResponder(text)

func settle() {
    window.displayIfNeeded()
    CATransaction.flush()
}

DispatchQueue.main.async {
    settle()
    print(String(format: "ready %.0f ms after the process began, %.0f MB, %@", (CACurrentMediaTime() - began) * 1000, footprintMB(), text.textLayoutManager != nil ? "TextKit 2" : "TextKit 1"))
    let keys = Array("etaoinshrdlucmfwypvbgkq")
    for words in sizes.isEmpty ? [170, 1000, 5000, 20000, 50000] : sizes {
        let content = piece(words)
        text.textStorage?.setAttributedString(NSAttributedString(string: content, attributes: attributes))
        let middle = (content as NSString).length / 2
        text.setSelectedRange(NSRange(location: middle, length: 0))
        text.scrollRangeToVisible(NSRange(location: middle, length: 0))
        settle()
        for i in 0..<10 { text.insertText(String(keys[i % keys.count]), replacementRange: text.selectedRange()); settle() }
        var times: [Double] = []
        for i in 0..<120 {
            let from = CACurrentMediaTime()
            text.insertText(i % 7 == 6 ? " " : String(keys[i % keys.count]), replacementRange: text.selectedRange())
            settle()
            times.append((CACurrentMediaTime() - from) * 1000)
        }
        print(String(format: "%6d words  insert to drawn (ms): %@   %.0f MB", words, spread(times), footprintMB()))
    }
    exit(0)
}
application.run()
