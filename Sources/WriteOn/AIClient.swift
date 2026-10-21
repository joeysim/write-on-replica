import Foundation

/// Asks the AI service on the page's behalf (design spec 7 and 7.1). The service is
/// LunaRoute unless Settings or the environment names another: anything that speaks
/// OpenAI's chat completions or Anthropic's messages (`AIWire`) and streams the answer as
/// server-sent events. The key stays on this side: the page sends a request and is sent
/// back text.
///
///     page  -> shell   ai.start  { id, messages, maxTokens, effort, schema? }
///     shell -> page    ai.delta  { id, text }      as the answer streams
///                      ai.done   { id }
///                      ai.error  { id, message, cutShort }   one line a person can read;
///                                  cutShort if the answer ran out of room after it began
///     page  -> shell   ai.cancel { id }
///     page  -> shell   ai.model  {} -> { model }   the name of the model in force
final class AIClient {
    static let defaultAddress = "https://gw.lunaroute.com/v1"
    static let defaultModel = "glm-5.3"
    static let noKey = "No API key — add one in Settings (⌘,)"
    static let offLimits = "A scripted run asks only a service on this Mac."
    static let inTheClear = "Only an address on this Mac or its own network may be plain http. Use https."
    /// The most room a request is ever given (the page asks for no more than this either).
    static let mostRoom = 32000

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
    init(credentials: Credentials, settings: AppSettings, idle: TimeInterval = 60, localOnly: Bool = false) {
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
        let asked = AIWire.Asked(messages: messages, maxTokens: (params["maxTokens"] as? NSNumber)?.intValue, effort: params["effort"] as? String, schema: params["schema"] as? [String: Any])
        let chosen = chosen()
        running[name]?.cancel()
        running[name] = Task { @MainActor [weak self] in
            guard let self else { return }
            var reason: String?
            var cutShort = false
            do {
                try await self.ask(asked, chosen) { text in emit("ai.delta", ["id": id, "text": text]) }
            } catch {
                reason = Self.reason(for: error)
                if case Failure.cutShort = error { cutShort = true }
            }
            // A request that was called off says nothing more, however it ended.
            guard !Task.isCancelled else { return }
            self.running[name] = nil
            if let reason {
                emit("ai.error", ["id": id, "message": reason, "cutShort": cutShort])
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
        let chosen = chosen()
        Task { @MainActor [weak self] in
            guard let self else { return }
            let began = Date()
            // Room for far more than a word: the model may think first, and what it thinks
            // is counted too. With room for one word it sometimes ran out.
            let asked = AIWire.Asked(messages: [["role": "user", "content": "Reply with the single word: ok"]], maxTokens: 1024, effort: "low", schema: nil)
            do {
                var said = ""
                let access = try await self.ask(asked, chosen) { text in said += text }
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

    /// The name of the model a request goes to now: as Settings says, else as the environment
    /// says, else the usual one. Only the name: never the key. Reports on the main thread.
    func model(then report: @escaping (String) -> Void) {
        let chosen = chosen()
        let credentials = credentials
        Task.detached(priority: .userInitiated) {
            // The environment may mean asking the login shell, which takes a moment the first time.
            let name = chosen.model ?? credentials.model() ?? AIClient.defaultModel
            await MainActor.run { report(name) }
        }
    }

    /// The models the service in force has that can answer this app, by name. Empty when
    /// there is no key, no answer, or nothing to list. Reports on the main thread.
    func models(then report: @escaping ([String]) -> Void) {
        let chosen = chosen()
        Task { @MainActor [weak self] in
            guard let self else { return }
            report((try? await self.listModels(chosen)) ?? [])
        }
    }

    private func listModels(_ chosen: Chosen) async throws -> [String] {
        let access = try await access(chosen)
        guard let url = access.wire.models(beside: access.endpoint) else { return [] }
        var request = access.wire.listing(at: url, key: access.key?.value)
        request.timeoutInterval = 15
        let (data, response) = try await session.data(for: request, delegate: stays)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { return [] }
        return Self.usable(data, for: access.wire)
    }

    /// What a service's list of models says can answer this app, by name. Where the list
    /// says what its models can do, as LunaRoute's does, only those that chat the way in
    /// use and keep to a schema (the Lab asks for one): a model it says nothing of may not
    /// chat at all. Where it says that of none of them, all of them.
    ///
    /// A list asked for Anthropic's way may come in Anthropic's shape, as LunaRoute's does:
    /// `"messages": { "supported": true }` for a model that speaks that way, and nothing of a
    /// schema. Then a model that speaks Anthropic's way can answer.
    static func usable(_ data: Data, for wire: AIWire) -> [String] {
        guard let listing = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let models = listing["data"] as? [[String: Any]]
        else { return [] }
        let chats = wire == .openAI ? "openai_chat" : "anthropic_messages"
        let tells = models.contains { $0["capabilities"] is [String: Any] }
        let names = models.compactMap { model -> String? in
            guard let id = model["id"] as? String, !id.isEmpty else { return nil }
            guard tells else { return id }
            let can = model["capabilities"] as? [String: Any] ?? [:]
            if can[chats] as? Bool == true, can["json_schema"] as? Bool == true { return id }
            let messages = can["messages"] as? [String: Any]
            return wire == .anthropic && messages?["supported"] as? Bool == true ? id : nil
        }
        return Set(names).sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
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
        let wire: AIWire?
    }

    private func chosen() -> Chosen {
        Chosen(address: settings.aiAddress, model: settings.aiModel, wire: AIWire(named: settings.aiFormat))
    }

    private struct Access {
        /// The key to send, and where it was found. None: the service is asked without one.
        let key: Credentials.Key?
        /// The way the service is spoken to.
        let wire: AIWire
        /// Where the requests go.
        let endpoint: URL
        let model: String
        /// Whether the service is LunaRoute, which has ways of its own.
        let lunaRoutes: Bool
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

    /// The parts of a request each service has been found not to take as the app words
    /// them, for as long as the app runs. Requests are sent from more than one thread.
    private final class Ways {
        private var found: [String: Set<AIWire.Part>] = [:]
        private let lock = NSLock()

        func known(for service: String) -> Set<AIWire.Part> {
            lock.lock()
            defer { lock.unlock() }
            return found[service] ?? []
        }

        /// What was found this time is what is known from now on.
        func learn(_ parts: Set<AIWire.Part>, for service: String) {
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
            let wire = Self.wire(for: address, chosen: chosen.wire, from: credentials)
            guard let endpoint = wire.endpoint(address) else { throw Failure.notAnAddress }
            // macOS refuses an app plain http to anywhere but its own network. The app
            // does not leave that to the system: a key is not to cross in the clear.
            if endpoint.scheme?.lowercased() == "http", !Self.isNearby(endpoint) { throw Failure.inTheClear }
            let lunaRoutes = Self.isLunaRoute(endpoint, said: credentials.lunaRouteAddress())
            let key = credentials.key(lunaRoutes: lunaRoutes)
            // The usual service takes nothing without a key, so nothing is sent it. One
            // named in its place may be a model served on this Mac, which wants none.
            if key == nil, Self.isUsual(endpoint) { throw Failure.noKey }
            if localOnly, !Self.isOnThisMac(endpoint) { throw Failure.offLimits }
            return Access(key: key, wire: wire, endpoint: endpoint, model: chosen.model ?? credentials.model() ?? Self.defaultModel, lunaRoutes: lunaRoutes)
        }.value
    }

    /// The way the service at `address` is spoken to: as Settings says, else as the
    /// environment says, else as the address itself is taken to say.
    static func wire(for address: String, chosen: AIWire?, from credentials: Credentials) -> AIWire {
        chosen ?? AIWire(named: credentials.format()) ?? AIWire.taken(for: address)
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
        let host = AIWire.host(of: endpoint)
        if host == "lunaroute.com" || host.hasSuffix(".lunaroute.com") { return true }
        guard let theirs = said.flatMap(AIWire.web) else { return false }
        let place = { (url: URL) in "\(AIWire.host(of: url)):\(url.port ?? (url.scheme?.lowercased() == "http" ? 80 : 443))" }
        return place(theirs) == place(endpoint)
    }

    /// Whether the address is the usual service's own.
    private static func isUsual(_ endpoint: URL) -> Bool {
        AIWire.host(of: endpoint) == URL(string: defaultAddress)?.host
    }

    /// Whether the address is this Mac's own: what is sent there goes nowhere else.
    static func isOnThisMac(_ endpoint: URL) -> Bool {
        ["127.0.0.1", "localhost", "::1"].contains(AIWire.host(of: endpoint))
    }

    /// Whether the address is this Mac or on its own network: a name with no dot in it or
    /// one ending `.local`, or a number from the ranges kept for private networks.
    static func isNearby(_ endpoint: URL) -> Bool {
        let host = AIWire.host(of: endpoint)
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

    /// Asks, and hands on the text of the answer as it comes.
    ///
    /// - A service that refuses a part of the request as the app words it is asked again
    ///   without it, or with it under another name, and is asked that way first from then
    ///   on, once that way has been seen to work.
    /// - What was learned can stop being true (the same name may come to mean another
    ///   model), so a request refused in a service's known way is asked once more as the
    ///   app words it, and what was known is forgotten.
    /// - A model whose thinking used up its room, so that it was cut off before it had
    ///   said a word, is asked again with twice the room, twice at most. Nothing of that
    ///   is kept for the next request: a model may refuse more room than it can give, and
    ///   what one request needed says little about another of a different size.
    @discardableResult
    private func ask(_ asked: AIWire.Asked, _ chosen: Chosen, onText: @MainActor (String) -> Void) async throws -> Access {
        let access = try await access(chosen)
        let wire = access.wire
        var known = ways.known(for: access.service)
        var parts = known
        var room = 1 // times the room the page asked for
        /// The request, worded for this service as it is now known.
        func worded() -> [String: Any] {
            var asked = asked
            // Never less than was asked for, and no more than the most a request is given.
            if let most = asked.maxTokens { asked.maxTokens = max(most, min(most * room, Self.mostRoom)) }
            var body = wire.body(asked, model: access.model, lunaRoutes: access.lunaRoutes)
            for part in wire.parts where parts.contains(part) { wire.fit(part, &body) }
            return body
        }
        var body = worded()
        var heard = false // whether any of an answer has been handed on
        // It ends: a part is given up once at most, the room doubled twice at most, and
        // what was known forgotten once.
        while true {
            do {
                try await send(body, access) { text in
                    heard = true
                    onText(text)
                }
                // (Only what this request found out: another, still on its way, may have
                // found out more since this one began.)
                if parts != known { ways.learn(parts, for: access.service) }
                return access
            } catch Failure.refused(let refusal) {
                let ofTheRequest = [400, 422].contains(refusal.status)
                if ofTheRequest, let part = wire.parts.first(where: { wire.refuses($0, in: body, saying: refusal.whole) }) {
                    parts.insert(part)
                } else if ofTheRequest, room > 1 {
                    // It had run out of room, and will not be given more: that is the
                    // story, not the refusal of a room the person never asked for.
                    throw Failure.cutShort
                } else if ofTheRequest, !known.isEmpty {
                    known = []
                    parts = []
                    ways.learn([], for: access.service)
                } else {
                    throw Failure.refused(refusal)
                }
                body = worded()
            } catch Failure.cutShort {
                // What had begun to arrive is with the page already, and cannot be asked for again.
                guard !heard, room < 4, let most = asked.maxTokens, most * room < Self.mostRoom else { throw Failure.cutShort }
                room *= 2
                body = worded()
            }
        }
    }

    /// Sends one request and hands on the text of the answer as it comes.
    private func send(_ body: [String: Any], _ access: Access, onText: @MainActor (String) -> Void) async throws {
        var request = access.wire.request(to: access.endpoint, key: access.key?.value)
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (bytes, response) = try await session.bytes(for: request, delegate: stays)
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            var said = Data()
            for try await byte in bytes.prefix(4096) { said.append(byte) }
            throw Failure.refused(Refusal(status: status, said: Self.words(in: said, without: access.key?.value), whole: String(decoding: said, as: UTF8.self), keyed: access.key != nil))
        }
        // A line that goes dead part-way looks, from here, like an answer that simply ended.
        // So the answer has to say that it is finished, in whichever way the service does.
        var finished = false
        /// Takes what one line of the stream, or an answer that came whole, amounts to.
        /// True when nothing more need be read.
        func take(_ read: () throws -> AIWire.Heard) async throws -> Bool {
            let heard: AIWire.Heard
            do {
                heard = try read()
            } catch let failed as AIWire.Failed {
                throw Failure.failed(Self.words(of: failed.error, without: access.key?.value) ?? "it gave no reason")
            }
            if let text = heard.text, !text.isEmpty { await onText(text) }
            if heard.cutShort { throw Failure.cutShort }
            if heard.finished { finished = true }
            return heard.over
        }
        if http?.mimeType == "application/json" {
            // A service that takes no notice of "stream" and answers all at once.
            var whole = Data()
            for try await byte in bytes { whole.append(byte) }
            _ = try await take { try access.wire.whole(whole) }
            return
        }
        func hear(_ line: [UInt8]) async throws -> Bool {
            guard let line = String(bytes: line, encoding: .utf8) else { return false }
            return try await take { try access.wire.hear(line) }
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
            let over = try await hear(line)
            line.removeAll(keepingCapacity: true)
            if over { break read }
        }
        if !finished, !line.isEmpty { _ = try await hear(line) }
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
