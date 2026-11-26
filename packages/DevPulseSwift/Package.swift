// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DevPulseSwift",
    platforms: [.iOS(.v15), .macOS(.v12), .tvOS(.v15)],
    products: [
        .library(name: "DevPulseSwift", targets: ["DevPulseSwift"]),
    ],
    targets: [
        .target(name: "DevPulseSwift", path: "Sources/DevPulseSwift"),
    ]
)
