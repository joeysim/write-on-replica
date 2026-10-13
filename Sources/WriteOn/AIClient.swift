import Foundation

/// Asks the AI service on the page's behalf (design spec 7 and 7.1). The service is
/// LunaRoute unless Settings or the environment names another: anything that takes
/// OpenAI-style chat completions and streams the answer as server-sent events. The key
/// stays on this side: the page sends a request and is sent back text.
///
///     page  -> shell   ai.start  { id, messages, maxTokens, effort, schema? }
///     shell -> page    ai.delta  { id, text }      as the answer streams
///                      ai.done   { id }
///                      ai.error  { id, message }   one line a person can read
///     page  -> shell   ai.cancel { id }
final class AIClient {
    static let defaultAddress = "https://gw.lunaroute.com/v1"
    static let defaultModel = "glm-5.3-flash"
    static let noKey = "No API key — add one in Settings (⌘,)"
    static let offLimits = "A scripted run asks only a service on this Mac."
    static let inTheClear = "Only an address on this Mac or its own network may be plain http. Use https."

    typealias Emit = (_ event: String, _ payload: [String: Any]) -> Void

    private let credentials: Credentials
    private let settings: AppSettings
    private let session: URLSession
    private let localOnly: Bool
    private let ways = Ways()
    private let stays = Stays()
    /// Requests on their way, by whose they are (a window) and the id its page gave them.
    /// Main thread only.
    private var running: [String: Task<Void, Never>] = [:]

    /// - Parameters:
    ///   - idle: how long a stream may say nothing before it is given up on.
    ///   - localOnly: ask nothing that is not on this Mac. A scripted run is held to that
    ///     unless it is a live one, so that no scenario reaches a real service by accident.
    init(credentials: Credentials, settings: AppSettings, idle: TimeInterval = 20, localOnly: Bool = false) {
        self.credentials = credentials
        self.settings = settings
        self.localOnly = localOnly
        let configuration = URLSessionConfiguration.ephemeral
        // Counted from the last data to arrive, so it is the silence that is timed, not the answer.
        configuration.timeoutIntervalForRequest = idle
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    // MARK: Requests from the page

    /// - Parameter owner: whose request it is. Two windows may well use the same id.
    func start(_ params: [String: Any], for owner: String, emit: @escaping Emit) throws {
        guard let id = params["id"] as? String, let messages = params["messages"] as? [[String: Any]], !messages.isEmpty else {
            throw Bridge.Failure("ai.start needs an id and messages")
        }
        let name = "\(owner)/\(id)"
        var body: [String: Any] = ["messages": messages, "stream": true]
        if let most = params["maxTokens"] as? NSNumber { body["max_tokens"] = most.intValue }
        if let effort = params["effort"] as? String { body["reasoning_effort"] = effort }
        if let schema = params["schema"] as? [String: Any] {
            body["response_format"] = ["type": "json_schema", "json_schema": ["name": "answer", "strict": true, "schema": schema] as [String: Any]] as [String: Any]
        }
        let chosen = Chosen(address: settings.aiAddress, model: settings.aiModel)
        running[name]?.cancel()
        running[name] = Task { @MainActor [weak self] in
            guard let self else { return }
            var reason: String?
            do {
                try await self.ask(body, chosen) { text in emit("ai.delta", ["id": id, "text": text]) }
            } catch {
                reason = Self.reason(for: error)
            }
            // A request that was called off says nothing more, however it ended.
            guard !Task.isCancelled else { return }
            self.running[name] = nil
            if let reason {
                emit("ai.error", ["id": id, "message": reason])
            } else {
                emit("ai.done", ["id": id])
            }
        }
    }

    func cancel(_ id: String, for owner: String) {
        running.removeValue(forKey: "\(owner)/\(id)")?.cancel()
    }

    /// Calls off everything `owner` has asked for: its window is closing, or its page starting over.
    func cancelAll(for owner: String) {
        for name in running.keys where name.hasPrefix("\(owner)/") {
            running.removeValue(forKey: name)?.cancel()
        }
    }

    /// Asks a very short question, to see that the address, the key and the model all work.
    /// Reports in one line, on the main thread.
    func test(then report: @escaping (String) -> Void) {
        let chosen = Chosen(address: settings.aiAddress, model: settings.aiModel)
        Task { @MainActor [weak self] in
            guard let self else { return }
            let began = Date()
            let body: [String: Any] = [
                "messages": [["role": "user", "content": "Reply with the single word: ok"]],
                // Room for far more than a word: the model may think first, and what it
                // thinks is counted too. With room for one word it sometimes ran out.
                "stream": true, "max_tokens": 1024, "reasoning_effort": "low",
            ]
            do {
                var said = ""
                let access = try await self.ask(body, chosen) { text in said += text }
                // An answer with nothing in it is what a model that is not there, or cannot
                // speak, tends to give.
                guard !said.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    return report("The service answered, but said nothing. Check the model in Settings (⌘,).")
                }
                let took = String(format: "%.1f", Date().timeIntervalSince(began))
                let key = access.key.map { "the key \(Self.describe($0.source))" } ?? "no key"
                report("Connected: \(access.model) answered in \(took) s, with \(key).")
            } catch {
                report(Self.reason(for: error))
            }
        }
    }

