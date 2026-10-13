import AppKit

/// The Settings window (design spec 7.1): the key for the AI service, its address, the way
/// it is spoken to and the model to ask, a button that tries them together, and whether the
/// app makes sounds. Nothing else. What is changed here is used from the next request on.
final class SettingsWindowController: NSObject, NSTextFieldDelegate {
    private let settings: AppSettings
    private let credentials: Credentials
    private let client: AIClient
    /// The sound was turned on or off: open windows are to follow.
    private let onSound: (Bool) -> Void

    // The controls. A scripted run works them without the window ever being shown.
    let keyField = NSSecureTextField()
    let keyNote = NSTextField(wrappingLabelWithString: "")
    let forgetButton = NSButton(title: "Remove the saved key", target: nil, action: nil)
    let addressField = NSTextField()
    /// The way the service is spoken to. The first choice leaves it to the address (or the
    /// environment), and says which way that comes to.
    let formatPopup = NSPopUpButton()
    let modelField = NSTextField()
    let testButton = NSButton(title: "Test connection", target: nil, action: nil)
    let testNote = NSTextField(wrappingLabelWithString: "")
    let soundBox = NSButton(checkboxWithTitle: "Play sounds", target: nil, action: nil)

    private var window: NSWindow?
    var isShown: Bool { window?.isVisible ?? false }
    /// Lookups and tests still on their way. (A scripted run waits for none before it reads the notes.)
    private(set) var pending = 0
    /// How many lookups have been started: only the last one's answer is shown.
    private var lookups = 0

