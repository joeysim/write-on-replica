import AppKit
import Security

/// Write On ▸ Check for Updates… (design spec 6.14). Only when the item is chosen, the app
/// asks GitHub which release is the latest, and if it is later than this copy, downloads its
/// zip itself. A copy downloaded this way has no quarantine mark, so macOS opens it without
/// asking. The new copy takes this one's place only if it is signed as this one is: this
/// copy's designated requirement names the project's certificate, and only the project's
/// key signs for that. It must also be the version the release says, and a later one.
///
/// The new copy goes in on the way out, when the app quits as Quit would have it quit
/// (AppDelegate). The app is then opened again, with the documents that were open.
final class Updates {
    /// A version as Semantic Versioning writes one: major, minor and patch.
    struct Version: Comparable, CustomStringConvertible {
        let numbers: [Int]

        init?(_ text: String) {
            let parts = text.split(separator: ".", omittingEmptySubsequences: false)
            guard parts.count == 3, parts.allSatisfy({ !$0.isEmpty && $0.count < 10 && $0.allSatisfy { $0.isASCII && $0.isNumber } }) else { return nil }
            numbers = parts.compactMap { Int($0) }
        }

        static func < (a: Version, b: Version) -> Bool { a.numbers.lexicographicallyPrecedes(b.numbers) }
        var description: String { numbers.map(String.init).joined(separator: ".") }
    }

    /// The latest release, as GitHub describes it.
    struct Release {
        let version: Version
        let zip: URL
        /// What the release notes say changed, one line to each change.
        let notes: [String]
    }

    /// A later version, downloaded and checked, waiting in a folder of its own.
    struct Staged {
        let app: URL
        let folder: URL
    }

    enum Outcome {
        /// Nothing later: GitHub's latest release is this version, or an earlier one.
        case current(Version)
        case ready(Release, Staged)
        case failed(String, detail: String)
        case canceled
    }

    /// What updating goes by in the copy that runs. A scripted run may say otherwise.
    struct Copy {
        var bundle: URL
        var version: Version?
        /// Where the build came from, as scripts/build-app.sh wrote it down (WriteOnSource).
        var source: String?
        var adHoc: Bool
        var requirement: SecRequirement?
    }

    var copy: Copy
    /// Where the app asks for the latest release.
    var feed: URL?
    private(set) var busy = false
    /// A scripted run never opens the app again: it notes what it would have opened.
    private(set) var reopened: [String: Any]?
    private let scripted: Bool
    private let session: URLSession
    private var running: Task<Void, Never>?

    /// The most a zip may be. A release's is under 2 MB.
    static let largest = 100_000_000

