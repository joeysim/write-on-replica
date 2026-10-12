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
    /// Where the run keeps what the app keeps between launches (its drafts). Its own
    /// folder unless it is given another's, to start where that run left off.
    var state: URL

    static func parse(_ arguments: [String]) -> UITestOptions? {
        func value(after flag: String) -> String? {
            guard let i = arguments.firstIndex(of: flag), i + 1 < arguments.count else { return nil }
            return arguments[i + 1]
        }
        guard let scenario = value(after: "--ui-test"), let output = value(after: "--out") else { return nil }
        let folder = URL(fileURLWithPath: output, isDirectory: true)
        var options = UITestOptions(scenario: URL(fileURLWithPath: scenario), output: folder, state: folder.appendingPathComponent("state", isDirectory: true))
        if let state = value(after: "--state") { options.state = URL(fileURLWithPath: state, isDirectory: true) }
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
    private unowned let app: AppDelegate
    private let answers: ScriptedAsking
    private let started = Date()
    private var snapshots: [String] = []
    private var pageErrors: [String] = []
    private var eventNumber = 0
    private var finished = false
    private var rendersAtZoom = false
    /// Times the run came to the front or took the keyboard. It never should; a run that
    /// did has failed, whatever its scenario says.
    private var activations = 0
    private var keyGrabs = 0
    private var nativeMenus = 0
    // The scripted AI provider (`--ai mock`): what to answer next, and what was asked.
    private var aiScript: [String: Any] = [:]
    private var aiRequests: [[String: Any]] = []
    private var aiCancelled: Set<String> = []

    init(options: UITestOptions, controller: DocumentWindowController, app: AppDelegate, answers: ScriptedAsking) {
        self.options = options
        self.controller = controller
        self.app = app
        self.answers = answers
    }

    func start() {
        try? FileManager.default.createDirectory(at: options.output, withIntermediateDirectories: true)
        // The run is set up never to come to the front. If it is brought there anyway, it
        // steps back at once, so the keyboard returns to whatever had it, and the run fails.
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.activations += 1
            NSApp.hide(nil)
            DispatchQueue.main.async { NSApp.unhideWithoutActivation() }
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] note in
            let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            if app?.processIdentifier == ProcessInfo.processInfo.processIdentifier { self?.activations += 1 }
        }
        controller.webView.onSuppressedMenu = { [weak self] in self?.nativeMenus += 1 }
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
        // test.pixels { x, y, w, h, near?, within? } -> { ground: [r, g, b], ink: [r, g, b], matching? }
        // The colours painted in a part of the page: `ground` is what most of it shows (what
        // lies behind the text), `ink` the brightest fiftieth of it (the text itself). Given a
        // colour as `near`, `matching` counts the pixels no further than `within` from it.
        bridge.on("test.pixels") { [weak self] params, reply in
            self?.pixels(params, reply: reply)
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
        if options.aiMock { registerScriptedAI() }
        // test.clipboard -> { text }: what the page last copied, read from the run's own pasteboard.
        bridge.on("test.clipboard", sync: { [weak self] _ in
            ["text": self?.controller.pasteboard.string(forType: .string) ?? ""] as [String: Any]
        })
        // test.opened -> { urls }: the pages the document asked the browser for. None was opened.
        bridge.on("test.opened", sync: { [weak self] _ in
            ["urls": self?.controller.askedToOpen.map(\.absoluteString) ?? []] as [String: Any]
        })
        registerFiles()
        registerMenus()
        // What the run looks like from outside, for the scenario that checks it stays out
        // of the way. These are the real states, not the ones simulated for the page.
        bridge.on("test.environment", sync: { [weak self] _ in
            guard let self else { return nil }
            let window = self.controller.window
            let onADisplay = NSScreen.screens.contains { $0.frame.intersects(window.frame) }
            return [
                "active": NSApp.isActive,
                "activations": self.activations,
                "inDock": NSApp.activationPolicy() == .regular,
                "key": NSApp.keyWindow != nil,
                "canBecomeKey": window.canBecomeKey,
                "onADisplay": onADisplay,
                "alpha": Double(window.alphaValue),
                "ignoresMouse": window.ignoresMouseEvents,
                "ownPasteboard": self.controller.pasteboard.name != NSPasteboard.general.name,
            ] as [String: Any]
        })
        bridge.on("test.done", sync: { [weak self] params in
            let failures = params["failures"] as? [String] ?? []
            let logs = params["logs"] as? [String] ?? []
            // Answer the page first, then leave.
            DispatchQueue.main.async { self?.finish(ok: params["ok"] as? Bool ?? false, failures: failures, logs: logs) }
            return nil
        })
    }

    // MARK: The menu bar

    /// A scripted run is never in front, so its menus are never on screen. A scenario reads
    /// them and picks from them here, by the titles on the way: ["File", "Open Recent"].
    private func registerMenus() {
        let bridge = controller.bridge
        // test.menu { path } -> { items }: the menu there as it would open now.
        bridge.on("test.menu", sync: { [weak self] params in
            guard let self, let menu = self.menu(at: params["path"] as? [String] ?? []) else { throw Bridge.Failure("there is no such menu") }
            menu.delegate?.menuNeedsUpdate?(menu)
            return ["items": menu.items.map { self.describe($0) }] as [String: Any]
        })
        // test.pick { path } -> { picked }: chooses the item there as a click on it would.
        bridge.on("test.pick", sync: { [weak self] params in
            guard let self, let path = params["path"] as? [String], let title = path.last, let menu = self.menu(at: Array(path.dropLast())) else {
                throw Bridge.Failure("there is no such menu")
            }
            menu.delegate?.menuNeedsUpdate?(menu)
            guard let item = menu.items.first(where: { $0.title == title }) else { throw Bridge.Failure("there is no item “\(title)”") }
            return ["picked": self.choose(item)] as [String: Any]
        })
    }

    private func menu(at path: [String]) -> NSMenu? {
        path.reduce(NSApp.mainMenu) { menu, title in menu?.items.first { $0.title == title }?.submenu }
    }

    /// Who would get the item's action: its own target, or the first to answer along the
    /// way AppKit takes from the page out to the app. (AppKit's own lookup starts at the
    /// key window, and a scripted run has none.)
    private func target(of item: NSMenuItem) -> NSObject? {
        guard let action = item.action else { return nil }
        if let own = item.target as? NSObject { return own }
        let chain: [NSObject] = [controller.webView, controller.window, controller, NSApp, app]
        return chain.first { $0.responds(to: action) }
    }

    private func allows(_ item: NSMenuItem, target: NSObject) -> Bool {
        if let asks = target as? NSMenuItemValidation { return asks.validateMenuItem(item) }
        return (target as? NSUserInterfaceValidations)?.validateUserInterfaceItem(item) ?? true
    }

    private func choose(_ item: NSMenuItem) -> Bool {
        guard let action = item.action, let target = target(of: item), allows(item, target: target) else { return false }
        _ = target.perform(action, with: item)
        return true
    }

    private func describe(_ item: NSMenuItem) -> [String: Any] {
        var key = ""
        if !item.keyEquivalent.isEmpty {
            let held = item.keyEquivalentModifierMask
            for (flag, sign) in [(NSEvent.ModifierFlags.function, "fn"), (.control, "⌃"), (.option, "⌥"), (.shift, "⇧"), (.command, "⌘")] where held.contains(flag) { key += sign }
            key += item.keyEquivalent.uppercased()
        }
        let target = target(of: item)
        return [
            "title": item.title,
            "key": key,
            "separator": item.isSeparatorItem,
            "alternate": item.isAlternate,
            "submenu": item.hasSubmenu,
            "enabled": item.hasSubmenu || (target.map { allows(item, target: $0) } ?? false),
            "on": item.state == .on,
        ]
    }

    /// Files, and the questions that go with them. A scenario's files live in the run's own
    /// folder and are named without it.
    private func registerFiles() {
        let bridge = controller.bridge
        let folder = options.output
        // test.dialogs { answers? } -> { asked }: what the shell has asked or told the person
        // so far, having first, if `answers` is given, said how to answer what comes next:
        // { save: "name.md" | null }, { open: ["name.md"] }, { unsaved: "save" | "discard" | "cancel" },
        // any of them with `after`, the milliseconds the answer takes to come.
        bridge.on("test.dialogs", sync: { [weak self] params in
            guard let self else { return nil }
            if let next = params["answers"] as? [[String: Any]] { self.answers.answers = next }
            return ["asked": self.answers.asked] as [String: Any]
        })
        // test.shell -> what the shell knows of the document and keeps about it.
        bridge.on("test.shell", sync: { [weak self] _ in
            guard let self else { return nil }
            let name = { (path: String?) -> Any in path.map { URL(fileURLWithPath: $0).lastPathComponent } ?? NSNull() }
            let windows: [[String: Any]] = self.app.windowsAskedFor.map { start in
                switch start {
                case .welcome: return ["kind": "welcome"]
                case .blank: return ["kind": "blank"]
                case .file(let url, _): return ["kind": "file", "file": url.lastPathComponent]
                case .recovered(let draft): return ["kind": "recovered", "name": draft.name]
                }
            }
            return [
                "file": name(self.controller.fileURL?.path),
                "dirty": self.controller.dirty,
                "edited": self.controller.window.isDocumentEdited,
                "title": self.controller.window.title,
                "drafts": self.app.store.drafts().map { ["name": $0.name, "file": name($0.path), "text": $0.text] as [String: Any] },
                "recents": self.app.store.recents.map { $0.lastPathComponent },
                // The kinds of file the app tells the system it opens, and how it ranks itself for them.
                "opens": (Bundle.main.object(forInfoDictionaryKey: "CFBundleDocumentTypes") as? [[String: Any]] ?? []).map { type in
                    ["types": type["LSItemContentTypes"] ?? [String](), "role": type["CFBundleTypeRole"] ?? "", "rank": type["LSHandlerRank"] ?? ""]
                },
                "windows": windows,
            ] as [String: Any]
        })
        // test.readFile { name, asTheAppDoes? } -> { text }: a file of the run's, as UTF-8, or
        // as the app reads a document it is opening. null if it cannot be read.
        bridge.on("test.readFile", sync: { [weak self] params in
            guard let self, let name = params["name"] as? String else { throw Bridge.Failure("test.readFile needs a name") }
            let url = folder.appendingPathComponent(name)
            let text = params["asTheAppDoes"] as? Bool == true ? try? self.app.store.read(url) : try? String(contentsOf: url, encoding: .utf8)
            return ["text": text ?? NSNull()] as [String: Any]
        })
        // As Finder hands files over.
        bridge.on("test.openFiles", sync: { [weak self] params in
            guard let self, let names = params["names"] as? [String] else { throw Bridge.Failure("test.openFiles needs names") }
            self.app.application(NSApp, open: names.map { folder.appendingPathComponent($0) })
            return nil
        })
        // Closing the window and quitting, as far as the question of unsaved changes: the
        // answer is whether it would go. The run's one window stays, to carry on in.
        bridge.on("test.close") { [weak self] _, reply in
            guard let self else { return }
            self.controller.confirmClose { reply(.success(["closes": $0] as [String: Any])) }
        }
        bridge.on("test.quit") { [weak self] _, reply in
            guard let self else { return }
            self.app.reviewUnsaved { reply(.success(["quits": $0] as [String: Any])) }
        }
        // What the page would be given if it had to start over now.
        bridge.on("test.restart", sync: { [weak self] _ in
            self?.controller.takeStart()
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

    /// Stands in for the AI provider. A scenario says what the next requests get with
    /// `test.ai { set: { chunks, firstMs, everyMs } }` or `{ set: { error, firstMs } }`;
    /// `ai.start` then plays that back as the real client would, as `ai.delta` events and
    /// an `ai.done`, or an `ai.error`. `test.ai` answers with every request received and
    /// the ids of those called off.
    private func registerScriptedAI() {
        let bridge = controller.bridge
        bridge.on("test.ai", sync: { [weak self] params in
            guard let self else { return nil }
            if let script = params["set"] as? [String: Any] { self.aiScript = script }
            return ["requests": self.aiRequests, "cancelled": Array(self.aiCancelled)] as [String: Any]
        })
        bridge.on("ai.start", sync: { [weak self] params in
            guard let self, let id = params["id"] as? String else { throw Bridge.Failure("ai.start needs an id") }
            self.aiRequests.append(params)
            let script = self.aiScript
            let first = ((script["firstMs"] as? NSNumber)?.doubleValue ?? 0) / 1000
            let every = ((script["everyMs"] as? NSNumber)?.doubleValue ?? 0) / 1000
            let send: (TimeInterval, String, [String: Any]) -> Void = { [weak self] delay, event, payload in
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                    guard let self, !self.aiCancelled.contains(id) else { return }
                    self.controller.bridge.emit(event, payload)
                }
            }
            if let message = script["error"] as? String {
                send(first, "ai.error", ["id": id, "message": message])
                return nil
            }
            let chunks = script["chunks"] as? [String] ?? []
            for (index, chunk) in chunks.enumerated() {
                send(first + every * Double(index), "ai.delta", ["id": id, "text": chunk])
            }
            send(first + every * Double(chunks.count), "ai.done", ["id": id])
            return nil
        })
        bridge.on("ai.cancel", sync: { [weak self] params in
            if let id = params["id"] as? String { self?.aiCancelled.insert(id) }
            return nil
        })
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

    private func pixels(_ params: [String: Any], reply: @escaping Bridge.Reply) {
        let configuration = WKSnapshotConfiguration()
        configuration.afterScreenUpdates = true
        configuration.rect = CGRect(x: number(params["x"]), y: number(params["y"]), width: number(params["w"]), height: number(params["h"]))
        controller.webView.takeSnapshot(with: configuration) { image, error in
            guard let image = image?.cgImage(forProposedRect: nil, context: nil, hints: nil), image.width > 0, image.height > 0 else {
                return reply(.failure(Bridge.Failure("cannot read pixels: \(error?.localizedDescription ?? "no image")")))
            }
            // Drawn into the image's own colour space, so the values are those a snapshot file holds.
            let width = image.width, height = image.height
            var bytes = [UInt8](repeating: 0, count: width * height * 4)
            let space = image.colorSpace ?? CGColorSpaceCreateDeviceRGB()
            let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
                guard let context = CGContext(
                    data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                    space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                ) else { return false }
                context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
                return true
            }
            guard drawn else { return reply(.failure(Bridge.Failure("cannot read pixels: no bitmap"))) }

            let count = width * height
            var channels = [[UInt8]](repeating: [], count: 3)
            for channel in 0..<3 {
                channels[channel] = stride(from: channel, to: count * 4, by: 4).map { bytes[$0] }.sorted()
            }
            let ground = channels.map { Double($0[count / 2]) }
            let luma = { (i: Int) in 0.299 * Double(bytes[i * 4]) + 0.587 * Double(bytes[i * 4 + 1]) + 0.114 * Double(bytes[i * 4 + 2]) }
            let brightest = (0..<count).sorted { luma($0) > luma($1) }.prefix(max(1, count / 50))
            let ink = (0..<3).map { channel in
                brightest.reduce(0.0) { $0 + Double(bytes[$1 * 4 + channel]) } / Double(brightest.count)
            }
            var found: [String: Any] = ["ground": ground, "ink": ink, "width": width, "height": height]
            if let near = (params["near"] as? [NSNumber])?.map(\.doubleValue), near.count == 3 {
                let within = (params["within"] as? NSNumber)?.doubleValue ?? 0
                found["matching"] = (0..<count).filter { i in
                    (0..<3).reduce(0.0) { $0 + pow(Double(bytes[i * 4 + $1]) - near[$1], 2) } <= within * within
                }.count
            }
            reply(.success(found))
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
        if NSApp.keyWindow != nil { keyGrabs += 1 }
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
        if NSApp.keyWindow != nil { keyGrabs += 1 }
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

    /// Follows AppKit's order for a key press: with Command down it is a key equivalent,
    /// offered to the view hierarchy, where WebKit gives the page the first say and sends
    /// what the page leaves alone on to the menu bar; otherwise it goes to the first
    /// responder. Sent by hand because `NSApp.sendEvent` needs a real key window, which a
    /// locked Mac cannot give.
    private func deliver(_ event: NSEvent, in window: NSWindow) {
        if event.type == .keyDown, event.modifierFlags.contains(.command) {
            if window.performKeyEquivalent(with: event) { return }
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
        // Whatever the scenario found, a run that came to the front or took the keyboard
        // has disturbed someone, and that is a failure of the run.
        var intrusions: [String] = []
        if NSApp.keyWindow != nil { keyGrabs += 1 }
        if activations > 0 || NSApp.isActive { intrusions.append("the run came to the front (\(max(activations, 1)) time(s)); it must stay in the background") }
        if keyGrabs > 0 { intrusions.append("the run's window took the keyboard; it must never be the key window") }
        if nativeMenus > 0 {
            intrusions.append("the scenario right-clicked where the page leaves the menu to the system; WebKit drops every mouse event after that in a scripted run, so ask the page with a 'contextmenu' event instead")
        }
        let allFailures = failures + pageErrors.map { "page error: \($0)" } + intrusions
        let passed = ok && pageErrors.isEmpty && intrusions.isEmpty
        let result: [String: Any] = [
            "scenario": options.scenario.deletingPathExtension().lastPathComponent,
            "ok": passed,
            "failures": allFailures,
            "logs": logs,
            "snapshots": snapshots,
            "durationMs": Int(Date().timeIntervalSince(started) * 1000),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: options.output.appendingPathComponent("result.json"))
        }
        controller.pasteboard.releaseGlobally() // the run's own, made for it
        exit(passed ? 0 : 1)
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

/// Answers the shell's questions in a scripted run, as its scenario said to (`test.dialogs`),
/// and keeps a list of what was asked. Nothing is ever shown. An answer is used for the
/// next question of its kind; a question with no answer waiting is called off.
final class ScriptedAsking: Asking {
    private let folder: URL
    private(set) var asked: [[String: Any]] = []
    var answers: [[String: Any]] = []

    init(folder: URL) {
        self.folder = folder
    }

    /// How long the answer just taken is to be in coming: `after` milliseconds, if it said so.
    private var wait: TimeInterval = 0

    private func take(_ kind: String) -> Any? {
        wait = 0
        guard let answer = answers.first, let value = answer[kind] else { return nil }
        answers.removeFirst()
        wait = ((answer["after"] as? NSNumber)?.doubleValue ?? 0) / 1000
        return value
    }

    // A person takes a moment to answer, and so does this: never before the question returns.
    private func later(_ reply: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + wait, execute: reply)
    }

    func whereToSave(suggested: String, in directory: URL?, for window: NSWindow?, then reply: @escaping (URL?) -> Void) {
        var question: [String: Any] = ["kind": "save", "name": suggested]
        if let directory { question["folder"] = directory.lastPathComponent }
        asked.append(question)
        let url = (take("save") as? String).map { folder.appendingPathComponent($0) }
        later { reply(url) }
    }

    func whatToOpen(for window: NSWindow?, then reply: @escaping ([URL]) -> Void) {
        asked.append(["kind": "open"])
        let urls = (take("open") as? [String] ?? []).map { folder.appendingPathComponent($0) }
        later { reply(urls) }
    }

    func whetherToSave(_ name: String, for window: NSWindow?, then reply: @escaping (UnsavedChoice) -> Void) {
        asked.append(["kind": "unsaved", "name": name])
        let choice: UnsavedChoice
        switch take("unsaved") as? String {
        case "save": choice = .save
        case "discard": choice = .discard
        default: choice = .cancel
        }
        later { reply(choice) }
    }

    func tell(_ message: String, detail: String, for window: NSWindow?) {
        asked.append(["kind": "tell", "message": message, "detail": detail])
    }
}
