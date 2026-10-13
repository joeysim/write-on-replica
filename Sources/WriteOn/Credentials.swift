import Foundation
import Security

/// Somewhere a secret can be kept between launches.
protocol SecretStore: AnyObject {
    func read() -> String?
    /// `nil` forgets it.
    func write(_ secret: String?)
}

/// The login keychain: where a key typed into Settings is kept.
final class KeychainSecret: SecretStore {
    private let query: [String: Any]

    init(service: String, account: String) {
        query = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    func read() -> String? {
        var asking = query
        asking[kSecReturnData as String] = true
        asking[kSecMatchLimit as String] = kSecMatchLimitOne
        var found: CFTypeRef?
        guard SecItemCopyMatching(asking as CFDictionary, &found) == errSecSuccess, let data = found as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func write(_ secret: String?) {
        SecItemDelete(query as CFDictionary)
        guard let secret else { return }
        var adding = query
        adding[kSecValueData as String] = Data(secret.utf8)
        SecItemAdd(adding as CFDictionary, nil)
    }
}

/// A secret kept only as long as the app runs: what a scripted run has in place of the
/// keychain, which it must neither read nor write.
final class MemorySecret: SecretStore {
    private var secret: String?
    /// Read where keys are looked up, off the main thread, and written on it.
    private let lock = NSLock()

    func read() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return secret
    }

    func write(_ secret: String?) {
        lock.lock()
        defer { lock.unlock() }
        self.secret = secret
    }
}

/// The key for the AI service, and where it comes from (design spec 7.1). Looked for in
/// this order: one saved in Settings; the app's own environment; the person's login shell,
/// asked once, since an app started from Finder is not given what `~/.zshrc` sets. A key
/// found outside Settings is held in memory only.
///
/// The environment and the login shell may also name the service's address and the model.
/// The app's own names are for whatever service it is pointed at. LunaRoute's are older and
/// still read, and a key under LunaRoute's name is LunaRoute's: no other service is sent it.
///
/// Nothing here prints or logs a key.
final class Credentials {
    enum Source {
        case settings, environment, loginShell
    }

    struct Key {
        let value: String
        let source: Source
    }

    /// What the environment may call each thing: the app's own name, then LunaRoute's
    /// where it had one.
    static let keyNames = ["WRITEON_API_KEY", "LUNAROUTE_API_KEY"]
    static let addressNames = ["WRITEON_BASE_URL", "LUNAROUTE_BASE_URL"]
    static let modelNames = ["WRITEON_MODEL"]
    /// Which way the service is spoken to: "openai" or "anthropic" (see `AIWire`).
    static let formatNames = ["WRITEON_API_FORMAT"]

    private let saved: SecretStore
    /// The app's own environment. (A scripted run may change it, to see what follows.)
    var environment: [String: String]
    private let readShell: (() -> [String: String])?
    private var fromShell: [String: String]?
    private let lock = NSLock()

    /// - Parameter readShell: reads the variables from the login shell; `nil` never asks it.
    init(saved: SecretStore, environment: [String: String] = ProcessInfo.processInfo.environment, readShell: (() -> [String: String])? = LoginShell.read) {
        self.saved = saved
        self.environment = environment
        self.readShell = readShell
    }

    /// The key to use, or nil if there is none for this service. May take a moment the
    /// first time it has to ask the login shell, so it is not for the main thread.
    ///
    /// - Parameter lunaRoutes: whether the service to be asked is LunaRoute. A key under
    ///   LunaRoute's name comes first there, and is offered to no other service.
    func key(lunaRoutes: Bool) -> Key? {
        if let value = present(saved.read()) { return Key(value: value, source: .settings) }
        let names = lunaRoutes ? Array(Self.keyNames.reversed()) : [Self.keyNames[0]]
        if let value = first(names, in: environment) { return Key(value: value, source: .environment) }
        if let value = first(names, in: shell()) { return Key(value: value, source: .loginShell) }
        return nil
    }

    /// The address of the service, if the environment or the login shell names one.
    func address() -> String? {
        first(Self.addressNames, in: environment) ?? first(Self.addressNames, in: shell())
    }

    /// Where LunaRoute is, for someone who has said: the address under LunaRoute's own name.
    func lunaRouteAddress() -> String? {
        let name = [Self.addressNames[1]]
        return first(name, in: environment) ?? first(name, in: shell())
    }

    /// The model to ask, if the environment or the login shell names one.
    func model() -> String? {
        first(Self.modelNames, in: environment) ?? first(Self.modelNames, in: shell())
    }

    /// The way the service is spoken to, if the environment or the login shell says.
    func format() -> String? {
        first(Self.formatNames, in: environment) ?? first(Self.formatNames, in: shell())
    }

    /// Saves a key typed into Settings, or with nil forgets the one saved there.
    func save(_ key: String?) {
        saved.write(present(key))
    }

    private func shell() -> [String: String] {
        lock.lock()
        defer { lock.unlock() }
        if let fromShell { return fromShell }
        let read = readShell?() ?? [:]
        fromShell = read
        return read
    }

    /// What the first of `names` to be set, and not to nothing, is set to.
    private func first(_ names: [String], in values: [String: String]) -> String? {
        for name in names {
            if let value = present(values[name]) { return value }
        }
        return nil
    }

    private func present(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// The person's login shell, asked what it sets the variables to.
enum LoginShell {
    /// Runs the shell as a terminal would start it (login and interactive, so that both
    /// `.zprofile` and `.zshrc` are read) and has it print the variables between marks that
    /// nothing a profile prints could be mistaken for. Gives up after a few seconds.
    static func read() -> [String: String] {
        read(from: ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh", started: ["-l", "-i"], environment: nil)
    }

    /// - Parameters:
    ///   - shell: the shell to ask.
    ///   - started: what it is started with, ahead of the command.
    ///   - environment: what it is given to start from; nil gives it the app's own.
    static func read(from shell: String, started: [String], environment: [String: String]?) -> [String: String] {
        // LunaRoute's names first, as they were asked for when they were the only ones.
        let names = [Credentials.keyNames[1], Credentials.addressNames[1], Credentials.keyNames[0], Credentials.addressNames[0]] + Credentials.modelNames + Credentials.formatNames
        let process = Process()
        process.executableURL = URL(fileURLWithPath: shell)
        if let environment { process.environment = environment }
        // A profile may make an unset variable an error (nounset), and the first one to be
        // unset would then end the command with nothing printed. The shells that can say
        // "this, or nothing if it is unset" are asked that way; any other is asked plainly.
        let guarded = ["zsh", "bash", "sh", "dash", "ksh"].contains(URL(fileURLWithPath: shell).lastPathComponent)
        let prints = names.map { "printf '\\036%s\\037%s\\036' \($0) \"\(guarded ? "${\($0)-}" : "$\($0)")\"" }.joined(separator: "; ")
        process.arguments = started + ["-c", prints]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            return [:]
        }
        let finished = DispatchSemaphore(value: 0)
        var data = Data()
        DispatchQueue.global(qos: .userInitiated).async {
            data = output.fileHandleForReading.readDataToEndOfFile()
            finished.signal()
        }
        if finished.wait(timeout: .now() + 5) == .timedOut {
            process.terminate()
            return [:]
        }
        var found: [String: String] = [:]
        for record in String(decoding: data, as: UTF8.self).split(separator: "\u{1e}") {
            let parts = record.split(separator: "\u{1f}", maxSplits: 1, omittingEmptySubsequences: false)
            if parts.count == 2, names.contains(String(parts[0])) { found[String(parts[0])] = String(parts[1]) }
        }
        return found
    }
}
