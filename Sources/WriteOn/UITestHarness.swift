import AppKit
import WebKit

/// Options for a scripted UI run:
/// `--ui-test <scenario.js> --out <dir> [--size WxH] [--zoom N] [--timeout S] [--ai mock] [--setting name=value]…`
struct UITestOptions {
    let scenario: URL
    let output: URL
    var pageSize = DocumentWindowController.referencePageSize
    var zoom: Double = 1
    var timeout: TimeInterval = 60
    var aiMock = false
    /// Interface settings the run starts with, as if left that way by an earlier launch.
    var settings: [String: Any] = [:]

    static func parse(_ arguments: [String]) -> UITestOptions? {
        func value(after flag: String) -> String? {
            guard let i = arguments.firstIndex(of: flag), i + 1 < arguments.count else { return nil }
            return arguments[i + 1]
        }
        guard let scenario = value(after: "--ui-test"), let output = value(after: "--out") else { return nil }
        var options = UITestOptions(scenario: URL(fileURLWithPath: scenario), output: URL(fileURLWithPath: output, isDirectory: true))
        if let size = value(after: "--size") {
            let parts = size.lowercased().split(separator: "x").compactMap { Double($0) }
            if parts.count == 2 { options.pageSize = NSSize(width: parts[0], height: parts[1]) }
        }
        if let zoom = value(after: "--zoom").flatMap(Double.init) { options.zoom = zoom }
        if let timeout = value(after: "--timeout").flatMap(Double.init) { options.timeout = timeout }
        options.aiMock = value(after: "--ai") == "mock"
        for (index, argument) in arguments.enumerated() where argument == "--setting" && index + 1 < arguments.count {
            let pair = arguments[index + 1].split(separator: "=", maxSplits: 1).map(String.init)
            guard pair.count == 2 else { continue }
            switch pair[1] {
            case "true": options.settings[pair[0]] = true
            case "false": options.settings[pair[0]] = false
            default: options.settings[pair[0]] = Double(pair[1]).map { $0 as Any } ?? pair[1]
            }
        }
        return options
    }
}

/// Runs one scenario from `tests/ui` inside the real web view and exits with its result.
///
/// The scenario is JavaScript evaluated in the page. Through the bridge it can take
/// snapshots and ask for native mouse and key events, which travel the same path as
/// events from a person: AppKit, WebKit's event handling, then the DOM.
final class UITestHarness {
    private let options: UITestOptions
    private let controller: DocumentWindowController
    private let started = Date()
    private var snapshots: [String] = []
    private var pageErrors: [String] = []
    private var eventNumber = 0
    private var finished = false
    private var rendersAtZoom = false

    init(options: UITestOptions, controller: DocumentWindowController) {
        self.options = options
        self.controller = controller
    }