    static func describe(_ source: Credentials.Source) -> String {
        switch source {
        case .settings: return "saved here"
        case .environment: return "from the app’s environment"
        case .loginShell: return "from your login shell"
        }
    }

    // MARK: Asking

    /// What Settings says to use, where it says anything.
    private struct Chosen {
        let address: String?
        let model: String?
    }

    private struct Access {
        /// The key to send, and where it was found. None: the service is asked without one.
        let key: Credentials.Key?
        /// Where the requests go: the address, with `chat/completions` after it.
        let endpoint: URL
        let model: String
        /// What one service's ways are kept under: they differ by address and by model.
        var service: String { "\(endpoint.absoluteString) \(model)" }
    }

    /// An answer whose status is not success.
    private struct Refusal {
        let status: Int
        /// The service's reason in a line, if it gave one a person can be shown.
        let said: String?
        /// The start of what it sent back, as it was sent: read for what it names, never shown.
        let whole: String
        /// Whether a key went with the request.
        let keyed: Bool
    }

    /// A part of a request that not every service takes as the app words it (spec 7.1).
    private enum Part: String, CaseIterable {
        /// The most that may come back. OpenAI's models that reason want it called
        /// `max_completion_tokens`; most other services know it only as `max_tokens`.
        case room = "max_tokens"
        /// How hard to think. A model that does not reason refuses to be told.
        case effort = "reasoning_effort"

        /// Whether `refusal` is of this part: the request had it, and the refusal names it
        /// as something the service will not take. A refusal may name the room for another
        /// reason (more was asked for than the model can write), which another name for it
        /// would not cure; so for the room the refusal must also say that it does not know
        /// the name, or give the other one.
        func isRefused(by refusal: Refusal, of body: [String: Any]) -> Bool {
            guard [400, 422].contains(refusal.status), body[rawValue] != nil, refusal.whole.contains(rawValue) else { return false }
            switch self {
            case .effort: return true
            case .room: return refusal.whole.range(of: "max_completion_tokens|unsupported|not supported|unknown|unrecogni[sz]ed|unexpected|not permitted|not allowed", options: [.regularExpression, .caseInsensitive]) != nil
            }
        }

        /// Words the request the way a service that refuses this part wants it.
        func fit(_ body: inout [String: Any]) {
            switch self {
            case .room: if let most = body.removeValue(forKey: rawValue) { body["max_completion_tokens"] = most }
            case .effort: body.removeValue(forKey: rawValue)
            }
        }
    }

    /// What each service has been found to want, for as long as the app runs. Requests
    /// are sent from more than one thread.
    private final class Ways {
        private var found: [String: Set<Part>] = [:]
        private let lock = NSLock()

        func known(for service: String) -> Set<Part> {
            lock.lock()
            defer { lock.unlock() }
            return found[service] ?? []
        }

        /// What was found this time is what is known from now on.
        func learn(_ parts: Set<Part>, for service: String) {
            lock.lock()
            defer { lock.unlock() }
            found[service] = parts.isEmpty ? nil : parts
        }
    }

