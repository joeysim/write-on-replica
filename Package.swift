// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "WriteOn",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "WriteOn", path: "Sources/WriteOn")
    ],
    swiftLanguageVersions: [.v5]
)