    func start() {
        try? FileManager.default.createDirectory(at: options.output, withIntermediateDirectories: true)
        controller.onPageLog = { [weak self] level, message in
            if level == "error" { self?.pageErrors.append(message) }
        }
        registerHandlers()
        if options.zoom != 1 { rendersAtZoom = overrideScale(CGFloat(options.zoom)) }
        if controller.pageIsReady {
            run()
        } else {
            controller.onPageReady = { [weak self] in self?.run() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + options.timeout) { [weak self] in
            guard let self else { return }
            self.finish(ok: false, failures: ["timed out after \(Int(self.options.timeout)) s"], logs: [])
        }
    }

    private func run() {
        controller.show()
        let support = options.scenario.deletingLastPathComponent().appendingPathComponent("_harness.js")
        do {
            let prelude = try String(contentsOf: support, encoding: .utf8)
            let source = try String(contentsOf: options.scenario, encoding: .utf8)
            let script = """
            \(prelude)
            void (async () => {
              const t = window.__t;
              try {
                await (async () => {
            \(source)
                })();
                await window.__tFinish();
              } catch (error) {
                await window.__tFinish(error);
              }
            })();
            """
            controller.webView.evaluateJavaScript(script) { [weak self] _, error in
                guard let self, let error else { return }
                let info = (error as NSError).userInfo
                let message = info["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription
                let line = (info["WKJavaScriptExceptionLineNumber"] as? Int).map { " (line \($0) of the injected script)" } ?? ""
                self.finish(ok: false, failures: ["the scenario could not start: \(message)\(line)"], logs: [])
            }
        } catch {
            finish(ok: false, failures: ["cannot read the scenario: \(error.localizedDescription)"], logs: [])
        }
    }

    // MARK: Bridge handlers

    private func registerHandlers() {
        let bridge = controller.bridge
        bridge.on("test.snap") { [weak self] params, reply in
            self?.snapshot(named: params["name"] as? String ?? "snapshot", reply: reply)
        }
        bridge.on("test.mouse", sync: { [weak self] params in
            try self?.sendMouse(params)
            return nil
        })
        bridge.on("test.key", sync: { [weak self] params in
            try self?.sendKey(params)
            return nil
        })
        bridge.on("test.writeFile", sync: { [weak self] params in
            guard let self, let name = params["name"] as? String, let base64 = params["base64"] as? String,
                  let data = Data(base64Encoded: base64), !name.contains("/")
            else { throw Bridge.Failure("test.writeFile needs a plain file name and base64 data") }
            try data.write(to: self.options.output.appendingPathComponent(name))
            return nil
        })
        bridge.on("test.options", sync: { [weak self] _ in
            guard let self else { return nil }
            return ["zoom": self.options.zoom, "rendersAtZoom": self.rendersAtZoom, "aiMock": self.options.aiMock] as [String: Any]
        })
        bridge.on("test.done", sync: { [weak self] params in
            let failures = params["failures"] as? [String] ?? []
            let logs = params["logs"] as? [String] ?? []
            // Answer the page first, then leave.
            DispatchQueue.main.async { self?.finish(ok: params["ok"] as? Bool ?? false, failures: failures, logs: logs) }
            return nil
        })
    }

    /// Makes the page lay out and paint as it would on a display with `scale` pixels per
    /// point, whatever display the Mac has. The clips were recorded at 2x, where WebKit
    /// places things on half points; on a 1x display it rounds them to whole ones. Test-only
    /// SPI, as used by WebKit's own runner. Returns false if this WebKit does not have it.
    private func overrideScale(_ scale: CGFloat) -> Bool {
        let webView = controller.webView
        let selector = NSSelectorFromString("_setOverrideDeviceScaleFactor:")
        guard webView.responds(to: selector), let method = webView.method(for: selector) else { return false }
        typealias Setter = @convention(c) (AnyObject, Selector, CGFloat) -> Void
        unsafeBitCast(method, to: Setter.self)(webView, selector, scale)
        return true
    }

    private func snapshot(named name: String, reply: @escaping Bridge.Reply) {
        let webView = controller.webView
        let configuration = WKSnapshotConfiguration()
        configuration.afterScreenUpdates = true
        if options.zoom != 1, !rendersAtZoom {
            // Without the scale override the best available is the 1x page drawn larger.
            configuration.snapshotWidth = NSNumber(value: Double(webView.bounds.width) * options.zoom)
        }
        webView.takeSnapshot(with: configuration) { [weak self] image, error in
            guard let self else { return }
            guard let image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:])
            else {
                return reply(.failure(Bridge.Failure("snapshot failed: \(error?.localizedDescription ?? "no image")")))
            }
            let file = name.replacingOccurrences(of: "/", with: "-") + ".png"
            do {
                try png.write(to: self.options.output.appendingPathComponent(file))
                self.snapshots.append(file)
                reply(.success(["file": file, "width": bitmap.pixelsWide, "height": bitmap.pixelsHigh] as [String: Any]))
            } catch {
                reply(.failure(Bridge.Failure("cannot write \(file): \(error.localizedDescription)")))
            }
        }
    }

    // MARK: Native input

