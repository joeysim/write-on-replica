import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controllers: [DocumentWindowController] = []
    private var harness: UITestHarness?
    private var webRoot: URL?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let root = AssetSchemeHandler.locateWebRoot() else {
            FileHandle.standardError.write(Data("Write_On cannot find its page (web/index.html).\n".utf8))
            exit(70)
        }
        webRoot = root
        NSApp.mainMenu = Self.buildMenu()

        let test = UITestOptions.parse(CommandLine.arguments)
        let controller = openWindow(pageSize: test?.pageSize, scripted: test != nil)
        NSApp.activate(ignoringOtherApps: true)
        if let test {
            harness = UITestHarness(options: test, controller: controller)
            harness?.start()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { openWindow() }
        return true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    @discardableResult
    func openWindow(pageSize: NSSize? = nil, scripted: Bool = false) -> DocumentWindowController {
        guard let webRoot else { fatalError("openWindow before launch finished") }
        let controller = DocumentWindowController(webRoot: webRoot, pageSize: pageSize, scripted: scripted)
        controller.onClosed = { [weak self] closed in
            self?.controllers.removeAll { $0 === closed }
        }
        controllers.append(controller)
        controller.show()
        return controller
    }

    @objc func newDocument(_ sender: Any?) {
        openWindow()
    }

    // MARK: Menu

    /// The first cut of the menu bar: enough for Quit, a new window and the standard
    /// editing commands. The full menu arrives with file handling.
    private static func buildMenu() -> NSMenu {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Write_On", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Write_On", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Write_On", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "New", action: #selector(AppDelegate.newDocument(_:)), keyEquivalent: "n")
        fileMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = fileMenu
        main.addItem(fileItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        main.addItem(editItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)
        NSApp.windowsMenu = windowMenu

        return main
    }
}