    /// A request goes to the address the person named and no further: it is never sent on
    /// to wherever an answer says the service has moved to.
    private final class Stays: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }

    private enum Failure: Error {
        case noKey
        case notAnAddress
        /// Plain http to somewhere a key should not cross to in the clear.
        case inTheClear
        /// The address is not on this Mac, and this run may ask nothing that is not.
        case offLimits
        case refused(Refusal)
        /// The service said, part-way through the answer, that it had failed.
        case failed(String)
        /// The model reached the most it was allowed to write before it had finished.
        case cutShort
    }

    /// Where to send a request and with what. Off the main thread: the first time, finding
    /// the key may mean asking the login shell.
    private func access(_ chosen: Chosen) async throws -> Access {
        let credentials = credentials
        let localOnly = localOnly
        return try await Task.detached(priority: .userInitiated) {
            let address = chosen.address ?? credentials.address() ?? Self.defaultAddress
            guard let endpoint = Self.endpoint(address) else { throw Failure.notAnAddress }
            // macOS refuses an app plain http to anywhere but its own network. The app
            // does not leave that to the system: a key is not to cross in the clear.
            if endpoint.scheme?.lowercased() == "http", !Self.isNearby(endpoint) { throw Failure.inTheClear }
            let key = Self.key(for: endpoint, from: credentials).key
            // The usual service takes nothing without a key, so nothing is sent it. One
            // named in its place may be a model served on this Mac, which wants none.
            if key == nil, Self.isUsual(endpoint) { throw Failure.noKey }
            if localOnly, !Self.isOnThisMac(endpoint) { throw Failure.offLimits }
            return Access(key: key, endpoint: endpoint, model: chosen.model ?? credentials.model() ?? Self.defaultModel)
        }.value
    }

    /// Where requests to the service at `address` go: `chat/completions` after it, unless
    /// that is how it ends already. Nil if it is not a web address.
    static func endpoint(_ address: String) -> URL? {
        guard let url = URL(string: address), let scheme = url.scheme?.lowercased(), ["https", "http"].contains(scheme), url.host != nil else { return nil }
        // (A URL's path is given without any slash that ends it.)
        guard url.path.hasSuffix("/chat/completions") else { return url.appendingPathComponent("chat/completions") }
        // The whole of it already. A slash left after it would make another address of it.
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false), parts.percentEncodedPath.hasSuffix("/") else { return url }
        parts.percentEncodedPath = String(parts.percentEncodedPath.dropLast())
        return parts.url ?? url
    }

    /// The key that would go to the service at `endpoint`, and whether one under
    /// LunaRoute's name is being kept from it, the service not being LunaRoute.
    static func key(for endpoint: URL, from credentials: Credentials) -> (key: Credentials.Key?, kept: Bool) {
        let lunaRoutes = isLunaRoute(endpoint, said: credentials.lunaRouteAddress())
        let key = credentials.key(lunaRoutes: lunaRoutes)
        return (key, key == nil && !lunaRoutes && credentials.key(lunaRoutes: true) != nil)
    }

    /// Whether the service is LunaRoute: at LunaRoute's own domain, or at the address its
    /// own name in the environment says it is.
    private static func isLunaRoute(_ endpoint: URL, said: String?) -> Bool {
        let host = endpoint.host?.lowercased() ?? ""
        if host == "lunaroute.com" || host.hasSuffix(".lunaroute.com") { return true }
        guard let theirs = said.flatMap(Self.endpoint) else { return false }
        let place = { (url: URL) in "\(url.host?.lowercased() ?? ""):\(url.port ?? (url.scheme?.lowercased() == "http" ? 80 : 443))" }
        return place(theirs) == place(endpoint)
    }

    /// Whether the address is the usual service's own.
    private static func isUsual(_ endpoint: URL) -> Bool {
        endpoint.host?.lowercased() == URL(string: defaultAddress)?.host
    }

    /// Whether the address is this Mac's own: what is sent there goes nowhere else.
    static func isOnThisMac(_ endpoint: URL) -> Bool {
        ["127.0.0.1", "localhost", "::1"].contains(endpoint.host?.lowercased() ?? "")
    }

    /// Whether the address is this Mac or on its own network: a name with no dot in it or
    /// one ending `.local`, or a number from the ranges kept for private networks.
    static func isNearby(_ endpoint: URL) -> Bool {
        let host = endpoint.host?.lowercased() ?? ""
        if host.contains(":") {
            // IPv6: this Mac, a link-local address or a unique local one.
            return host == "::1" || host.hasPrefix("fe80:") || host.hasPrefix("fc") || host.hasPrefix("fd")
        }
        // A number is taken at its word only when written the usual way, as four parts
        // in tens. Written any other way (one long number, in eights or sixteens, with
        // parts left out) it may not be the address it looks like.
        if host.hasPrefix("0x") || host.allSatisfy({ $0.isASCII && $0.isNumber || $0 == "." }) {
            let numbers = host.split(separator: ".", omittingEmptySubsequences: false).map { part in UInt8(part).flatMap { String($0) == part ? $0 : nil } }
            guard numbers.count == 4, let first = numbers[0], let second = numbers[1], numbers[2] != nil, numbers[3] != nil else { return false }
            switch (first, second) {
            case (127, _), (10, _), (192, 168), (169, 254), (172, 16...31): return true
            default: return false
            }
        }
        return !host.isEmpty && (!host.contains(".") || host.hasSuffix(".local"))
    }

    /// Asks, and hands on the text of the answer as it comes. A service that refuses a part
    /// of the request as the app words it is asked again in its own way, and asked that way
    /// first from then on: but only once asking that way has been seen to work. And what
    /// was learnt can stop being true (the same name may come to mean another model), so a
    /// request that is refused in a service's known way is asked once more as the app
    /// words it, and what was known is forgotten.
    @discardableResult
    private func ask(_ body: [String: Any], _ chosen: Chosen, onText: @MainActor (String) -> Void) async throws -> Access {
        let access = try await access(chosen)
        var worded = body
        worded["model"] = access.model
        var known = ways.known(for: access.service)
        var body = worded
        var fitted = known
        for part in fitted { part.fit(&body) }
        // At most five requests: the known way, the app's own wording, and one for each part.
        while true {
            do {
                try await send(body, access, onText: onText)
                ways.learn(fitted, for: access.service)
                return access
            } catch Failure.refused(let refusal) {
                // A part is given up once at most: fitted, it is no longer in the request.
                if let part = Part.allCases.first(where: { $0.isRefused(by: refusal, of: body) }) {
                    part.fit(&body)
                    fitted.insert(part)
                } else if !known.isEmpty, [400, 422].contains(refusal.status) {
                    ways.learn([], for: access.service)
                    known = []
                    fitted = []
                    body = worded
                } else {
                    throw Failure.refused(refusal)
                }
            }
        }
    }

    /// Sends one request and hands on the text of the answer as it comes.
    private func send(_ body: [String: Any], _ access: Access, onText: @MainActor (String) -> Void) async throws {
        var request = URLRequest(url: access.endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        if let key = access.key { request.setValue("Bearer \(key.value)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (bytes, response) = try await session.bytes(for: request, delegate: stays)
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            var said = Data()
            for try await byte in bytes.prefix(4096) { said.append(byte) }
            throw Failure.refused(Refusal(status: status, said: Self.words(in: said, without: access.key?.value), whole: String(decoding: said, as: UTF8.self), keyed: access.key != nil))
        }
        if http?.mimeType == "application/json" {
            // A gateway that takes no notice of "stream" and answers all at once.
            var whole = Data()
            for try await byte in bytes { whole.append(byte) }
            let answer = (try? JSONSerialization.jsonObject(with: whole)) as? [String: Any]
            let message = (answer?["choices"] as? [[String: Any]])?.first?["message"] as? [String: Any]
            if let text = message?["content"] as? String, !text.isEmpty { await onText(text) }
            return
        }
        // A line that goes dead part-way looks, from here, like an answer that simply ended.
        // So the answer has to say that it is finished: with [DONE], or a reason for stopping.
        var finished = false
        /// Takes one line of the stream. True when the stream has said it is done.
        func take(_ bytes: [UInt8]) async throws -> Bool {
            guard let line = String(bytes: bytes, encoding: .utf8), line.hasPrefix("data:") else { return false }
            let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            if payload == "[DONE]" {
                finished = true
                return true
            }
            guard let event = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] else { return false }
            if let error = event["error"] {
                throw Failure.failed(Self.words(of: error, without: access.key?.value) ?? "it gave no reason")
            }
            let choice = (event["choices"] as? [[String: Any]])?.first
            // Only what the model says. What it thinks on the way (reasoning_content) is not the answer.
            if let text = (choice?["delta"] as? [String: Any])?["content"] as? String, !text.isEmpty { await onText(text) }
            if let reason = choice?["finish_reason"] as? String {
                // Stopped at its limit, with thinking and answer both counted against it:
                // whatever it had begun to say is not an answer.
                if reason == "length" { throw Failure.cutShort }
                finished = true
            }
            return false
        }
        // The stream's lines end at a line feed and nowhere else. (The system's own way of
        // reading lines also ends one at U+2028, U+2029 and U+0085, which JSON may carry
        // raw inside a string: a piece of the answer holding one would be lost whole.)
        var line: [UInt8] = []
        read: for try await byte in bytes {
            guard byte == 0x0A else {
                line.append(byte)
                continue
            }
            if line.last == 0x0D { line.removeLast() }
            let done = try await take(line)
            line.removeAll(keepingCapacity: true)
            if done { break read }
        }
        if !finished, !line.isEmpty { _ = try await take(line) }
        guard finished else { throw URLError(.networkConnectionLost) }
    }

    // MARK: Reasons

    /// One line a person can read. Never anything of the request, and never the key.
    private static func reason(for error: Error) -> String {
        switch error {
        case Failure.noKey:
            return noKey
        case Failure.notAnAddress:
            return "The address in Settings (⌘,) is not a web address."
        case Failure.inTheClear:
            return inTheClear
        case Failure.offLimits:
            return offLimits
        case Failure.refused(let refusal):
            let status = refusal.status
            switch status {
            case 401, 403:
                return refusal.keyed
                    ? "The key was not accepted (\(status)). Check it in Settings (⌘,)."
                    : "This service wants a key (\(status)). Add one in Settings (⌘,)."
            case 300..<400: return "The address in Settings (⌘,) sends requests on elsewhere (\(status)), and they are not followed."
            case 429: return "Too many requests, or out of quota (429). Try again in a moment."
            case 500...: return "The AI service had a problem (\(status)). Try again in a moment."
            default: return "The request was refused (\(status))" + (refusal.said.map { ": \($0)" } ?? ".")
            }
        case Failure.failed(let said):
            return "The AI service had a problem: \(said)"
        case Failure.cutShort:
            return "The AI ran out of room before it finished its answer. Try again."
        case let error as URLError:
            switch error.code {
            case .timedOut:
                return "The AI took too long to answer."
            case .notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff:
                return "Could not reach the AI service. Check the network, and the address in Settings (⌘,)."
            case .networkConnectionLost, .cannotParseResponse, .badServerResponse, .zeroByteResource:
                return "The connection was lost before the answer was complete."
            case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid, .appTransportSecurityRequiresSecureConnection:
                return "A secure connection to the AI service could not be made."
            default:
                return "The request to the AI service failed (\(error.code.rawValue))."
            }
        default:
            return "The request to the AI service failed."
        }
    }

    /// What the service said went wrong, from the body of a refusal: its first line, cut
    /// short, with the key taken out should the service have quoted it back.
    private static func words(in body: Data, without key: String?) -> String? {
        guard let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else { return nil }
        return words(of: object["error"] ?? object["message"] as Any, without: key)
    }

    private static func words(of error: Any, without key: String?) -> String? {
        let said = (error as? [String: Any])?["message"] as? String ?? error as? String
        guard let line = said?.split(whereSeparator: \.isNewline).first.map(String.init)?.trimmingCharacters(in: .whitespaces), !line.isEmpty else { return nil }
        let clean = key.map { line.replacingOccurrences(of: $0, with: "(the key)") } ?? line
        return clean.count > 140 ? String(clean.prefix(140)) + "…" : clean
    }
}
