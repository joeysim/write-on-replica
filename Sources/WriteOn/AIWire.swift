import Foundation

/// A way of speaking to an AI service (design spec 7.1): where its requests go, how one is
/// worded, how the key travels with it, and how the answer is read. The page knows none of
/// this. It asks in terms of its own (`ai.start`), and the shell words the request for
/// whichever kind of service it is.
enum AIWire: String, CaseIterable {
    /// OpenAI's chat completions, which most services and gateways speak.
    case openAI = "openai"
    /// Anthropic's messages.
    case anthropic

    /// What Settings calls it.
    var title: String {
        switch self {
        case .openAI: return "OpenAI-style"
        case .anthropic: return "Anthropic-style"
        }
    }

    /// The way `word` names, as Settings keeps it and the environment may give it.
    init?(named word: String?) {
        guard let word = word?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), let wire = AIWire(rawValue: word) else { return nil }
        self = wire
    }

    /// The way an address is taken to be spoken to when nobody has said: as it ends, if it
    /// ends as one kind of request or the other; Anthropic's own service, Anthropic's way;
    /// anything else OpenAI's, which is what most services speak.
    static func taken(for address: String) -> AIWire {
        guard let url = web(address) else { return .openAI }
        let path = url.path.lowercased()
        if path.hasSuffix("/chat/completions") { return .openAI }
        if path.hasSuffix("/messages") { return .anthropic }
        let host = host(of: url)
        return host == "anthropic.com" || host.hasSuffix(".anthropic.com") ? .anthropic : .openAI
    }

    /// The name of the machine a web address is at, as names are compared: in small
    /// letters, and without the dot a full name may end with.
    static func host(of url: URL) -> String {
        let host = url.host?.lowercased() ?? ""
        return host.hasSuffix(".") ? String(host.dropLast()) : host
    }

    /// `address` as a web address, or nil if it is not one.
    static func web(_ address: String) -> URL? {
        guard let url = URL(string: address), let scheme = url.scheme?.lowercased(), ["https", "http"].contains(scheme), url.host != nil else { return nil }
        return url
    }

    // MARK: Where a request goes

    /// Where requests to the service at `address` go, or nil if that is not a web address.
    ///
    /// OpenAI's way, an address is given as far as `/v1`, and `chat/completions` comes
    /// after it. Anthropic's way it stops short of `/v1`, and `v1/messages` comes after; one
    /// that has the `/v1` already is taken too. Either way, an address that is already the
    /// whole of where the requests go is used as it stands; and one that is the whole of
    /// where the other way's go (the format having been changed since it was typed) is
    /// taken back to the service's address first.
    func endpoint(_ address: String) -> URL? {
        guard let url = Self.web(address), var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let mine = self == .openAI ? "/chat/completions" : "/messages"
        let others = self == .openAI ? "/messages" : "/chat/completions"
        var path = parts.percentEncodedPath
        // A slash left at the end would make another address of it.
        while path.hasSuffix("/") { path.removeLast() }
        if !path.lowercased().hasSuffix(mine) {
            if path.lowercased().hasSuffix(others) {
                path.removeLast(others.count)
                while path.hasSuffix("/") { path.removeLast() }
            }
            path += self == .anthropic && !path.lowercased().hasSuffix("/v1") ? "/v1/messages" : mine
        }
        parts.percentEncodedPath = path
        return parts.url
    }

    // MARK: How a request is worded

    /// What the page asked, in its own terms.
    struct Asked {
        /// What has been said so far, each with a `role` (system, user, assistant) and its `content`.
        var messages: [[String: Any]]
        /// The most that may come back, thinking included.
        var maxTokens: Int?
        /// How hard to think: low, medium, high.
        var effort: String?
        /// The shape the answer must have, for a Lab pass.
        var schema: [String: Any]?
    }

    /// The request to send to `endpoint`, less its body: the headers, and the key where
    /// this way of speaking carries it.
    func request(to endpoint: URL, key: String?) -> URLRequest {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        switch self {
        case .openAI:
            if let key { request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        case .anthropic:
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
            if let key { request.setValue(key, forHTTPHeaderField: "x-api-key") }
        }
        return request
    }

    /// What was asked, worded this way.
    ///
    /// - Parameter lunaRoutes: whether the service is LunaRoute. Its endpoint for Anthropic's
    ///   way takes no notice of where Anthropic puts the effort (tried on 13 October 2026:
    ///   a trim then thought for a minute and ran out of room), and takes it under OpenAI's
    ///   name instead. So LunaRoute is given it under both.
    func body(_ asked: Asked, model: String, lunaRoutes: Bool) -> [String: Any] {
        var body: [String: Any] = ["model": model, "stream": true]
        switch self {
        case .openAI:
            body["messages"] = asked.messages
            if let most = asked.maxTokens { body["max_tokens"] = most }
            if let effort = asked.effort { body["reasoning_effort"] = effort }
            if let schema = asked.schema {
                body["response_format"] = ["type": "json_schema", "json_schema": ["name": "answer", "strict": true, "schema": schema] as [String: Any]] as [String: Any]
            }
        case .anthropic:
            // The system prompt is apart from what is said to and by the model, and a
            // request has to say how much may come back.
            let isSystem = { (message: [String: Any]) in message["role"] as? String == "system" }
            var system = asked.messages.filter(isSystem).compactMap { $0["content"] as? String }
            var config: [String: Any] = [:]
            if let effort = asked.effort {
                config["effort"] = effort
                if lunaRoutes { body["reasoning_effort"] = effort }
            }
            if let schema = asked.schema {
                config["format"] = ["type": "json_schema", "schema": schema] as [String: Any]
                // And in words: not every service that speaks this way holds an answer to
                // a schema, and one that does not would answer in prose.
                if let written = try? JSONSerialization.data(withJSONObject: schema, options: [.sortedKeys]) {
                    system.append("Answer with one JSON object and nothing else: no words before or after it, and no code fence. It must fit this JSON schema: " + String(decoding: written, as: UTF8.self))
                }
            }
            body["messages"] = asked.messages.filter { !isSystem($0) }
            body["max_tokens"] = asked.maxTokens ?? 4096
            if !system.isEmpty { body["system"] = system.joined(separator: "\n\n") }
            if !config.isEmpty { body["output_config"] = config }
        }
        return body
    }

    // MARK: What a service may refuse

    /// A part of a request that not every service takes as the app words it.
    enum Part: String {
        /// The most that may come back, OpenAI's way. OpenAI's models that reason want it
        /// called `max_completion_tokens`; most other services know it only as `max_tokens`.
        case room
        /// How hard to think. A model that does not reason refuses to be told.
        case effort
        /// The same under OpenAI's name in a request worded Anthropic's way, as LunaRoute
        /// takes it. A service that takes nothing it has not heard of refuses it.
        case effortForLunaRoute
        /// The schema the answer is to be held to, Anthropic's way.
        case shape
        /// Both of the last two: a service may know nothing of where Anthropic puts them.
        case config
    }

    /// The parts of a request worded this way that may be refused, in the order to look
    /// for them in a refusal: the narrowest first.
    var parts: [Part] {
        switch self {
        case .openAI: return [.room, .effort]
        case .anthropic: return [.effortForLunaRoute, .effort, .shape, .config]
        }
    }

    /// Whether `refusal`, the start of what a service sent back with a refusal, is of this
    /// part of `body`: the request has it, and the refusal names it.
    func refuses(_ part: Part, in body: [String: Any], saying refusal: String) -> Bool {
        let names = { (word: String) in refusal.range(of: word, options: [.regularExpression, .caseInsensitive]) != nil }
        let config = body["output_config"] as? [String: Any]
        switch (self, part) {
        case (.openAI, .room):
            // A refusal may name the room for another reason (more was asked for than the
            // model can write), which another name for it would not cure. So it must also
            // say that it does not know the name, or give the other one.
            return body["max_tokens"] != nil && names("max_tokens") && names("max_completion_tokens|unsupported|not supported|unknown|unrecogni[sz]ed|unexpected|not permitted|not allowed")
        case (.openAI, .effort), (.anthropic, .effortForLunaRoute):
            return body["reasoning_effort"] != nil && names("reasoning_effort")
        // The word itself, not a word it is part of: "best-effort" and "information" name
        // nothing in a request.
        case (.anthropic, .effort):
            return config?["effort"] != nil && names("(?<![A-Za-z-])effort(?![A-Za-z])")
        case (.anthropic, .shape):
            return config?["format"] != nil && names("(?<![A-Za-z])(?:format|schema|structured)(?![A-Za-z])")
        case (.anthropic, .config):
            return config != nil && names("output_config")
        default:
            return false
        }
    }

    /// Words `body` the way a service that refuses `part` wants it.
    func fit(_ part: Part, _ body: inout [String: Any]) {
        func leaveOut(_ name: String) {
            guard var config = body["output_config"] as? [String: Any] else { return }
            config.removeValue(forKey: name)
            if config.isEmpty {
                body.removeValue(forKey: "output_config")
            } else {
                body["output_config"] = config
            }
        }
        switch (self, part) {
        case (.openAI, .room):
            if let most = body.removeValue(forKey: "max_tokens") { body["max_completion_tokens"] = most }
        case (.openAI, .effort), (.anthropic, .effortForLunaRoute):
            body.removeValue(forKey: "reasoning_effort")
        case (.anthropic, .effort):
            leaveOut("effort")
        case (.anthropic, .shape):
            leaveOut("format")
        case (.anthropic, .config):
            body.removeValue(forKey: "output_config")
        default:
            break
        }
    }

    // MARK: How an answer is read

    /// What one line of a streamed answer amounts to.
    struct Heard {
        /// A piece of what the model says.
        var text: String?
        /// The answer has said that it is finished. (A line that goes dead part-way looks,
        /// from here, like an answer that simply ended: so an answer has to say.)
        var finished = false
        /// The model reached the most it was allowed to write before it had finished.
        var cutShort = false
        /// Nothing more of the stream need be read.
        var over = false
    }

    /// The service said that it had failed, part-way through its answer or in place of
    /// one: its error as it sent it, or a few words for a way of failing it only names.
    struct Failed: Error {
        let error: Any
    }

    /// Reads one line of a streamed answer. Only what the model says is the answer: what
    /// it thinks on the way is not, nor is anything else the stream carries.
    func hear(_ line: String) throws -> Heard {
        guard line.hasPrefix("data:") else { return Heard() }
        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
        if payload == "[DONE]" { return Heard(finished: true, over: true) }
        guard let event = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] else { return Heard() }
        var heard = Heard()
        switch self {
        case .openAI:
            if let error = event["error"] { throw Failed(error: error) }
            let choice = (event["choices"] as? [[String: Any]])?.first
            if let text = (choice?["delta"] as? [String: Any])?["content"] as? String, !text.isEmpty { heard.text = text }
            if let reason = choice?["finish_reason"] as? String {
                // Stopped at its limit, with thinking and answer both counted against it:
                // whatever it had begun to say is not an answer.
                if reason == "length" { heard.cutShort = true } else { heard.finished = true }
            }
        case .anthropic:
            // An error says it is one; a gateway's may not say what kind of line it is at all.
            if let error = event["error"], event["type"] as? String ?? "error" == "error" { throw Failed(error: error) }
            switch event["type"] as? String {
            case "content_block_delta":
                let delta = event["delta"] as? [String: Any]
                if delta?["type"] as? String == "text_delta", let text = delta?["text"] as? String, !text.isEmpty { heard.text = text }
            case "message_delta":
                try stopped((event["delta"] as? [String: Any])?["stop_reason"] as? String, &heard)
            case "message_stop":
                heard.finished = true
                heard.over = true
            default:
                break // a ping, the start or the end of a block, or a kind of event not heard of
            }
        }
        return heard
    }

    /// What Anthropic's reason for stopping makes of an answer. Not every reason is an ending.
    private func stopped(_ reason: String?, _ heard: inout Heard) throws {
        switch reason {
        case nil: break
        case "max_tokens": heard.cutShort = true
        case "refusal": throw Failed(error: "the model declined to answer")
        case "model_context_window_exceeded": throw Failed(error: "the piece and the answer together are more than the model can hold")
        default: heard.finished = true
        }
    }

    /// Reads an answer that came all at once, from a service that takes no notice of
    /// being asked to stream.
    func whole(_ data: Data) throws -> Heard {
        let answer = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        // An error may come where an answer was expected, with nothing but itself to say so.
        if let error = answer?["error"] { throw Failed(error: error) }
        var heard = Heard(finished: true, over: true)
        switch self {
        case .openAI:
            let choice = (answer?["choices"] as? [[String: Any]])?.first
            heard.text = (choice?["message"] as? [String: Any])?["content"] as? String
            heard.cutShort = choice?["finish_reason"] as? String == "length"
        case .anthropic:
            let blocks = answer?["content"] as? [[String: Any]] ?? []
            heard.text = blocks.filter { $0["type"] as? String == "text" }.compactMap { $0["text"] as? String }.joined()
            try stopped(answer?["stop_reason"] as? String, &heard)
        }
        return heard
    }
}
