import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate, NSMenuItemValidation {
    private var controllers: [DocumentWindowController] = []
    private var harness: UITestHarness?
    private var webRoot: URL?
    private var settings = AppSettings.standard
    private(set) var store = FileStore()
    private var asking: Asking = Panels()
    /// The key for the AI service: from Settings (the keychain), the environment or the login shell.
    private(set) var credentials = Credentials(saved: KeychainSecret(service: "com.thesimhons.writeon", account: "LunaRoute API key"))
    private lazy var client = AIClient(credentials: credentials, settings: settings)
    private(set) lazy var settingsPanel = SettingsWindowController(settings: settings, credentials: credentials, client: client) { [weak self] on in
        // Every open window hears that the sound was turned on or off.
        self?.controllers.forEach { $0.bridge.emit("settings.changed", ["sound": on]) }
    }
    private var launched = false
    /// Files handed over before the app was ready for them.
    private var waiting: [URL] = []
    /// A UI test run: one window, never in front, and nothing shown that waits for a person.
    private var scripted = false
    /// The Open panel is up. One at a time.
    private var choosing = false
    /// The windows a scripted run was asked for beyond its one. It opens none of them.
    private(set) var windowsAskedFor: [DocumentStart] = []

    /// Checking and correcting are there to be turned on (Edit ▸ Spelling and Grammar,
    /// Substitutions) and are off until they are, so the page shows what was typed. These
    /// are the settings WebKit keeps them under; unset, some would follow the system's.
    static let typingDefaults: [String: Any] = [
        "WebContinuousSpellCheckingEnabled": false,
        "WebGrammarCheckingEnabled": false,
        "WebAutomaticSpellingCorrectionEnabled": false,
        "WebAutomaticQuoteSubstitutionEnabled": false,
        "WebAutomaticDashSubstitutionEnabled": false,
        "WebAutomaticTextReplacementEnabled": false,
    ]

    func applicationWillFinishLaunching(_ notification: Notification) {
        UserDefaults.standard.register(defaults: Self.typingDefaults)
        // One document to a window: no tab bar, and none of its items in the View menu.
        NSWindow.allowsAutomaticWindowTabbing = false
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let root = AssetSchemeHandler.locateWebRoot() else {
            FileHandle.standardError.write(Data("Write_On cannot find its page (web/index.html).\n".utf8))
            exit(70)
        }
        webRoot = root
        NSApp.mainMenu = MainMenu.build(for: self)
        launched = true

        if let test = UITestOptions.parse(CommandLine.arguments) {
            // A scripted run starts from the settings it names and saves nothing. It is
            // silent unless it asks for sound, keeps its files in a folder of its own,
            // answers its own questions, and types as the app does when new, whatever
            // has been turned on in the Edit menu since.
            scripted = true
            var initial = test.settings
            if initial["sound"] == nil { initial["sound"] = false }
            settings = AppSettings(defaults: nil, initial: initial)
            store = FileStore(stateDirectory: test.state)
            let answers = ScriptedAsking(folder: test.output)
            asking = answers
            UserDefaults.standard.setVolatileDomain(Self.typingDefaults, forName: UserDefaults.argumentDomain)
            // The keychain is the person's: a scripted run keeps a saved key in memory. It
            // uses the key and the address in its environment only where they were meant:
            // against the real service when it says it is a live run (`--ai live`),
            // otherwise only if the address is on this Mac. It asks the login shell for a
            // key only when live. And unless it is live, its client asks nothing that is
            // not on this Mac, whatever address and key a scenario gives it.
            var environment = ProcessInfo.processInfo.environment
            let named = Credentials(saved: MemorySecret(), environment: environment, readShell: nil).address()
            let local = named.flatMap(AIWire.web).map(AIClient.isOnThisMac) ?? false
            if !test.aiLive, !local { (Credentials.keyNames + Credentials.addressNames).forEach { environment[$0] = nil } }
            // Which way a service is spoken to and which model is asked are a scenario's
            // to say, not whoever runs it.
            if !test.aiLive { (Credentials.formatNames + Credentials.modelNames).forEach { environment[$0] = nil } }
            credentials = Credentials(saved: MemorySecret(), environment: environment, readShell: test.aiLive ? LoginShell.read : nil)
            client = AIClient(credentials: credentials, settings: settings, idle: test.aiIdle ?? 60, localOnly: !test.aiLive)

            let start = store.drafts().first.map { DocumentStart.recovered($0) } ?? untitledStart()
            guard let controller = openWindow(start, pageSize: test.pageSize) else { exit(70) }
            // Never activated: the keyboard and pointer stay with whoever is at the Mac.
            harness = UITestHarness(options: test, controller: controller, app: self, answers: answers)
            harness?.start()
            return
        }

        // Unsaved work from before a crash comes back first, as unsaved documents.
        for draft in store.drafts() { openWindow(.recovered(draft)) }
        let files = waiting
        waiting = []
        files.forEach { open($0) }
        if controllers.isEmpty { openWindow(untitledStart()) }
        // Not brought to the front by force: the system does that for an app opened from
        // Finder or the Dock, and leaves one alone that was asked to open in the background.
    }

    /// A click on the Dock icon with no window to show: a new one, which is the app's to
    /// open. AppKit is not to try opening a document of its own, here or at launch.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        guard !flag else { return true }
        openWindow(untitledStart())
        return false
    }

    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool { false }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    /// Files from Finder, the Dock or `open`.
    func application(_ application: NSApplication, open urls: [URL]) {
        guard launched else {
            waiting += urls
            return
        }
        urls.forEach { open($0) }
    }

    // MARK: Windows

    /// What a window with no file opens with: the welcome piece the first time there is
    /// one, a blank page ever after.
    private func untitledStart() -> DocumentStart {
        if settings.welcomed { return .blank }
        settings.welcomed = true
        return .welcome
    }

    private var front: DocumentWindowController? {
        controllers.first { $0.window.isMainWindow } ?? controllers.last
    }

    @discardableResult
    func openWindow(_ start: DocumentStart, pageSize: NSSize? = nil) -> DocumentWindowController? {
        guard let webRoot else { fatalError("openWindow before launch finished") }
        if scripted, !controllers.isEmpty {
            windowsAskedFor.append(start)
            return nil
        }
        let controller = DocumentWindowController(
            webRoot: webRoot, settings: settings, store: store, asking: asking, ai: client,
            start: start, pageSize: pageSize, scripted: scripted
        )
        controller.onClosed = { [weak self] closed in
            self?.controllers.removeAll { $0 === closed }
        }
        controller.onOpenRequest = { [weak self] from in
            self?.chooseAndOpen(from: from)
        }
        if let before = controllers.last, !scripted {
            // A step down and to the right of the window before, so both can be seen.
            let origin = before.window.frame.origin
            controller.window.setFrameOrigin(NSPoint(x: origin.x + 24, y: origin.y - 24))
        }
        controllers.append(controller)
        controller.show()
        return controller
    }

    /// Opens a file: in the window that already has it, or in one nobody has written in
    /// (the one it was asked for from, for choice), or in a window of its own.
    func open(_ url: URL, preferring current: DocumentWindowController? = nil) {
        let url = url.standardizedFileURL
        if let showing = controllers.first(where: { $0.fileURL == url }) {
            showing.show()
            return
        }
        let text: String
        do {
            text = try store.read(url)
        } catch {
            asking.tell("The document “\(url.lastPathComponent)” could not be opened.", detail: error.localizedDescription, for: current?.window)
            return
        }
        store.noteRecent(url)
        let unwritten = current.flatMap { $0.isPristine ? $0 : nil } ?? controllers.first { $0.isPristine }
        if let unwritten {
            unwritten.load(url, text: text)
            unwritten.show()
        } else {
            openWindow(.file(url, text: text))
        }
    }

    private func chooseAndOpen(from controller: DocumentWindowController?) {
        guard !choosing else { return }
        choosing = true
        asking.whatToOpen(for: controller?.window) { [weak self] urls in
            self?.choosing = false
            urls.forEach { self?.open($0, preferring: controller) }
        }
    }

    // MARK: Menu actions

    /// The standard About panel, with the version line `aboutOptions` gives.
    @objc func showAbout(_ sender: Any?) {
        NSApp.orderFrontStandardAboutPanel(options: Self.aboutOptions(Bundle.main.infoDictionary ?? [:]))
    }

    /// What About gives as the version. A release's build gives its own, and the panel is left
    /// as it is. Any other build gives where it came from, as git named it when it was built
    /// (scripts/build-app.sh writes that down as WriteOnSource), and says it is a development build.
    static func aboutOptions(_ info: [String: Any]) -> [NSApplication.AboutPanelOptionKey: Any] {
        guard let source = info["WriteOnSource"] as? String,
              source != "v" + (info["CFBundleShortVersionString"] as? String ?? "")
        else { return [:] }
        return [.applicationVersion: source.hasPrefix("v") ? String(source.dropFirst()) : source, .version: "development"]
    }

    @objc func newDocument(_ sender: Any?) {
        openWindow(.blank)
    }

    @objc func openDocument(_ sender: Any?) {
        chooseAndOpen(from: front)
    }

    @objc func openRecent(_ sender: NSMenuItem) {
        if let url = sender.representedObject as? URL { open(url, preferring: front) }
    }

    @objc func clearRecents(_ sender: Any?) {
        store.clearRecents()
    }

    @objc func showWelcome(_ sender: Any?) {
        openWindow(.welcome)
    }

    @objc func showSettings(_ sender: Any?) {
        // A scripted run works the Settings controls without a window (test.settings).
        if !scripted { settingsPanel.show() }
    }

    // What belongs to a document goes to the one in front.

    @objc func pageCommand(_ sender: NSMenuItem) {
        if let name = sender.representedObject as? String { front?.command(name) }
    }

    @objc func saveDocument(_ sender: Any?) {
        front?.command("save")
    }

    @objc func saveDocumentAs(_ sender: Any?) {
        front?.command("save-as")
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(pageCommand(_:)), #selector(saveDocument(_:)), #selector(saveDocumentAs(_:)):
            // Not while the document is waiting on a panel: there is nothing to do it to yet.
            guard let front, !front.isAsking else { return false }
            if let name = item.representedObject as? String, let on = front.isOn(name) { item.state = on ? .on : .off }
            return true
        case #selector(openDocument(_:)):
            return !choosing
        default:
            return true
        }
    }

    /// Open Recent is made anew each time it is opened.
    func menuNeedsUpdate(_ menu: NSMenu) {
        guard menu.title == MainMenu.openRecentTitle else { return }
        menu.removeAllItems()
        let recents = store.recents
        for url in recents {
            let item = NSMenuItem(title: url.lastPathComponent, action: #selector(openRecent(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = url
            item.toolTip = url.path
            menu.addItem(item)
        }
        if !recents.isEmpty { menu.addItem(.separator()) }
        let clear = NSMenuItem(title: "Clear Menu", action: recents.isEmpty ? nil : #selector(clearRecents(_:)), keyEquivalent: "")
        clear.target = self
        menu.addItem(clear)
    }

    // MARK: Quitting

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard controllers.contains(where: { $0.dirty }) else { return .terminateNow }
        reviewUnsaved { sender.reply(toApplicationShouldTerminate: $0) }
        return .terminateLater
    }

    /// Asks about each document with unsaved changes in turn, and says whether the app may
    /// go: not if any of them is to be kept open.
    func reviewUnsaved(then done: @escaping (Bool) -> Void) {
        var unsaved = controllers.filter { $0.dirty }
        func next() {
            guard !unsaved.isEmpty else { return done(true) }
            let controller = unsaved.removeFirst()
            controller.show()
            controller.confirmClose { may in
                if may { next() } else { done(false) }
            }
        }
        next()
    }
}