    init(settings: AppSettings, credentials: Credentials, client: AIClient, onSound: @escaping (Bool) -> Void) {
        self.settings = settings
        self.credentials = credentials
        self.client = client
        self.onSound = onSound
        super.init()
        keyField.placeholderString = "Paste a key to save it in your keychain"
        addressField.placeholderString = AIClient.defaultAddress
        modelField.placeholderString = AIClient.defaultModel
        formatPopup.addItem(withTitle: "Automatic")
        for wire in AIWire.allCases {
            formatPopup.addItem(withTitle: wire.title)
            formatPopup.lastItem?.representedObject = wire.rawValue
        }
        for (control, action) in [
            (keyField as NSControl, #selector(saveKey(_:))), (forgetButton, #selector(forgetKey(_:))),
            (addressField, #selector(saveAddress(_:))), (formatPopup, #selector(saveFormat(_:))), (modelField, #selector(saveModel(_:))),
            (testButton, #selector(test(_:))), (soundBox, #selector(saveSound(_:))),
        ] {
            control.target = self
            control.action = action
        }
        for field in [keyField, addressField, modelField] { field.delegate = self }
        for note in [keyNote, testNote] {
            note.textColor = .secondaryLabelColor
            note.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        }
        refresh()
    }

    func show() {
        refresh()
        let window = window ?? makeWindow()
        if self.window == nil { window.center() }
        self.window = window
        window.makeKeyAndOrderFront(nil)
    }

    /// The window's contents as a picture, without the window being shown: how a scripted
    /// run gets to look at the layout.
    func picture() -> Data? {
        let window = window ?? makeWindow()
        self.window = window
        guard let view = window.contentView else { return nil }
        view.layoutSubtreeIfNeeded()
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
        // First the window's own ground, which the content view leaves to the window to paint.
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        view.effectiveAppearance.performAsCurrentDrawingAppearance {
            NSColor.windowBackgroundColor.setFill()
            view.bounds.fill()
        }
        NSGraphicsContext.restoreGraphicsState()
        view.cacheDisplay(in: view.bounds, to: bitmap)
        return bitmap.representation(using: .png, properties: [:])
    }

    /// Shows what is in force now.
    func refresh() {
        addressField.stringValue = settings.aiAddress ?? ""
        modelField.stringValue = settings.aiModel ?? ""
        let chosen = AIWire(named: settings.aiFormat)
        formatPopup.selectItem(at: chosen.flatMap { formatPopup.indexOfItem(withRepresentedObject: $0.rawValue) } ?? 0)
        soundBox.state = (settings.interface["sound"] as? Bool ?? true) ? .on : .off
        showKey()
    }

    /// Where the key comes from, and what is in force where Settings itself says nothing:
    /// in the address and model fields, while they are empty, the environment's if it
    /// names any, else the usual ones; and beside "Automatic", the way the service is then
    /// spoken to. Looked up off the main thread: the first time, that can mean asking the
    /// login shell.
    private func showKey() {
        let credentials = credentials
        let chosen = settings.aiAddress
        pending += 1
        lookups += 1
        let mine = lookups
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let address = credentials.address() ?? AIClient.defaultAddress
            let model = credentials.model() ?? AIClient.defaultModel
            // Which key goes depends on where: one under LunaRoute's name is LunaRoute's.
            let found = AIWire.web(chosen ?? address).map { AIClient.key(for: $0, from: credentials) }
            let source = found?.key?.source
            let taken = AIClient.wire(for: chosen ?? address, chosen: nil, from: credentials)
            DispatchQueue.main.async {
                guard let self else { return }
                self.pending -= 1
                guard mine == self.lookups else { return }
                if let source {
                    self.keyNote.stringValue = "Using the key \(AIClient.describe(source))."
                } else if found?.kept == true {
                    self.keyNote.stringValue = "The key in \(Credentials.keyNames[1]) is LunaRoute’s, and is not sent to this address. Paste one here, or set \(Credentials.keyNames[0])."
                } else {
                    self.keyNote.stringValue = "No key yet. Paste one here, or set \(Credentials.keyNames[0])."
                }
                self.forgetButton.isHidden = source != .settings
                self.addressField.placeholderString = address
                self.modelField.placeholderString = model
                self.formatPopup.item(at: 0)?.title = "Automatic: \(taken.title)"
            }
        }
    }

    // MARK: Actions

    @objc func saveKey(_ sender: Any?) {
        let typed = keyField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !typed.isEmpty else { return }
        credentials.save(typed)
        // Saved, and not left on show.
        keyField.stringValue = ""
        showKey()
    }

    @objc func forgetKey(_ sender: Any?) {
        credentials.save(nil)
        showKey()
    }

    @objc func saveAddress(_ sender: Any?) {
        settings.aiAddress = addressField.stringValue
        addressField.stringValue = settings.aiAddress ?? ""
        // Which key goes with it may have changed.
        showKey()
    }

    @objc func saveFormat(_ sender: Any?) {
        settings.aiFormat = formatPopup.selectedItem?.representedObject as? String
    }

    @objc func saveModel(_ sender: Any?) {
        settings.aiModel = modelField.stringValue
        modelField.stringValue = settings.aiModel ?? ""
    }

    @objc func saveSound(_ sender: Any?) {
        let on = soundBox.state == .on
        settings.updateInterface(["sound": on])
        onSound(on)
    }

    @objc func test(_ sender: Any?) {
        // Whatever is in the fields is what gets tried, as if Return had been pressed in each.
        saveKey(nil)
        saveAddress(nil)
        saveFormat(nil)
        saveModel(nil)
        testButton.isEnabled = false
        testNote.stringValue = "Asking…"
        pending += 1
        client.test { [weak self] report in
            guard let self else { return }
            self.pending -= 1
            self.testNote.stringValue = report
            self.testButton.isEnabled = true
            self.showKey()
        }
    }

    /// Leaving a field keeps what was typed in it, as Return does.
    func controlTextDidEndEditing(_ notification: Notification) {
        guard let field = notification.object as? NSTextField else { return }
        if field === keyField { saveKey(nil) }
        if field === addressField { saveAddress(nil) }
        if field === modelField { saveModel(nil) }
    }

    // MARK: Window

    private func makeWindow() -> NSWindow {
        let label = { (text: String) -> NSTextField in
            let label = NSTextField(labelWithString: text)
            label.alignment = .right
            return label
        }
        let testRow = NSStackView(views: [testButton])
        let keyRow = NSStackView(views: [keyNote, forgetButton])
        keyRow.alignment = .firstBaseline
        forgetButton.controlSize = .small
        forgetButton.bezelStyle = .inline
        let grid = NSGridView(views: [
            [label("API key"), keyField],
            [NSGridCell.emptyContentView, keyRow],
            [label("Address"), addressField],
            [label("Format"), formatPopup],
            [label("Model"), modelField],
            [NSGridCell.emptyContentView, testRow],
            [NSGridCell.emptyContentView, testNote],
            [NSGridCell.emptyContentView, soundBox],
        ])
        grid.rowSpacing = 10
        grid.columnSpacing = 10
        grid.column(at: 0).xPlacement = .trailing
        grid.rowAlignment = .firstBaseline
        grid.row(at: 7).topPadding = 12
        grid.translatesAutoresizingMaskIntoConstraints = false
        for field in [keyField, addressField, modelField] { field.widthAnchor.constraint(equalToConstant: 340).isActive = true }
        keyNote.preferredMaxLayoutWidth = 340
        testNote.preferredMaxLayoutWidth = 340

        let content = NSView()
        content.addSubview(grid)
        NSLayoutConstraint.activate([
            grid.topAnchor.constraint(equalTo: content.topAnchor, constant: 22),
            grid.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 22),
            grid.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -22),
            grid.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -22),
        ])
        let window = NSWindow(contentRect: .zero, styleMask: [.titled, .closable], backing: .buffered, defer: true)
        window.title = "Settings"
        window.isReleasedWhenClosed = false
        window.contentView = content
        window.setContentSize(content.fittingSize)
        return window
    }
}
