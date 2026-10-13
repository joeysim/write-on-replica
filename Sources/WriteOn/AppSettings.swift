import Foundation

/// What the app remembers between launches.
///
/// The page keeps its interface choices here (read mode, the alternates toggle) as one
/// small dictionary. A scripted run gets a store of its own that lives in memory, so tests
/// neither see nor disturb what the person using the app has chosen.
final class AppSettings {
    static let standard = AppSettings(defaults: .standard)

    private static let interfaceKey = "interface"
    private static let welcomedKey = "welcomed"
    private static let addressKey = "ai.address"
    private static let modelKey = "ai.model"
    private static let formatKey = "ai.format"
    private let defaults: UserDefaults?
    private var memory: [String: Any]
    private var welcomedInMemory: Bool
    private var texts: [String: String] = [:]

    /// - Parameters:
    ///   - defaults: where to keep the settings; `nil` keeps them in memory only.
    ///   - initial: starting values for an in-memory store.
    init(defaults: UserDefaults?, initial: [String: Any] = [:]) {
        self.defaults = defaults
        // The page's settings are its own; this one is the shell's.
        memory = initial.filter { $0.key != Self.welcomedKey }
        welcomedInMemory = initial[Self.welcomedKey] as? Bool ?? false
    }

    /// The page's interface settings.
    var interface: [String: Any] {
        defaults?.dictionary(forKey: Self.interfaceKey) ?? memory
    }

    /// Whether the welcome piece has been shown. It is shown once.
    var welcomed: Bool {
        get { defaults?.bool(forKey: Self.welcomedKey) ?? welcomedInMemory }
        set {
            if let defaults {
                defaults.set(newValue, forKey: Self.welcomedKey)
            } else {
                welcomedInMemory = newValue
            }
        }
    }

    /// The address of the AI service, if Settings names one other than the usual.
    var aiAddress: String? {
        get { text(Self.addressKey) }
        set { setText(newValue, Self.addressKey) }
    }

    /// The model to ask, if Settings names one other than the usual.
    var aiModel: String? {
        get { text(Self.modelKey) }
        set { setText(newValue, Self.modelKey) }
    }

    /// The way the AI service is spoken to ("openai" or "anthropic"), if Settings says.
    var aiFormat: String? {
        get { text(Self.formatKey) }
        set { setText(newValue, Self.formatKey) }
    }

    private func text(_ key: String) -> String? {
        let value = defaults != nil ? defaults?.string(forKey: key) : texts[key]
        return (value ?? "").isEmpty ? nil : value
    }

    private func setText(_ value: String?, _ key: String) {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if let defaults {
            if trimmed.isEmpty { defaults.removeObject(forKey: key) } else { defaults.set(trimmed, forKey: key) }
        } else {
            texts[key] = trimmed.isEmpty ? nil : trimmed
        }
    }

    /// Merges `changes` into the interface settings. Only flags, numbers and text are kept.
    func updateInterface(_ changes: [String: Any]) {
        var next = interface
        for (name, value) in changes where value is NSNumber || value is String {
            next[name] = value
        }
        if let defaults {
            defaults.set(next, forKey: Self.interfaceKey)
        } else {
            memory = next
        }
    }
}
