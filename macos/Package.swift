// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "UsefulBrain",
    platforms: [.macOS(.v14)],
    targets: [
        .target(name: "UsefulBrainCore"),
        .executableTarget(name: "UsefulBrainApp", dependencies: ["UsefulBrainCore"]),
        .testTarget(name: "UsefulBrainCoreTests", dependencies: ["UsefulBrainCore"]),
    ]
)
