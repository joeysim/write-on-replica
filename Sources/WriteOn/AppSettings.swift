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
    private let defaults: UserDefaults?
    private var memory: [String: Any]
    private var welcomedInMemory: Bool

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