    private func modifiers(_ params: [String: Any]) -> NSEvent.ModifierFlags {
        var flags: NSEvent.ModifierFlags = []
        if params["ctrl"] as? Bool == true { flags.insert(.control) }
        if params["shift"] as? Bool == true { flags.insert(.shift) }
        if params["alt"] as? Bool == true { flags.insert(.option) }
        if params["meta"] as? Bool == true { flags.insert(.command) }
        return flags
    }

    private func number(_ value: Any?) -> Double {
        (value as? NSNumber)?.doubleValue ?? 0
    }

    private func sendMouse(_ params: [String: Any]) throws {
        let webView = controller.webView
        guard let window = webView.window else { throw Bridge.Failure("the web view has no window") }
        let type = params["type"] as? String ?? "move"
        let button = params["button"] as? String ?? "left"
        let x = number(params["x"]), y = number(params["y"])
        let inView = NSPoint(x: x, y: webView.isFlipped ? y : Double(webView.bounds.height) - y)
        let location = webView.convert(inView, to: nil)

        let eventType: NSEvent.EventType
        switch (type, button) {
        case ("move", _): eventType = .mouseMoved
        case ("drag", _): eventType = .leftMouseDragged
        case ("down", "right"): eventType = .rightMouseDown
        case ("up", "right"): eventType = .rightMouseUp
        case ("down", _): eventType = .leftMouseDown
        case ("up", _): eventType = .leftMouseUp
        default: throw Bridge.Failure("unknown mouse event: \(type)")
        }
        eventNumber += 1
        let pressed = type == "down" || type == "drag"
        guard let event = NSEvent.mouseEvent(
            with: eventType,
            location: location,
            modifierFlags: modifiers(params),
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber,
            context: nil,
            eventNumber: eventNumber,
            clickCount: eventType == .mouseMoved ? 0 : max(1, Int(number(params["count"]))),
            pressure: pressed ? 1 : 0
        ) else { throw Bridge.Failure("could not build the mouse event") }

        // Handed straight to the web view: a locked Mac has no key window for events to go
        // through. Presses, releases and drags arrive in the page this way. Plain moves do
        // not (WebKit drops them in this state), so scenarios hover with DOM events instead;
        // see `hover` in tests/ui/_harness.js.
        switch eventType {
        case .mouseMoved: webView.mouseMoved(with: event)
        case .leftMouseDragged: webView.mouseDragged(with: event)
        case .leftMouseDown: webView.mouseDown(with: event)
        case .leftMouseUp: webView.mouseUp(with: event)
        case .rightMouseDown: webView.rightMouseDown(with: event)
        case .rightMouseUp: webView.rightMouseUp(with: event)
        default: window.sendEvent(event)
        }
    }

    private func sendKey(_ params: [String: Any]) throws {
        guard let window = controller.webView.window else { throw Bridge.Failure("the web view has no window") }
        guard let name = params["key"] as? String, let key = KeyMap.lookup(name) else {
            throw Bridge.Failure("unknown key: \(params["key"] ?? "nil")")
        }
        var flags = modifiers(params).union(key.flags)
        if key.needsShift { flags.insert(.shift) }
        let control = flags.contains(.control)

        var characters = key.characters
        var ignoring = key.charactersIgnoringModifiers
        if flags.contains(.shift), !key.needsShift, key.isLetter {
            characters = characters.uppercased()
            ignoring = ignoring.uppercased()
        }
        if control, key.isLetter, let scalar = key.charactersIgnoringModifiers.lowercased().unicodeScalars.first {
            // Control turns a letter into its control character, as the keyboard does.
            characters = String(UnicodeScalar(UInt8(scalar.value & 0x1f)))
        }

        for type in [NSEvent.EventType.keyDown, .keyUp] {
            guard let event = NSEvent.keyEvent(
                with: type,
                location: .zero,
                modifierFlags: flags,
                timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber,
                context: nil,
                characters: characters,
                charactersIgnoringModifiers: ignoring,
                isARepeat: false,
                keyCode: key.code
            ) else { throw Bridge.Failure("could not build the key event") }
            deliver(event, in: window)
        }
    }

