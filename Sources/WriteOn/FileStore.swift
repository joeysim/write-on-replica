import AppKit
import UniformTypeIdentifiers

/// Unsaved work, copied aside against a crash.
struct Draft {
    let id: String
    var text: String
    /// What the document was called.
    var name: String
    /// The file it belonged to, if it had one.
    var path: String?
}

/// Documents on disk: reading and writing them, the list of recent ones, and the drafts.
final class FileStore {
    static let fileExtension = "md"
    static let markdown = UTType(filenameExtension: fileExtension, conformingTo: .plainText) ?? .plainText

    private let draftsDirectory: URL
    /// Whether recent documents are the system's list (the Apple menu, the Dock) or one
    /// kept here, for a scripted run that must leave the system's alone.
    private let usesSystemRecents: Bool
    private var ownRecents: [URL] = []

    /// - Parameter stateDirectory: where a scripted run keeps its drafts. Left out, drafts go
    ///   in the app's place in Application Support.
    init(stateDirectory: URL? = nil) {
        if let stateDirectory {
            draftsDirectory = stateDirectory.appendingPathComponent("Drafts", isDirectory: true)
            usesSystemRecents = false
        } else {
            let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support", isDirectory: true)
            draftsDirectory = support.appendingPathComponent("Write_On/Drafts", isDirectory: true)
            usesSystemRecents = true
        }
    }

    // MARK: Documents

    /// The file as text. UTF-8 is what the app writes; a file in another encoding that
    /// declares itself is read as it is, and anything else as Latin-1 rather than refused.
    func read(_ url: URL) throws -> String {
        let data = try Data(contentsOf: url)
        if let text = String(data: data, encoding: .utf8) { return text }
        var encoding = String.Encoding.utf8
        if let text = try? String(contentsOf: url, usedEncoding: &encoding) { return text }
        return String(data: data, encoding: .isoLatin1) ?? ""
    }

    func write(_ text: String, to url: URL) throws {
        try Data(text.utf8).write(to: url, options: .atomic)
    }

    // MARK: Recent documents

    var recents: [URL] {
        usesSystemRecents ? NSDocumentController.shared.recentDocumentURLs : ownRecents
    }

    func noteRecent(_ url: URL) {
        if usesSystemRecents {
            NSDocumentController.shared.noteNewRecentDocumentURL(url)
        } else {
            ownRecents.removeAll { $0 == url }
            ownRecents.insert(url, at: 0)
        }
    }

    func clearRecents() {
        if usesSystemRecents {
            NSDocumentController.shared.clearRecentDocuments(nil)
        } else {
            ownRecents = []
        }
    }

    // MARK: Drafts

    private func draftURL(_ id: String) -> URL {
        draftsDirectory.appendingPathComponent(id).appendingPathExtension("json")
    }

    /// Keeps `draft`, replacing the one kept before under the same id.
    func keep(_ draft: Draft) {
        var record: [String: Any] = ["version": 1, "name": draft.name, "text": draft.text]
        if let path = draft.path { record["path"] = path }
        do {
            try FileManager.default.createDirectory(at: draftsDirectory, withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: record).write(to: draftURL(draft.id), options: .atomic)
        } catch {
            FileHandle.standardError.write(Data("[shell] a draft could not be kept: \(error.localizedDescription)\n".utf8))
        }
    }

    func discardDraft(_ id: String) {
        try? FileManager.default.removeItem(at: draftURL(id))
    }

    func draft(_ id: String) -> Draft? {
        guard let data = try? Data(contentsOf: draftURL(id)),
              let record = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let text = record["text"] as? String
        else { return nil }
        return Draft(id: id, text: text, name: record["name"] as? String ?? "", path: record["path"] as? String)
    }

    /// Every draft there is, oldest first. What cannot be read is passed over and left.
    func drafts() -> [Draft] {
        let keys: [URLResourceKey] = [.contentModificationDateKey]
        let files = (try? FileManager.default.contentsOfDirectory(at: draftsDirectory, includingPropertiesForKeys: keys)) ?? []
        let dated = files.filter { $0.pathExtension == "json" }.map { url in
            (url, (try? url.resourceValues(forKeys: Set(keys)))?.contentModificationDate ?? .distantPast)
        }
        return dated.sorted { $0.1 < $1.1 }.compactMap { draft($0.0.deletingPathExtension().lastPathComponent) }
    }
}

// MARK: - Asking

enum UnsavedChoice {
    case save, discard, cancel
}

/// What the shell asks the person at the Mac, and tells them. A scripted run has no one to
/// ask, and answers for itself.
protocol Asking: AnyObject {
    /// - Parameter suggested: a file name, with its extension.
    func whereToSave(suggested: String, in directory: URL?, for window: NSWindow?, then reply: @escaping (URL?) -> Void)
    func whatToOpen(for window: NSWindow?, then reply: @escaping ([URL]) -> Void)
    func whetherToSave(_ name: String, for window: NSWindow?, then reply: @escaping (UnsavedChoice) -> Void)
    func tell(_ message: String, detail: String, for window: NSWindow?)
}

/// The standard panels and alerts, as sheets on the window they concern.
final class Panels: Asking {
    func whereToSave(suggested: String, in directory: URL?, for window: NSWindow?, then reply: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [FileStore.markdown]
        panel.nameFieldStringValue = suggested
        panel.directoryURL = directory
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        present(panel, on: window) { reply($0 == .OK ? panel.url : nil) }
    }

    func whatToOpen(for window: NSWindow?, then reply: @escaping ([URL]) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [FileStore.markdown, .plainText]
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        // Not a sheet: what is chosen may well open in a window of its own.
        panel.begin { reply($0 == .OK ? panel.urls : []) }
    }

    func whetherToSave(_ name: String, for window: NSWindow?, then reply: @escaping (UnsavedChoice) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Do you want to save the changes made to “\(name)”?"
        alert.informativeText = "Your changes will be lost if you don’t save them."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Don’t Save")
        let choose: (NSApplication.ModalResponse) -> Void = { response in
            switch response {
            case .alertFirstButtonReturn: reply(.save)
            case .alertThirdButtonReturn: reply(.discard)
            default: reply(.cancel)
            }
        }
        if let window, window.isVisible {
            alert.beginSheetModal(for: window, completionHandler: choose)
        } else {
            choose(alert.runModal())
        }
    }

    func tell(_ message: String, detail: String, for window: NSWindow?) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = message
        alert.informativeText = detail
        if let window, window.isVisible {
            alert.beginSheetModal(for: window, completionHandler: nil)
        } else {
            alert.runModal()
        }
    }

    private func present(_ panel: NSSavePanel, on window: NSWindow?, then done: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window, window.isVisible {
            panel.beginSheetModal(for: window, completionHandler: done)
        } else {
            done(panel.runModal())
        }
    }
}