    /// - Parameter scripted: a UI test run. It asks for updates where WRITEON_UPDATES_URL says,
    ///   only on this Mac, and does not open the app again.
    init(scripted: Bool, bundle: Bundle = .main, environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.scripted = scripted
        let info = bundle.infoDictionary ?? [:]
        let signature = Self.ownSignature()
        copy = Copy(
            bundle: bundle.bundleURL,
            version: (info["CFBundleShortVersionString"] as? String).flatMap(Version.init),
            source: info["WriteOnSource"] as? String,
            adHoc: signature.adHoc,
            requirement: signature.requirement
        )
        let address = scripted ? environment["WRITEON_UPDATES_URL"] : info["WriteOnUpdates"] as? String
        feed = address.flatMap(URL.init(string:))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 300
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration, delegate: Redirects(allowed: { [scripted] in Self.allowed($0, scripted: scripted) }), delegateQueue: nil)
    }

    /// Why this copy cannot update itself, as a person would be told it; nil if it can.
    func whyNot() -> String? {
        guard let version = copy.version, copy.source == "v\(version)" else {
            let built = copy.source.map { " (\($0.hasPrefix("v") ? String($0.dropFirst()) : $0))" } ?? ""
            return "This copy was built from the source\(built), not downloaded from a release. Update it the way it was built: git pull, then scripts/build-app.sh."
        }
        guard !copy.adHoc, copy.requirement != nil else {
            return "This copy has an ad hoc signature, so it cannot tell whether an update is signed by the same hand. Download the update from the release page instead."
        }
        if copy.bundle.path.contains("/AppTranslocation/") {
            return "macOS runs this copy from a hidden folder, because it was opened where it was downloaded. Move Write On to Applications, open it from there, and choose Check for Updates again."
        }
        let folder = copy.bundle.deletingLastPathComponent()
        let files = FileManager.default
        guard files.isWritableFile(atPath: folder.path), files.isWritableFile(atPath: copy.bundle.path) else {
            return "Write On cannot change the folder it is in (\(folder.path)). Move it to a folder you can change, such as Applications, or download the update from the release page."
        }
        guard feed != nil else { return "This copy has no address to ask for updates (WriteOnUpdates in its Info.plist)." }
        return nil
    }

    // MARK: Checking

    /// Asks for the latest release and, if it is later, downloads and checks it. `note` says
    /// what is under way as it changes; `done` gets the outcome. Both on the main thread.
    func check(note: @escaping (String) -> Void, then done: @escaping (Outcome) -> Void) {
        guard !busy else { return }
        busy = true
        running = Task { @MainActor [weak self] in
            guard let self else { return }
            let outcome = await self.checking(note)
            self.busy = false
            self.running = nil
            done(outcome)
        }
    }

    func cancel() {
        running?.cancel()
    }

    private func checking(_ note: @escaping (String) -> Void) async -> Outcome {
        do {
            guard let feed else { throw Failure("Write On has no address to ask for updates.") }
            let release = try await latest(from: feed)
            guard let current = copy.version, release.version > current else { return .current(copy.version ?? release.version) }
            note("Downloading Write On \(release.version)…")
            return .ready(release, try await fetch(release))
        } catch let failure as Failure {
            return .failed(failure.message, detail: failure.detail)
        } catch {
            if error is CancellationError || (error as? URLError)?.code == .cancelled { return .canceled }
            return .failed("Write On could not check for updates.", detail: error.localizedDescription)
        }
    }

    /// What GitHub says of the latest release.
    private func latest(from feed: URL) async throws -> Release {
        guard Self.allowed(feed, scripted: scripted) else { throw Failure(offLimits(feed)) }
        var request = URLRequest(url: feed)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        let (data, response) = try await reach { try await self.session.data(for: request) }
        if let failure = Self.refusal(response, of: "say which release is the latest") { throw failure }
        struct Feed: Decodable {
            struct Asset: Decodable {
                let name: String
                let browserDownloadUrl: URL
            }
            let tagName: String
            let body: String?
            let assets: [Asset]
        }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let said = try? decoder.decode(Feed.self, from: data) else {
            throw Failure("Write On could not read GitHub’s answer.", detail: "It does not say what the latest release is.")
        }
        guard said.tagName.hasPrefix("v"), let version = Version(String(said.tagName.dropFirst())) else {
            throw Failure("Write On could not read GitHub’s answer.", detail: "The latest release is tagged “\(said.tagName)”, which is not a version.")
        }
        let name = "Write_On-\(version).zip"
        guard let zip = said.assets.first(where: { $0.name == name })?.browserDownloadUrl else {
            throw Failure("The latest release, \(version), has no app to download.", detail: "It has no \(name).")
        }
        guard Self.allowed(zip, scripted: scripted) else { throw Failure(offLimits(zip)) }
        return Release(version: version, zip: zip, notes: Self.notes(from: said.body))
    }

    /// Downloads the release's zip into a folder beside this copy, on the same disk, unpacks
    /// it and checks the app in it.
    private func fetch(_ release: Release) async throws -> Staged {
        let files = FileManager.default
        let folder = try files.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: copy.bundle, create: true)
        do {
            let (downloaded, response) = try await reach { try await self.session.download(for: URLRequest(url: release.zip)) }
            let zip = folder.appendingPathComponent(release.zip.lastPathComponent)
            try files.moveItem(at: downloaded, to: zip)
            if let failure = Self.refusal(response, of: "give the update") { throw failure }
            let size = (try? files.attributesOfItem(atPath: zip.path)[.size] as? Int) ?? 0
            guard size <= Self.largest else { throw Failure("The update was not installed.", detail: "Its zip is \(size / 1_000_000) MB, which is far more than a release of Write On.") }
            let unpacked = folder.appendingPathComponent("unpacked", isDirectory: true)
            try await Self.unzip(zip, into: unpacked)
            let found = (try? files.contentsOfDirectory(at: unpacked, includingPropertiesForKeys: nil)) ?? []
            guard found.count == 1, let app = found.first, app.pathExtension == "app" else {
                throw Failure("The update was not installed.", detail: "Its zip does not hold one app, as a release’s does.")
            }
            try await verify(app, as: release)
            try? files.removeItem(at: zip)
            return Staged(app: app, folder: folder)
        } catch {
            try? files.removeItem(at: folder)
            throw error
        }
    }

    /// The app in the zip is the release's version, a later one, and signed as this copy is.
    private func verify(_ app: URL, as release: Release) async throws {
        let info = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist")) as? [String: Any] ?? [:]
        let version = (info["CFBundleShortVersionString"] as? String).flatMap(Version.init)
        guard version == release.version else {
            throw Failure("The update was not installed.", detail: "The release is \(release.version), but the app in its zip is \(version?.description ?? "of no version").")
        }
        guard let requirement = copy.requirement else { throw Failure("The update was not installed.", detail: "This copy cannot read its own signature.") }
        // Off the main thread: every file of the app is read.
        if let problem = await Task.detached(operation: { Self.problem(signing: app, against: requirement) }).value {
            throw Failure("The update was not installed.", detail: "Write On \(release.version) from GitHub is not signed with the certificate that this copy has, or it was changed after it was signed. (\(problem))")
        }
    }

    // MARK: Installing

    /// Puts the new copy in this one's place. It replaces the whole of this copy at once, or
    /// nothing of it.
    func install(_ staged: Staged) throws {
        defer { discard(staged) }
        _ = try FileManager.default.replaceItemAt(copy.bundle, withItemAt: staged.app)
        // The system reads the new copy's version and the rest from the bundle again.
        if !scripted { LSRegisterURL(copy.bundle as CFURL, true) }
    }

    func discard(_ staged: Staged) {
        try? FileManager.default.removeItem(at: staged.folder)
    }

    /// Opens the app again, with `files`, once this process has ended. A scripted run notes it.
    func reopen(with files: [URL]) {
        guard !scripted else {
            reopened = ["app": copy.bundle.path, "files": files.map(\.lastPathComponent)]
            return
        }
        let helper = Process()
        helper.executableURL = URL(fileURLWithPath: "/bin/sh")
        helper.arguments = ["-c", Self.reopening, "sh", String(ProcessInfo.processInfo.processIdentifier), copy.bundle.path] + files.map(\.path)
        try? helper.run()
    }

    /// Waits up to a minute for the app to end, then opens it, with the files it was given.
    private static let reopening = """
        pid=$1 app=$2
        shift 2
        n=0
        while /bin/kill -0 "$pid" 2>/dev/null; do
          [ "$n" -lt 300 ] || exit 0
          n=$((n + 1))
          /bin/sleep 0.2
        done
        exec /usr/bin/open -a "$app" "$@"
        """

    // MARK: Pieces

    private struct Failure: Error {
        let message: String
        let detail: String
        init(_ message: String, detail: String = "") {
            self.message = message
            self.detail = detail
        }
    }

    /// Runs a request, and puts a failure to reach GitHub as a person would read it.
    private func reach<T>(_ request: () async throws -> T) async throws -> T {
        do {
            return try await request()
        } catch let error as URLError where error.code != .cancelled {
            throw Failure("Write On could not reach GitHub.", detail: error.localizedDescription)
        }
    }

    /// An answer other than 200, as a failure.
    private static func refusal(_ response: URLResponse, of what: String) -> Failure? {
        guard let http = response as? HTTPURLResponse else { return Failure("GitHub did not \(what).") }
        guard http.statusCode != 200 else { return nil }
        let reason = HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
        return Failure("GitHub did not \(what).", detail: "It answered \(http.statusCode), “\(reason)”. Try again later.")
    }

    private func offLimits(_ url: URL) -> String {
        scripted ? AIClient.offLimits : "Write On asks for updates only over https, and \(url.host ?? "this address") is not."
    }

    /// Where a request may go: in a scripted run only this Mac, otherwise only https.
    static func allowed(_ url: URL, scripted: Bool) -> Bool {
        scripted ? AIClient.isOnThisMac(url) : url.scheme?.lowercased() == "https"
    }

    /// GitHub sends a download on to where it is kept. A redirect is followed only where a
    /// request could go in the first place.
    private final class Redirects: NSObject, URLSessionTaskDelegate {
        let allowed: (URL) -> Bool
        init(allowed: @escaping (URL) -> Bool) {
            self.allowed = allowed
        }
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(request.url.map(allowed) == true ? request : nil)
        }
    }

    /// The release notes' "What changed", one line to each change.
    static func notes(from body: String?) -> [String] {
        var inChanges = false
        var found: [String] = []
        for line in (body ?? "").components(separatedBy: .newlines) {
            if line.hasPrefix("## ") {
                inChanges = line.trimmingCharacters(in: .whitespaces) == "## What changed"
            } else if inChanges, line.hasPrefix("- ") {
                found.append(String(line.dropFirst(2)).trimmingCharacters(in: .whitespaces))
            }
        }
        return found
    }

    private static func unzip(_ zip: URL, into folder: URL) async throws {
        try await Task.detached {
            let ditto = Process()
            ditto.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            ditto.arguments = ["-x", "-k", zip.path, folder.path]
            ditto.standardError = FileHandle.nullDevice
            try ditto.run()
            ditto.waitUntilExit()
            guard ditto.terminationStatus == 0 else { throw Failure("The update was not installed.", detail: "Its zip could not be unpacked.") }
        }.value
    }

    /// This process's signature: its designated requirement, and whether it is ad hoc.
    private static func ownSignature() -> (requirement: SecRequirement?, adHoc: Bool) {
        var running: SecCode?
        var code: SecStaticCode?
        guard SecCodeCopySelf([], &running) == errSecSuccess, let running,
              SecCodeCopyStaticCode(running, [], &code) == errSecSuccess, let code
        else { return (nil, true) }
        var requirement: SecRequirement?
        guard SecCodeCopyDesignatedRequirement(code, [], &requirement) == errSecSuccess else { return (nil, true) }
        var information: CFDictionary?
        SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &information)
        let flags = ((information as? [String: Any])?[kSecCodeInfoFlags as String] as? NSNumber)?.uint32Value ?? SecCodeSignatureFlags.adhoc.rawValue
        return (requirement, flags & SecCodeSignatureFlags.adhoc.rawValue != 0)
    }

    /// What is wrong with the signature of the app at `url`, for a copy that holds to
    /// `requirement`: nil if nothing is. Every half, every file and every link is checked.
    static func problem(signing url: URL, against requirement: SecRequirement) -> String? {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess, let code else { return "it has no signature" }
        let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode | kSecCSRestrictSymlinks)
        var error: Unmanaged<CFError>?
        let status = SecStaticCodeCheckValidityWithErrors(code, flags, requirement, &error)
        guard status != errSecSuccess else { return nil }
        _ = error?.takeRetainedValue()
        // Security's own words for the status, as codesign gives them.
        return SecCopyErrorMessageString(status, nil) as String? ?? "status \(status)"
    }
}