    /// Follows AppKit's order for a key press: key equivalents first (the view hierarchy,
    /// then the menu bar) when Command is down, otherwise the first responder. Sent by hand
    /// because `NSApp.sendEvent` needs a real key window, which a locked Mac cannot give.
    private func deliver(_ event: NSEvent, in window: NSWindow) {
        if event.type == .keyDown, event.modifierFlags.contains(.command) {
            if window.performKeyEquivalent(with: event) { return }
            if NSApp.mainMenu?.performKeyEquivalent(with: event) == true { return }
        }
        guard let responder = window.firstResponder else { return }
        if event.type == .keyDown {
            responder.keyDown(with: event)
        } else {
            responder.keyUp(with: event)
        }
    }

    // MARK: Finish

    private func finish(ok: Bool, failures: [String], logs: [String]) {
        guard !finished else { return }
        finished = true
        let allFailures = failures + pageErrors.map { "page error: \($0)" }
        let result: [String: Any] = [
            "scenario": options.scenario.deletingPathExtension().lastPathComponent,
            "ok": ok && pageErrors.isEmpty,
            "failures": allFailures,
            "logs": logs,
            "snapshots": snapshots,
            "durationMs": Int(Date().timeIntervalSince(started) * 1000),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: options.output.appendingPathComponent("result.json"))
        }
        exit(ok && pageErrors.isEmpty ? 0 : 1)
    }
}

/// US-layout key codes for the keys scenarios use.
private struct KeyMap {
    let code: UInt16
    let characters: String
    let charactersIgnoringModifiers: String
    var needsShift = false
    var isLetter = false
    var flags: NSEvent.ModifierFlags = []

    private static let letters: [Character: UInt16] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
        "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38,
        "k": 40, "n": 45, "m": 46,
    ]
    private static let plain: [Character: UInt16] = [
        "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28,
        "0": 29, "]": 30, "[": 33, "'": 39, ";": 41, "\\": 42, ",": 43, "/": 44, ".": 47, "`": 50, " ": 49,
    ]
    private static let shifted: [Character: Character] = [
        "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
        "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", "\"": "'", "<": ",", ">": ".", "?": "/",
        "~": "`",
    ]
    private static let named: [String: (UInt16, String, NSEvent.ModifierFlags)] = [
        "Enter": (36, "\r", []), "Tab": (48, "\t", []), "Backspace": (51, "\u{7f}", []), "Escape": (53, "\u{1b}", []),
        "Delete": (117, "\u{f728}", .function),
        "ArrowLeft": (123, "\u{f702}", [.numericPad, .function]), "ArrowRight": (124, "\u{f703}", [.numericPad, .function]),
        "ArrowDown": (125, "\u{f701}", [.numericPad, .function]), "ArrowUp": (126, "\u{f700}", [.numericPad, .function]),
        "Home": (115, "\u{f729}", .function), "End": (119, "\u{f72b}", .function),
    ]

    static func lookup(_ name: String) -> KeyMap? {
        if let (code, chars, flags) = named[name] {
            return KeyMap(code: code, characters: chars, charactersIgnoringModifiers: chars, flags: flags)
        }
        guard name.count == 1, let ch = name.first else { return nil }
        let lower = Character(ch.lowercased())
        if let code = letters[lower] {
            return KeyMap(code: code, characters: String(ch), charactersIgnoringModifiers: String(ch), needsShift: ch != lower, isLetter: true)
        }
        if let code = plain[ch] {
            return KeyMap(code: code, characters: String(ch), charactersIgnoringModifiers: String(ch))
        }
        if let base = shifted[ch], let code = plain[base] {
            return KeyMap(code: code, characters: String(ch), charactersIgnoringModifiers: String(ch), needsShift: true)
        }
        return nil
    }
}
