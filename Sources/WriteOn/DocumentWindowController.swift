import AppKit
import WebKit

final class EditorWindow: NSWindow {
    /// Lets the UI test harness give the page its exact reference size on a smaller screen.
    var allowsFrameBeyondScreen = false

    /// Scripted runs often happen on a locked or unattended Mac, where no window can become
    /// key. The harness sets this so WebKit treats the page as focused anyway, the same
    /// device WebKit's own test runner uses.
    var simulatesKeyState = false

    override var isKeyWindow: Bool { simulatesKeyState || super.isKeyWindow }
    override var isMainWindow: Bool { simulatesKeyState || super.isMainWindow }

    /// A scripted run's window never really takes the keyboard, so nothing typed by the
    /// person at the Mac can land in it and nothing is taken from them.
    override var canBecomeKey: Bool { !simulatesKeyState && super.canBecomeKey }
    override var canBecomeMain: Bool { !simulatesKeyState && super.canBecomeMain }

    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        allowsFrameBeyondScreen ? frameRect : super.constrainFrameRect(frameRect, to: screen)
    }
}

final class EditorWebView: WKWebView {
    /// A scripted run cannot dismiss a native menu, so the harness turns them off.
    var suppressesNativeMenus = false
    /// Called when a native menu was asked for while they are turned off. WebKit then
    /// waits for a menu that never shows and drops every later mouse event, so the
    /// harness treats it as a mistake in the scenario.
    var onSuppressedMenu: (() -> Void)?

    private var document: DocumentWindowController? { window?.delegate as? DocumentWindowController }

    // Edit ▸ Undo and Redo. The history is the document's own, kept in the page. WebKit's
    // knows only the last plain keystrokes, so it is neither asked nor used.
    @objc func undo(_ sender: Any?) {
        document?.command("undo")
    }

    @objc func redo(_ sender: Any?) {
        document?.command("redo")
    }

    override func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
        switch item.action {
        case #selector(undo(_:)): return document?.can("undo") ?? false
        case #selector(redo(_:)): return document?.can("redo") ?? false
        default: return super.validateUserInterfaceItem(item)
        }
    }

    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        if suppressesNativeMenus {
            menu.removeAllItems()
            onSuppressedMenu?()
        } else {
            super.willOpenMenu(menu, with: event)
        }
    }
}

/// What a window opens with.
enum DocumentStart {
    /// The piece that shows what the app does, the first time it is opened.
    case welcome
    case blank
    case file(URL, text: String)
    /// Unsaved work from before a crash.
    case recovered(Draft)
}

