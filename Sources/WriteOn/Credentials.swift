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
    func read() -> String? { secret }
    func write(_ secret: String?) { self.secret = secret }
}

/// The key for the AI service, and where it comes from (design spec 7.1). Looked for in
/// this order: one saved in Settings; `LUNAROUTE_API_KEY` in the app's own environment;
/// the same read once from the person's login shell, since an app started from Finder is
/// not given what `~/.zshrc` sets. A key found outside Settings is held in memory only.
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

    static let keyName = "LUNAROUTE_API_KEY"
    static let addressName = "LUNAROUTE_BASE_URL"

    private let saved: SecretStore
    /// The app's own environment. (A scripted run may change it, to see what follows.)
    var environment: [String: String]
    private let readShell: (() -> [String: String])?
    private var fromShell: [String: String]?
    private let lock = NSLock()

    /// - Parameter readShell: reads the two variables from the login shell; `nil` never asks it.
    init(saved: SecretStore, environment: [String: String] = ProcessInfo.processInfo.environment, readShell: (() -> [String: String])? = LoginShell.read) {
        self.saved = saved
        self.environment = environment
        self.readShell = readShell
    }

    /// The key to use, or nil if there is none anywhere. May take a moment the first time
    /// it has to ask the login shell, so it is not for the main thread.
    func key() -> Key? {
        if let value = present(saved.read()) { return Key(value: value, source: .settings) }
        if let value = present(environment[Self.keyName]) { return Key(value: value, source: .environment) }
        if let value = present(shell()[Self.keyName]) { return Key(value: value, source: .loginShell) }
        return nil
    }

    /// The address of the service, if the environment or the login shell names one.
    func address() -> String? {
        present(environment[Self.addressName]) ?? present(shell()[Self.addressName])
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

    private func present(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// The person's login shell, asked what it sets the two variables to.
enum LoginShell {
    /// Runs the shell as a terminal would start it (login and interactive, so that both
    /// `.zprofile` and `.zshrc` are read) and has it print the variables between marks that
    /// nothing a profile prints could be mistaken for. Gives up after a few seconds.
    static func read() -> [String: String] {
        let names = [Credentials.keyName, Credentials.addressName]
        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: shell)
        let prints = names.map { "printf '\\036%s\\037%s\\036' \($0) \"$\($0)\"" }.joined(separator: "; ")
        process.arguments = ["-l", "-i", "-c", prints]
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
