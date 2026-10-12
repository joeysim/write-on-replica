import Foundation

/// Asks the AI service on the page's behalf (design spec 7 and 7.1). The service is
/// LunaRoute, or anything else that takes OpenAI-style chat completions and streams the
/// answer as server-sent events. The key stays on this side: the page sends a request
/// and is sent back text.
///
///     page  -> shell   ai.start  { id, messages, maxTokens, effort, schema? }
///     shell -> page    ai.delta  { id, text }      as the answer streams
///                      ai.done   { id }
///                      ai.error  { id, message }   one line a person can read
///     page  -> shell   ai.cancel { id }
final class AIClient {
    static let defaultAddress = "https://gw.lunaroute.com/v1"
    static let defaultModel = "glm-5.3-flash"
    static let noKey = "No LunaRoute key — add one in Settings (⌘,)"

    typealias Emit = (_ event: String, _ payload: [String: Any]) -> Void

    private let credentials: Credentials
    private let settings: AppSettings
    private let session: URLSession
    /// Requests on their way, by whose they are (a window) and the id its page gave them.
    /// Main thread only.
    private var running: [String: Task<Void, Never>] = [:]

    /// - Parameter idle: how long a stream may say nothing before it is given up on.
    init(credentials: Credentials, settings: AppSettings, idle: TimeInterval = 20) {
        self.credentials = credentials
        self.settings = settings
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
                let access = try await self.ask(body, chosen) { _ in }
                let took = String(format: "%.1f", Date().timeIntervalSince(began))
                report("Connected: \(access.model) answered in \(took) s, with the key \(Self.describe(access.source)).")
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
        let key: String
        let source: Credentials.Source
        let address: URL
        let model: String
    }

    private enum Failure: Error {
        case noKey
        case notAnAddress
        /// The service answered with a status that is not success, and perhaps a reason.
        case refused(Int, String?)
        /// The service said, part-way through the answer, that it had failed.
        case failed(String)
        /// The model reached the most it was allowed to write before it had finished.
        case cutShort
    }

    /// Where to send a request and with what. Off the main thread: the first time, finding
    /// the key may mean asking the login shell.
    private func access(_ chosen: Chosen) async throws -> Access {
        let credentials = credentials
        return try await Task.detached(priority: .userInitiated) {
            guard let key = credentials.key() else { throw Failure.noKey }
            let address = chosen.address ?? credentials.address() ?? Self.defaultAddress
            guard let url = URL(string: address), let scheme = url.scheme?.lowercased(), ["https", "http"].contains(scheme), url.host != nil else {
                throw Failure.notAnAddress
            }
            return Access(key: key.value, source: key.source, address: url, model: chosen.model ?? Self.defaultModel)
        }.value
    }

    /// Sends one request and hands on the text of the answer as it comes.
    @discardableResult
    private func ask(_ body: [String: Any], _ chosen: Chosen, onText: @MainActor (String) -> Void) async throws -> Access {
        let access = try await access(chosen)
        var body = body
        body["model"] = access.model
        var request = URLRequest(url: access.address.appendingPathComponent("chat/completions"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(access.key)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (bytes, response) = try await session.bytes(for: request)
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            var said = Data()
            for try await byte in bytes.prefix(4096) { said.append(byte) }
            throw Failure.refused(status, Self.words(in: said, without: access.key))
        }
        if http?.mimeType == "application/json" {
            // A gateway that takes no notice of "stream" and answers all at once.
            var whole = Data()
            for try await byte in bytes { whole.append(byte) }
            let answer = (try? JSONSerialization.jsonObject(with: whole)) as? [String: Any]
            let message = (answer?["choices"] as? [[String: Any]])?.first?["message"] as? [String: Any]
            if let text = message?["content"] as? String, !text.isEmpty { await onText(text) }
            return access
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
                throw Failure.failed(Self.words(of: error, without: access.key) ?? "it gave no reason")
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
        return access
    }

    // MARK: Reasons

    /// One line a person can read. Never anything of the request, and never the key.
    private static func reason(for error: Error) -> String {
        switch error {
        case Failure.noKey:
            return noKey
        case Failure.notAnAddress:
            return "The address in Settings (⌘,) is not a web address."
        case Failure.refused(let status, let said):
            switch status {
            case 401, 403: return "The key was not accepted (\(status)). Check it in Settings (⌘,)."
            case 429: return "Too many requests, or out of quota (429). Try again in a moment."
            case 500...: return "The AI service had a problem (\(status)). Try again in a moment."
            default: return "The request was refused (\(status))" + (said.map { ": \($0)" } ?? ".")
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
    private static func words(in body: Data, without key: String) -> String? {
        guard let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else { return nil }
        return words(of: object["error"] ?? object["message"] as Any, without: key)
    }

    private static func words(of error: Any, without key: String) -> String? {
        let said = (error as? [String: Any])?["message"] as? String ?? error as? String
        guard let line = said?.split(whereSeparator: \.isNewline).first.map(String.init)?.trimmingCharacters(in: .whitespaces), !line.isEmpty else { return nil }
        let clean = line.replacingOccurrences(of: key, with: "(the key)")
        return clean.count > 140 ? String(clean.prefix(140)) + "…" : clean
    }
}
