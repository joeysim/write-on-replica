import Foundation
import WebKit

/// Serves the bundled page at `writeon://app/…`. Nothing outside the web root is readable.
final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "writeon"
    static let host = "app"
    static let indexURL = URL(string: "writeon://app/index.html")!

    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
    }

    /// `WRITEON_WEB_ROOT` if set (to run a built app against a working copy of the page),
    /// otherwise the copy bundled in the app, otherwise `web/` in the current directory.
    static func locateWebRoot() -> URL? {
        let fm = FileManager.default
        var candidates: [URL] = []
        if let override = ProcessInfo.processInfo.environment["WRITEON_WEB_ROOT"] {
            candidates.append(URL(fileURLWithPath: override, isDirectory: true))
        }
        if let resources = Bundle.main.resourceURL {
            candidates.append(resources.appendingPathComponent("web", isDirectory: true))
        }
        candidates.append(URL(fileURLWithPath: fm.currentDirectoryPath).appendingPathComponent("web", isDirectory: true))
        return candidates.first { fm.fileExists(atPath: $0.appendingPathComponent("index.html").path) }
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == Self.host else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let headers = [
            "Content-Type": Self.contentType(forExtension: file.pathExtension),
            "Content-Length": String(data.count),
            "Cache-Control": "no-store",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.unknown))
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    static func contentType(forExtension ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "txt", "md": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
