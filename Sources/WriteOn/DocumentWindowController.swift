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

    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        allowsFrameBeyondScreen ? frameRect : super.constrainFrameRect(frameRect, to: screen)
    }
}

final class EditorWebView: WKWebView {
    /// A scripted run cannot dismiss a native menu, so the harness turns them off.
    var suppressesNativeMenus = false

    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        if suppressesNativeMenus {
            menu.removeAllItems()
        } else {
            super.willOpenMenu(menu, with: event)
        }
    }
}

/// One window, one document. Owns the web view that hosts the page.
final class DocumentWindowController: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    static let pageBackground = NSColor(srgbRed: 5 / 255, green: 10 / 255, blue: 28 / 255, alpha: 1)
    /// The page size the source clips were recorded at; the default for a new window.
    static let referencePageSize = NSSize(width: 1548, height: 976)
    static let minimumPageSize = NSSize(width: 720, height: 480)

    let window: EditorWindow
    let webView: EditorWebView
    let bridge = Bridge()

    private(set) var pageIsReady = false
    var onPageReady: (() -> Void)?
    var onPageLog: ((_ level: String, _ message: String) -> Void)?
    var onClosed: ((DocumentWindowController) -> Void)?

    private let scripted: Bool

    /// - Parameters:
    ///   - pageSize: content size in points; defaults to the reference size, fitted to the screen.
    ///   - scripted: a UI test run. Keeps `pageSize` exactly, and makes the page behave as
    ///     visible and focused even when the Mac is locked.
    init(webRoot: URL, pageSize: NSSize? = nil, scripted: Bool = false) {
        self.scripted = scripted
        let exactSize = scripted
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(AssetSchemeHandler(root: webRoot), forURLScheme: AssetSchemeHandler.scheme)
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
        window.contentView = webView
        window.delegate = self
        window.setContentSize(exactSize ? size : Self.fit(size, to: NSScreen.main))
        window.center()
        if exactSize, let screen = NSScreen.main {
            // Keep the title bar on screen; the bottom may hang off a small display.
            var frame = window.frame
            frame.origin.y = screen.visibleFrame.maxY - frame.height
            window.setFrame(frame, display: false)
        }

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.load(URLRequest(url: AssetSchemeHandler.indexURL))
    }

    func show() {
        if scripted {
            window.orderFrontRegardless()
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
            NSWorkspace.shared.open(url)
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
            NSWorkspace.shared.open(url)
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
        webView.load(URLRequest(url: AssetSchemeHandler.indexURL))
    }

    // MARK: Window

    func windowWillClose(_ notification: Notification) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Bridge.name, contentWorld: .page)
        onClosed?(self)
    }
}
