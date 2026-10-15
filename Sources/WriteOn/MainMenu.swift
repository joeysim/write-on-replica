import AppKit

/// The menu bar (design spec 6.13). The page's commands keep the Control shortcuts they have
/// in the original, and show them here; files and editing get the usual Command keys.
///
/// A Control shortcut never reaches its menu item from the keyboard: the page takes the key
/// first, as WebKit gives it the chance to. The item is how the mouse gets to the command.
///
/// What belongs to a document (its commands, saving it) goes to the app delegate, which
/// passes it to the document in front. Editing commands go wherever the keyboard is, as
/// usual, so they work in a panel's text field too.
struct MainMenu {
    static let openRecentTitle = "Open Recent"

    static func build(for app: AppDelegate) -> NSMenu {
        MainMenu(app: app).build()
    }

    private unowned let app: AppDelegate

    private func build() -> NSMenu {
        let main = NSMenu()
        main.addItem(submenu(appMenu()))
        main.addItem(submenu(fileMenu()))
        main.addItem(submenu(editMenu()))
        main.addItem(submenu(viewMenu()))
        main.addItem(submenu(toolsMenu()))
        let window = windowMenu()
        main.addItem(submenu(window))
        NSApp.windowsMenu = window
        let help = helpMenu()
        main.addItem(submenu(help))
        NSApp.helpMenu = help
        return main
    }

    // MARK: Menus

