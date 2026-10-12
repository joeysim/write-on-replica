import WebKit

/// Messages between the page and the shell.
///
/// The page calls `window.webkit.messageHandlers.writeon.postMessage({method, params})`
/// and gets a promise back. The shell pushes events with `emit`, which the page receives
/// through `window.__writeon.emit(event, payload)`.
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "writeon"

    struct Failure: Error {
        let message: String
        init(_ message: String) { self.message = message }
    }

    typealias Reply = (Result<Any?, Failure>) -> Void
    typealias Handler = (_ params: [String: Any], _ reply: @escaping Reply) -> Void

    weak var webView: WKWebView?
    private var handlers: [String: Handler] = [:]

    /// Registers a handler that answers later (file panels, network).
    func on(_ method: String, _ handler: @escaping Handler) {
        handlers[method] = handler
    }

    /// Registers a handler that answers immediately.
    func on(_ method: String, sync handler: @escaping (_ params: [String: Any]) throws -> Any?) {
        handlers[method] = { params, reply in
            do {
                reply(.success(try handler(params)))
            } catch let failure as Failure {
                reply(.failure(failure))
            } catch {
                reply(.failure(Failure(error.localizedDescription)))
            }
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else {
            replyHandler(nil, "malformed bridge message")
            return
        }
        guard let handler = handlers[method] else {
            replyHandler(nil, "unknown bridge method: \(method)")
            return
        }
        let params = body["params"] as? [String: Any] ?? [:]
        handler(params) { result in
            switch result {
            case .success(let value): replyHandler(value ?? NSNull(), nil)
            case .failure(let failure): replyHandler(nil, failure.message)
            }
        }
    }

    /// Asks the page something it has said it can answer (`native.answer` there) and waits
    /// for it: the one way the shell gets anything out of the page that it did not send.
    func ask(_ question: String, _ params: [String: Any] = [:], then reply: @escaping (Result<Any?, Failure>) -> Void) {
        guard let webView else { return reply(.failure(Failure("there is no page to ask"))) }
        webView.callAsyncJavaScript(
            "return await window.__writeon.answer(question, params)",
            arguments: ["question": question, "params": params],
            in: nil,
            in: .page
        ) { result in
            switch result {
            case .success(let value): reply(.success(value is NSNull ? nil : value))
            case .failure(let error): reply(.failure(Failure(error.localizedDescription)))
            }
        }
    }

    /// Sends an event to the page. `payload` must be JSON-serialisable.
    func emit(_ event: String, _ payload: Any = [String: Any]()) {
        guard let webView,
              let data = try? JSONSerialization.data(withJSONObject: [event, payload]),
              let json = String(data: data, encoding: .utf8)
        else { return }
        webView.evaluateJavaScript("window.__writeon && window.__writeon.emit(...\(json));", completionHandler: nil)
    }
}