/// One window, one document. Owns the web view that hosts the page, and knows which file
/// the document is, whether it has changes that file does not, and what to do about them.
final class DocumentWindowController: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    static let pageBackground = NSColor(srgbRed: 5 / 255, green: 10 / 255, blue: 28 / 255, alpha: 1)
    /// The page size the source clips were recorded at; the default for a new window.
    static let referencePageSize = NSSize(width: 1548, height: 976)
    static let minimumPageSize = NSSize(width: 720, height: 480)
    /// Where a scripted run keeps its window: nowhere a display can be.
    static let offscreenOrigin = NSPoint(x: -30000, y: -30000)

    let window: EditorWindow
    let webView: EditorWebView
    let bridge = Bridge()

    private(set) var pageIsReady = false
    var onPageReady: (() -> Void)?
    var onPageLog: ((_ level: String, _ message: String) -> Void)?
    var onClosed: ((DocumentWindowController) -> Void)?

    /// Open… was chosen in this window.
    var onOpenRequest: ((DocumentWindowController) -> Void)?

    /// Under which this document's unsaved work is copied aside.
    let id: String
    private(set) var fileURL: URL?
    /// Whether the page holds changes the file does not. The page says (`doc.state`).
    private(set) var dirty = false
    /// The first heading, as a name for a document that has no file yet.
    private var heading = ""
    /// Which of the page's switches are on (read mode and the like), for the menu's ticks.
    private var flags: [String: Bool] = [:]
    /// Whether there is anything to undo or redo, for the menu.
    private var able: [String: Bool] = [:]
    /// Where a recovered document used to live, which is where saving it starts.
    private var formerURL: URL?
    private var start: DocumentStart
    private var startTaken = false
    /// A question about this document is waiting for its answer. One at a time: a second
    /// panel would only queue up behind the first.
    private(set) var isAsking = false

    private let scripted: Bool
    private let settings: AppSettings
    private let store: FileStore
    private let asking: Asking
    private let ai: AIClient
    /// Where Copy puts text. A scripted run has a pasteboard of its own, so it never
    /// replaces what the person at this Mac has copied.
    let pasteboard: NSPasteboard
    /// The pages a scripted run was asked to open in the browser. It opens none of them,
    /// and keeps the list for its scenario to read.
    private(set) var askedToOpen: [URL] = []

    /// - Parameters:
    ///   - settings: where the page's interface choices are kept.
    ///   - pageSize: content size in points; defaults to the reference size, fitted to the screen.
    ///   - scripted: a UI test run. Keeps `pageSize` exactly, and makes the page behave as
    ///     visible and focused even when the Mac is locked.
    init(
        webRoot: URL, settings: AppSettings, store: FileStore, asking: Asking, ai: AIClient,
        start: DocumentStart = .blank, pageSize: NSSize? = nil, scripted: Bool = false
    ) {
        self.scripted = scripted
        self.settings = settings
        self.store = store
        self.asking = asking
        self.ai = ai
        self.start = start
        switch start {
        case .file(let url, _):
            id = UUID().uuidString
            fileURL = url.standardizedFileURL
        case .recovered(let draft):
            // Still unsaved, and still kept under the same name until it is saved or let go.
            id = draft.id
            dirty = true
            heading = draft.name
            formerURL = draft.path.map { URL(fileURLWithPath: $0) }
        case .welcome, .blank:
            id = UUID().uuidString
        }
        pasteboard = scripted ? NSPasteboard.withUniqueName() : NSPasteboard.general
        let exactSize = scripted
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(AssetSchemeHandler(root: webRoot), forURLScheme: AssetSchemeHandler.scheme)
        // The page keeps nothing in the browser's own stores (its settings go through the
        // shell), so WebKit is given none to keep on disk.
        configuration.websiteDataStore = .nonPersistent()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.pageLogScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )

        let size = pageSize ?? Self.referencePageSize
        webView = EditorWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsMagnification = false
        webView.allowsLinkPreview = false
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        if scripted {
            webView.suppressesNativeMenus = true
            // WebKit pauses a page whose window the window server reports as covered, which
            // is every window on a locked Mac. Test-only SPI, as used by WebKit's own runner.
            let selector = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
            if webView.responds(to: selector) { webView.perform(selector, with: nil) }
        }

        window = EditorWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        super.init()

        bridge.webView = webView
        configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: Bridge.name)
        registerBridgeHandlers()

        // The title bar blends into the page: same colour, no title, traffic lights kept.
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = Self.pageBackground
        window.appearance = NSAppearance(named: .darkAqua)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.contentMinSize = Self.minimumPageSize
        window.allowsFrameBeyondScreen = exactSize
        window.simulatesKeyState = scripted
        if scripted {
            // Out of the way of whoever is using the Mac: off every display, and even
            // there not visible, not clickable, not in Mission Control or the window cycle.
            // The page still lays out and paints, because WebKit has been told above not
            // to wait for the window to be seen.
            window.alphaValue = 0
            window.ignoresMouseEvents = true
            window.hasShadow = false
            window.isExcludedFromWindowsMenu = true
            window.collectionBehavior = [.transient, .ignoresCycle, .stationary]
        }
        window.contentView = webView
        window.delegate = self
        window.setContentSize(exactSize ? size : Self.fit(size, to: NSScreen.main))
        window.center()
        if scripted {
            // Headless: parked far outside every display, as WebKit's own test runner does.
            window.setFrameOrigin(Self.offscreenOrigin)
        }

        webView.navigationDelegate = self
        webView.uiDelegate = self
        reflect()
        webView.load(URLRequest(url: AssetSchemeHandler.indexURL))
    }

    func show() {
        if scripted {
            window.orderBack(nil)
            window.makeFirstResponder(webView)
            NotificationCenter.default.post(name: NSWindow.didBecomeKeyNotification, object: window)
            NotificationCenter.default.post(name: NSWindow.didBecomeMainNotification, object: window)
        } else {
            window.makeKeyAndOrderFront(nil)
            window.makeFirstResponder(webView)
        }
    }

    private static func fit(_ size: NSSize, to screen: NSScreen?) -> NSSize {
        guard let visible = screen?.visibleFrame.size else { return size }
        let titleBar: CGFloat = 28
        return NSSize(
            width: max(minimumPageSize.width, min(size.width, visible.width)),
            height: max(minimumPageSize.height, min(size.height, visible.height - titleBar))
        )
    }

    // MARK: Bridge

    private func registerBridgeHandlers() {
        bridge.on("app.info", sync: { _ in
            [
                "inApp": true,
                "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev",
            ] as [String: Any]
        })
        bridge.on("app.ready", sync: { [weak self] _ in
            guard let self, !self.pageIsReady else { return nil }
            self.pageIsReady = true
            self.onPageReady?()
            return nil
        })
        bridge.on("settings.get", sync: { [weak self] _ in
            self?.settings.interface ?? [:]
        })
        bridge.on("settings.set", sync: { [weak self] params in
            self?.settings.updateInterface(params)
            return nil
        })
        bridge.on("clipboard.write", sync: { [weak self] params in
            guard let self, let text = params["text"] as? String else { throw Bridge.Failure("clipboard.write needs text") }
            self.pasteboard.clearContents()
            guard self.pasteboard.setString(text, forType: .string) else { throw Bridge.Failure("the text could not be copied") }
            return nil
        })
        // The one page the document sends anyone to is X's compose window, so that is the
        // one page the shell will open, whatever it is asked for.
        bridge.on("browser.open", sync: { [weak self] params in
            guard let self, let text = params["url"] as? String, let url = URL(string: text),
                  url.scheme == "https", url.host == "x.com", url.path == "/intent/post"
            else { throw Bridge.Failure("only X's compose window can be opened") }
            guard self.sendToBrowser(url) else { throw Bridge.Failure("the browser could not be opened") }
            return nil
        })
        bridge.on("doc.start", sync: { [weak self] _ in
            self?.takeStart()
        })
        bridge.on("doc.state", sync: { [weak self] params in
            self?.heard(params)
            return nil
        })
        bridge.on("file.save") { [weak self] params, reply in
            guard let self, let text = params["text"] as? String else { return reply(.failure(Bridge.Failure("file.save needs text"))) }
            guard !self.isAsking else { return reply(.success(["saved": false] as [String: Any])) }
            self.save(text, saveAs: params["as"] as? Bool ?? false) { saved in
                reply(.success(["saved": saved] as [String: Any]))
            }
        }
        bridge.on("file.open", sync: { [weak self] _ in
            if let self { self.onOpenRequest?(self) }
            return nil
        })
        bridge.on("draft.write", sync: { [weak self] params in
            guard let self, let text = params["text"] as? String else { return nil }
            self.store.keep(Draft(id: self.id, text: text, name: self.displayName, path: (self.fileURL ?? self.formerURL)?.path))
            return nil
        })
        // The AI is asked from here, where the key is, and its answer is passed back in pieces.
        bridge.on("ai.start", sync: { [weak self] params in
            guard let self else { return nil }
            try self.ai.start(params, for: self.id) { [weak self] event, payload in
                self?.bridge.emit(event, payload)
            }
            return nil
        })
        bridge.on("ai.cancel", sync: { [weak self] params in
            if let self, let id = params["id"] as? String { self.ai.cancel(id, for: self.id) }
            return nil
        })
        bridge.on("log", sync: { [weak self] params in
            let level = params["level"] as? String ?? "log"
            let message = params["message"] as? String ?? ""
            FileHandle.standardError.write(Data("[page:\(level)] \(message)\n".utf8))
            self?.onPageLog?(level, message)
            return nil
        })
    }

    /// Forwards uncaught page errors to the shell so they show up in the terminal and Console.
    private static let pageLogScript = """
    (() => {
      const post = (level, message) => {
        try { window.webkit.messageHandlers.writeon.postMessage({ method: 'log', params: { level, message: String(message) } }); } catch (_) {}
      };
      window.addEventListener('error', (e) => {
        post('error', (e.message || 'error') + (e.filename ? ' @ ' + e.filename.replace('writeon://app/', '') + ':' + e.lineno : ''));
      });
      window.addEventListener('unhandledrejection', (e) => {
        const r = e.reason;
        post('error', 'unhandled rejection: ' + (r && (r.stack || r.message) || r));
      });
      const original = console.error.bind(console);
      console.error = (...args) => { post('error', args.map((a) => (a && a.stack) || a).join(' ')); original(...args); };
    })();
    """

    // MARK: Navigation

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        if url.scheme == AssetSchemeHandler.scheme, url.host == AssetSchemeHandler.host {
            return decisionHandler(.allow)
        }
        if url.scheme == "http" || url.scheme == "https" {
            sendToBrowser(url)
        }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "http" || url.scheme == "https" {
            sendToBrowser(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Self.report("the page failed to load: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Self.report("the page failed while loading: \(error.localizedDescription)")
    }

    private static func report(_ message: String) {
        FileHandle.standardError.write(Data("[shell] \(message)\n".utf8))
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Self.report("the page process ended; reloading")
        pageIsReady = false
        ai.cancelAll(for: id)
        webView.load(URLRequest(url: AssetSchemeHandler.indexURL))
    }

    /// Hands a page to the browser. A scripted run only notes that it was asked.
    @discardableResult
    private func sendToBrowser(_ url: URL) -> Bool {
        guard !scripted else {
            askedToOpen.append(url)
            return true
        }
        return NSWorkspace.shared.open(url)
    }

    // MARK: Document

    /// What the document goes by: its file's name, or its first heading, or "Untitled".
    var displayName: String {
        if let fileURL { return fileURL.deletingPathExtension().lastPathComponent }
        return heading.isEmpty ? "Untitled" : heading
    }

    /// A window nobody has written in: where a file may open in place of what is there.
    var isPristine: Bool { fileURL == nil && !dirty }

    /// What the page starts with. Asked a second time, the page is starting over (its
    /// process ended), and gets back what there was: unsaved work from the copy kept aside,
    /// saved work from its file.
    func takeStart() -> [String: Any] {
        if startTaken {
            if let draft = store.draft(id) {
                return ["kind": "recovered", "text": draft.text, "name": fileURL?.lastPathComponent ?? draft.name]
            }
            if let fileURL, let text = try? store.read(fileURL) {
                return ["kind": "file", "text": text, "name": fileURL.lastPathComponent]
            }
        }
        startTaken = true
        switch start {
        case .welcome: return ["kind": "welcome"]
        case .blank: return ["kind": "blank"]
        case .file(let url, let text): return ["kind": "file", "text": text, "name": url.lastPathComponent]
        case .recovered(let draft): return ["kind": "recovered", "text": draft.text, "name": draft.name]
        }
    }

    /// Puts a file in this window, in place of a document nobody has written in.
    func load(_ url: URL, text: String) {
        fileURL = url.standardizedFileURL
        formerURL = nil
        dirty = false
        if startTaken {
            bridge.emit("file.opened", ["text": text, "name": url.lastPathComponent])
        } else {
            start = .file(url, text: text)
        }
        reflect()
    }

    private func heard(_ told: [String: Any]) {
        dirty = told["dirty"] as? Bool ?? dirty
        heading = told["name"] as? String ?? heading
        if let switches = told["flags"] as? [String: Any] { flags = switches.compactMapValues { $0 as? Bool } }
        if let can = told["can"] as? [String: Any] { able = can.compactMapValues { $0 as? Bool } }
        if !dirty { store.discardDraft(id) }
        reflect()
    }

    /// The window shows what the document is called and whether it has unsaved changes:
    /// in the Window menu and Mission Control, and as the dot in the close button.
    private func reflect() {
        window.title = displayName
        window.representedURL = fileURL
        window.isDocumentEdited = dirty
    }

    /// Writes the document to its file, asking where first if it has none or `saveAs` is set.
    private func save(_ text: String, saveAs: Bool, then done: @escaping (Bool) -> Void) {
        if let fileURL, !saveAs { return done(write(text, to: fileURL)) }
        let known = fileURL ?? formerURL
        let suggested = known?.lastPathComponent ?? "\(displayName).\(FileStore.fileExtension)"
        isAsking = true
        asking.whereToSave(suggested: suggested, in: known?.deletingLastPathComponent(), for: window) { [weak self] url in
            self?.isAsking = false
            guard let self, let url else { return done(false) }
            done(self.write(text, to: url))
        }
    }

    private func write(_ text: String, to url: URL) -> Bool {
        do {
            try store.write(text, to: url)
        } catch {
            asking.tell(
                "The document “\(displayName)” could not be saved as “\(url.lastPathComponent)”.",
                detail: error.localizedDescription, for: window
            )
            return false
        }
        fileURL = url.standardizedFileURL
        formerURL = nil
        dirty = false
        store.discardDraft(id)
        store.noteRecent(url)
        reflect()
        return true
    }

    /// Asks about unsaved changes, if there are any, and says whether the window may go.
    func confirmClose(then done: @escaping (Bool) -> Void) {
        guard dirty else { return done(true) }
        guard !isAsking else { return done(false) }
        isAsking = true
        asking.whetherToSave(displayName, for: window) { [weak self] choice in
            guard let self else { return done(false) }
            self.isAsking = false
            switch choice {
            case .cancel:
                done(false)
            case .discard:
                self.store.discardDraft(self.id)
                done(true)
            case .save:
                // The page saves as it would for Ctrl+S, and says how that went.
                self.bridge.ask("save") { answer in
                    done(((try? answer.get()) as? [String: Any])?["saved"] as? Bool ?? false)
                }
            }
        }
    }

    // MARK: Menu

    /// Has the page run one of its commands, as its shortcut would.
    func command(_ name: String) {
        bridge.emit("menu.command", ["name": name])
    }

    /// Whether the page has said `name` ("undo", "redo") can be done just now.
    func can(_ name: String) -> Bool {
        able[name] ?? false
    }

    /// Whether the page's switch `name` ("read", "overflow") is on; nil if it is not a switch.
    func isOn(_ name: String) -> Bool? {
        flags[name]
    }

    // MARK: Window

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard dirty else { return true }
        confirmClose { [weak self] may in
            if may { self?.window.close() }
        }
        return false
    }

    func windowWillClose(_ notification: Notification) {
        ai.cancelAll(for: id)
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Bridge.name, contentWorld: .page)
        onClosed?(self)
    }
}