    private func appMenu() -> NSMenu {
        let menu = NSMenu(title: "Write_On")
        menu.addItem(item("About Write_On", #selector(AppDelegate.showAbout(_:))))
        menu.addItem(.separator())
        menu.addItem(item("Settings…", #selector(AppDelegate.showSettings(_:)), ","))
        menu.addItem(.separator())
        let services = NSMenu(title: "Services")
        menu.addItem(submenu(services))
        NSApp.servicesMenu = services
        menu.addItem(.separator())
        menu.addItem(item("Hide Write_On", #selector(NSApplication.hide(_:)), "h"))
        menu.addItem(item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]))
        menu.addItem(item("Show All", #selector(NSApplication.unhideAllApplications(_:))))
        menu.addItem(.separator())
        menu.addItem(item("Quit Write_On", #selector(NSApplication.terminate(_:)), "q"))
        return menu
    }

    private func fileMenu() -> NSMenu {
        let menu = NSMenu(title: "File")
        menu.addItem(item("New", #selector(AppDelegate.newDocument(_:)), "n"))
        menu.addItem(item("Open…", #selector(AppDelegate.openDocument(_:)), "o"))
        // Filled in each time it opens, from the recent documents there are then.
        let recent = NSMenu(title: Self.openRecentTitle)
        recent.delegate = app
        menu.addItem(submenu(recent))
        menu.addItem(.separator())
        menu.addItem(item("Close", #selector(NSWindow.performClose(_:)), "w"))
        menu.addItem(forDocument(item("Save…", #selector(AppDelegate.saveDocument(_:)), "s")))
        menu.addItem(forDocument(item("Save As…", #selector(AppDelegate.saveDocumentAs(_:)), "s", [.command, .shift])))
        menu.addItem(.separator())
        menu.addItem(command("Post to X", "post", "p", [.control, .shift]))
        return menu
    }

    private func editMenu() -> NSMenu {
        let menu = NSMenu(title: "Edit")
        menu.addItem(item("Undo", #selector(EditorWebView.undo(_:)), "z"))
        menu.addItem(item("Redo", #selector(EditorWebView.redo(_:)), "z", [.command, .shift]))
        menu.addItem(.separator())
        menu.addItem(item("Cut", #selector(NSText.cut(_:)), "x"))
        menu.addItem(item("Copy", #selector(NSText.copy(_:)), "c"))
        menu.addItem(item("Paste", #selector(NSText.paste(_:)), "v"))
        menu.addItem(item("Delete", #selector(NSText.delete(_:))))
        menu.addItem(item("Select All", #selector(NSText.selectAll(_:)), "a"))
        menu.addItem(.separator())

        // The standard checking and correcting, all of it off until it is turned on here.
        let spelling = NSMenu(title: "Spelling and Grammar")
        spelling.addItem(item("Show Spelling and Grammar", #selector(NSText.showGuessPanel(_:)), ":"))
        spelling.addItem(item("Check Document Now", #selector(NSText.checkSpelling(_:)), ";"))
        spelling.addItem(.separator())
        spelling.addItem(item("Check Spelling While Typing", #selector(NSTextView.toggleContinuousSpellChecking(_:))))
        spelling.addItem(item("Check Grammar With Spelling", #selector(NSTextView.toggleGrammarChecking(_:))))
        spelling.addItem(item("Correct Spelling Automatically", #selector(NSTextView.toggleAutomaticSpellingCorrection(_:))))
        menu.addItem(submenu(spelling))

        let substitutions = NSMenu(title: "Substitutions")
        substitutions.addItem(item("Show Substitutions", #selector(NSTextView.orderFrontSubstitutionsPanel(_:))))
        substitutions.addItem(.separator())
        substitutions.addItem(item("Smart Copy/Paste", #selector(NSTextView.toggleSmartInsertDelete(_:))))
        substitutions.addItem(item("Smart Quotes", #selector(NSTextView.toggleAutomaticQuoteSubstitution(_:))))
        substitutions.addItem(item("Smart Dashes", #selector(NSTextView.toggleAutomaticDashSubstitution(_:))))
        substitutions.addItem(item("Text Replacement", #selector(NSTextView.toggleAutomaticTextReplacement(_:))))
        menu.addItem(submenu(substitutions))

        let speech = NSMenu(title: "Speech")
        speech.addItem(item("Start Speaking", #selector(NSTextView.startSpeaking(_:))))
        speech.addItem(item("Stop Speaking", #selector(NSTextView.stopSpeaking(_:))))
        menu.addItem(submenu(speech))
        return menu
    }

    private func viewMenu() -> NSMenu {
        let menu = NSMenu(title: "View")
        menu.addItem(command("Read Mode", "read", "r", [.control, .shift]))
        menu.addItem(command("Alternates", "alternates"))
        menu.addItem(.separator())
        menu.addItem(command("Overflow", "overflow", "d", [.control, .shift]))
        menu.addItem(command("Source", "source", "u", [.control]))
        menu.addItem(.separator())
        menu.addItem(item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]))
        return menu
    }

    private func toolsMenu() -> NSMenu {
        let menu = NSMenu(title: "Tools")
        menu.addItem(command("Alternatives", "alternatives", "a", [.control, .shift]))
        menu.addItem(command("AI Alternatives", "ai-alternatives", "g", [.control, .shift]))
        menu.addItem(.separator())
        menu.addItem(command("Ghost or Revive", "ghost", "/", [.control]))
        menu.addItem(command("Stash in Overflow", "stash", "x", [.control, .shift]))
        menu.addItem(.separator())
        menu.addItem(command("The Lab", "lab"))
        return menu
    }

    private func windowMenu() -> NSMenu {
        let menu = NSMenu(title: "Window")
        menu.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"))
        menu.addItem(item("Zoom", #selector(NSWindow.performZoom(_:))))
        menu.addItem(.separator())
        menu.addItem(item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))))
        return menu
    }

    private func helpMenu() -> NSMenu {
        let menu = NSMenu(title: "Help")
        menu.addItem(command("Keyboard Shortcuts", "shortcuts"))
        menu.addItem(item("The Welcome Piece", #selector(AppDelegate.showWelcome(_:))))
        return menu
    }

    // MARK: Items

    private func submenu(_ menu: NSMenu) -> NSMenuItem {
        let item = NSMenuItem(title: menu.title, action: nil, keyEquivalent: "")
        item.submenu = menu
        return item
    }

    private func item(_ title: String, _ action: Selector, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        if !key.isEmpty { item.keyEquivalentModifierMask = modifiers }
        return item
    }

    /// An item that has the page run one of its commands, in the document in front.
    private func command(_ title: String, _ name: String, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = []) -> NSMenuItem {
        let item = forDocument(item(title, #selector(AppDelegate.pageCommand(_:)), key, modifiers))
        item.representedObject = name
        return item
    }

    private func forDocument(_ item: NSMenuItem) -> NSMenuItem {
        item.target = app
        return item
    }
}
