import Foundation
import CryptoKit
import Darwin
import AppKit

// Standalone, ad-hoc signed helper. No host Node/Python, Apple credentials, or shell scripts.
let fm = FileManager.default
#if UPDATER_TESTING
let expectedBundleID = "dev.kiro.updater-integration-test"
#else
let expectedBundleID = "com.kiro.account-manager"
#endif
struct Failure: Error, CustomStringConvertible { let description: String; init(_ message: String) { description = message } }
struct Envelope: Codable { let payload: String; let signature: String }
struct Manifest: Codable {
    let schema: Int; let version: String; let arch: String; let bundleId: String
    let appName: String; let file: String; let sha256: String; let size: Int64
}
struct Transaction: Codable {
    let id: String; let appPath: String; let currentVersion: String; let version: String; let arch: String
    let parentPid: Int32
    var phase: String; var helperPid: Int32?; var launchToken: String?; var error: String?
    #if UPDATER_TESTING
    var fault: String?
    #endif
}
struct Health: Codable { let token: String; let pid: Int32; let version: String; let executable: String }
final class LaunchReceipt: @unchecked Sendable {
    let ready = DispatchSemaphore(value: 0)
    let lock = NSLock()
    var expired = false
    var error: Error?
}
func read<T: Decodable>(_ type: T.Type, _ url: URL) throws -> T { try JSONDecoder().decode(type, from: Data(contentsOf: url)) }
func write<T: Encodable>(_ value: T, _ url: URL) throws {
    let data = try JSONEncoder().encode(value)
    try data.write(to: url, options: .atomic)
    // Persist the journal before changing installation paths.
    let fd = open(url.path, O_RDONLY)
    if fd >= 0 { _ = fsync(fd); close(fd) }
    let directory = open(url.deletingLastPathComponent().path, O_RDONLY)
    if directory >= 0 { _ = fsync(directory); close(directory) }
}
@discardableResult func run(_ executable: String, _ args: [String]) throws -> String {
    let process = Process(); let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: executable); process.arguments = args
    process.standardOutput = pipe; process.standardError = pipe
    try process.run()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    let output = String(data: data, encoding: .utf8) ?? ""
    guard process.terminationStatus == 0 else { throw Failure("\(executable): \(output.prefix(2000))") }
    return output
}
func alive(_ pid: Int32) -> Bool { pid > 1 && (kill(pid, 0) == 0 || errno == EPERM) }
func waitExit(_ pid: Int32, seconds: Double = 30) throws {
    let deadline = Date().addingTimeInterval(seconds)
    while alive(pid) {
        guard Date() < deadline else { throw Failure("Application did not exit; installation cancelled") }
        Thread.sleep(forTimeInterval: 0.1)
    }
}
func bundleInfo(_ app: URL) throws -> [String: Any] {
    let data = try Data(contentsOf: app.appendingPathComponent("Contents/Info.plist"))
    guard let info = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
          info["CFBundleIdentifier"] as? String == expectedBundleID else { throw Failure("Unexpected application identity") }
    return info
}
func bundleVersion(_ app: URL) throws -> String { try bundleInfo(app)["CFBundleShortVersionString"] as? String ?? "" }
func swap(_ left: URL, _ right: URL) throws {
    guard renamex_np(left.path, right.path, UInt32(RENAME_SWAP)) == 0 else {
        throw Failure("Atomic application swap failed: \(String(cString: strerror(errno)))")
    }
}

guard CommandLine.arguments.count == 3 else { fputs("Usage: kiro-updater <prepare|install|recover|watch> <transaction.json>\n", stderr); exit(2) }
let mode = CommandLine.arguments[1]
let jobURL = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
let directory = jobURL.deletingLastPathComponent()
let instanceURL = directory.appendingPathComponent("instance.json")
let healthURL = directory.appendingPathComponent("health.json")
let armedURL = directory.appendingPathComponent("armed")

do {
    guard ["prepare", "install", "recover", "watch"].contains(mode), jobURL.lastPathComponent == "transaction.json",
          directory.resolvingSymlinksInPath() == directory else { throw Failure("Invalid transaction location") }
    var tx = try read(Transaction.self, jobURL)
    guard UUID(uuidString: tx.id) != nil, directory.lastPathComponent == tx.id else { throw Failure("Invalid transaction ID") }
    let appURL = URL(fileURLWithPath: tx.appPath).standardizedFileURL
    guard appURL.pathExtension == "app", appURL.resolvingSymlinksInPath() == appURL,
          !appURL.path.hasPrefix("/Volumes/"), !appURL.path.contains("/AppTranslocation/") else { throw Failure("Install application in a writable local directory first") }
    let work = appURL.deletingLastPathComponent().appendingPathComponent(".kiro-update-\(tx.id)")
    let staged = work.appendingPathComponent("Kiro Account Manager.app")
    let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
    let terminal = ["committed", "rolled-back", "failed", "recovery-failed", "cancelled"]

    if mode == "watch" {
        guard let pid = tx.helperPid else { throw Failure("Missing helper PID") }
        while alive(pid) { Thread.sleep(forTimeInterval: 0.5) }
        tx = try read(Transaction.self, jobURL)
        if !terminal.contains(tx.phase) {
            _ = try run(executable.path, ["recover", jobURL.path])
        }
        exit(0)
    }
    let lock = open(directory.appendingPathComponent("lock").path, O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
    guard lock >= 0, flock(lock, LOCK_EX | LOCK_NB) == 0 else { throw Failure("Another update helper is running") }
    defer { flock(lock, LOCK_UN); close(lock) }
    tx = try read(Transaction.self, jobURL)
    func persist(_ phase: String) throws { tx.phase = phase; try write(tx, jobURL) }
    func validateManifest() throws -> Manifest {
        let envelope = try read(Envelope.self, directory.appendingPathComponent("envelope.json"))
        guard let payload = Data(base64Encoded: envelope.payload), payload.count < 16384,
              let signature = Data(base64Encoded: envelope.signature),
              let raw = Data(base64Encoded: trustedUpdatePublicKey) else { throw Failure("Invalid update signature encoding") }
        let key = try Curve25519.Signing.PublicKey(rawRepresentation: raw)
        guard key.isValidSignature(signature, for: payload) else { throw Failure("Update signature rejected") }
        let m = try JSONDecoder().decode(Manifest.self, from: payload)
        guard m.schema == 1, m.bundleId == expectedBundleID, m.appName == "Kiro Account Manager.app",
              m.version == tx.version, m.arch == tx.arch, ["arm64", "x64"].contains(m.arch),
              m.version.range(of: #"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$"#, options: .regularExpression) != nil,
              m.version.compare(tx.currentVersion, options: .numeric) == .orderedDescending,
              m.file == "kiro-account-manager-\(m.version)-\(m.arch)-mac.zip",
              m.size > 0, m.size < 2 * 1024 * 1024 * 1024 else { throw Failure("Update metadata mismatch") }
        return m
    }
    func validateBundle(_ url: URL, version: String) throws {
        guard try bundleVersion(url) == version else { throw Failure("Unexpected application version") }
        try run("/usr/bin/codesign", ["--verify", "--deep", "--strict", url.path])
        // Framework links must remain inside the bundle (including chained relative symlinks).
        guard let entries = fm.enumerator(at: url, includingPropertiesForKeys: [.isSymbolicLinkKey]) else { throw Failure("Cannot inspect application") }
        for case let item as URL in entries {
            if try item.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
                guard item.resolvingSymlinksInPath().path.hasPrefix(url.path + "/") else { throw Failure("Application contains an escaping symbolic link") }
            }
        }
        let info = try bundleInfo(url)
        guard let name = info["CFBundleExecutable"] as? String, !name.contains("/") else { throw Failure("Invalid bundle executable") }
        let architecture = tx.arch == "x64" ? "x86_64" : "arm64"
        try run("/usr/bin/lipo", ["-verify_arch", architecture, url.appendingPathComponent("Contents/MacOS/\(name)").path])
    }
    func stopLaunched() throws {
        guard let instance = try? read(Health.self, instanceURL), instance.token == tx.launchToken, alive(instance.pid) else { return }
        let command = try run("/bin/ps", ["-p", String(instance.pid), "-o", "comm="]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard command.hasPrefix(appURL.path + "/Contents/MacOS/"), command == instance.executable else { throw Failure("Refusing to stop an unrelated process") }
        kill(instance.pid, SIGTERM)
        do { try waitExit(instance.pid, seconds: 10) }
        catch { kill(instance.pid, SIGKILL); try waitExit(instance.pid, seconds: 5) }
    }
    func launch(_ version: String) throws {
        tx.launchToken = UUID().uuidString
        try write(tx, jobURL)
        try? fm.removeItem(at: healthURL); try? fm.removeItem(at: instanceURL)
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        configuration.allowsRunningApplicationSubstitution = false
        configuration.promptsUserIfNeeded = false
        let token = tx.launchToken!
        configuration.arguments = ["--kiro-update-token", token]
        let receipt = LaunchReceipt()
        NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { application, error in
            receipt.lock.lock()
            defer { receipt.lock.unlock(); receipt.ready.signal() }
            if receipt.expired { application?.forceTerminate(); return }
            do {
                if let error = error { throw error }
                guard let application = application, let executable = application.executableURL?.path else { throw Failure("Application did not launch") }
                // Record the PID even when the new application's JS never starts.
                try write(Health(token: token, pid: application.processIdentifier, version: version, executable: executable), instanceURL)
            } catch { receipt.error = error }
        }
        guard receipt.ready.wait(timeout: .now() + 30) == .success else {
            receipt.lock.lock(); receipt.expired = true; receipt.lock.unlock()
            throw Failure("Application launch timed out")
        }
        if let error = receipt.error { throw error }
        #if UPDATER_TESTING
        let timeout: Double = 5
        #else
        let timeout: Double = 60
        #endif
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let health = try? read(Health.self, healthURL), health.token == tx.launchToken,
               health.version == version, health.executable.hasPrefix(appURL.path + "/Contents/MacOS/"), alive(health.pid) { return }
            Thread.sleep(forTimeInterval: 0.2)
        }
        throw Failure("New application did not become healthy (\(version))")
    }
    func rollback(_ reason: String) throws {
        tx.error = reason
        try stopLaunched()
        // Version inspection resolves a crash between the atomic swap and journal write.
        if try bundleVersion(appURL) == tx.version {
            try validateBundle(staged, version: tx.currentVersion)
            try persist("rolling-back")
            try swap(appURL, staged)
        }
        try validateBundle(appURL, version: tx.currentVersion)
        try persist("restarting-old")
        try launch(tx.currentVersion)
        try persist("rolled-back")
    }

    if mode == "prepare" {
        do {
            guard tx.phase == "created", !fm.fileExists(atPath: work.path) else { throw Failure("Transaction already prepared") }
            let manifest = try validateManifest()
            try validateBundle(appURL, version: tx.currentVersion)
            let archive = directory.appendingPathComponent("payload.zip")
            let attributes = try fm.attributesOfItem(atPath: archive.path)
            guard (attributes[.size] as? NSNumber)?.int64Value == manifest.size else { throw Failure("Archive size mismatch") }
            let handle = try FileHandle(forReadingFrom: archive); defer { try? handle.close() }
            var hash = SHA256()
            while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { hash.update(data: data) }
            let digest = hash.finalize().map { String(format: "%02x", $0) }.joined()
            guard digest == manifest.sha256 else { throw Failure("Archive digest mismatch") }
            let listing = try run("/usr/bin/zipinfo", ["-1", archive.path])
            for entry in listing.split(separator: "\n") {
                let components = entry.split(separator: "/", omittingEmptySubsequences: false)
                guard !entry.hasPrefix("/"), !entry.contains("\\"), !components.contains(".."),
                      components.first == Substring(manifest.appName) || components.first == "__MACOSX" else { throw Failure("Unsafe archive entry") }
            }
            try fm.createDirectory(at: work, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            try run("/usr/bin/ditto", ["-x", "-k", archive.path, work.path])
            try validateBundle(staged, version: manifest.version)
            try persist("prepared")
        } catch {
            tx.error = String(describing: error); try? persist("failed")
            // Installation was never touched; leave evidence for manual diagnostics.
            throw error
        }
    } else {
        guard !terminal.contains(tx.phase) else { exit(0) }
        tx.helperPid = getpid(); try write(tx, jobURL)
        if mode == "install" {
            guard tx.phase == "prepared" else { throw Failure("Update is not prepared") }
            let watcher = Process(); watcher.executableURL = executable; watcher.arguments = ["watch", jobURL.path]
            try watcher.run()
            try Data("ready".utf8).write(to: armedURL, options: .atomic)
        } else {
            try Data("ready".utf8).write(to: directory.appendingPathComponent("recovery-armed"), options: .atomic)
        }
        // Cancellation is explicit: a later ordinary quit must not apply a cancelled update.
        do {
            let deadline = Date().addingTimeInterval(30)
            while true {
                if try read(Transaction.self, jobURL).phase == "cancelled" { throw Failure("Installation cancelled") }
                if !alive(tx.parentPid) { break }
                guard Date() < deadline else { throw Failure("Application did not exit; installation cancelled") }
                Thread.sleep(forTimeInterval: 0.1)
            }
        } catch {
            tx.error = String(describing: error)
            let cancelled = (try? read(Transaction.self, jobURL).phase) == "cancelled"
            try persist(cancelled ? "cancelled" : "failed")
            throw error
        }
        do {
            if mode == "recover" {
                try rollback("Recovered an interrupted update")
            } else {
                _ = try validateManifest()
                try validateBundle(staged, version: tx.version)
                try persist("swapping")
                #if UPDATER_TESTING
                if tx.fault == "before-swap" { throw Failure("Injected failure before swap") }
                #endif
                try swap(appURL, staged)
                #if UPDATER_TESTING
                if tx.fault == "crash-after-swap" { exit(86) }
                if tx.fault == "after-swap" { throw Failure("Injected failure after swap") }
                #endif
                try persist("swapped")
                try launch(tx.version)
                try persist("committed")
            }
        } catch {
            do { try rollback(String(describing: error)) }
            catch {
                tx.error = "Recovery failed; old bundle retained at \(staged.path): \(error)"
                try? persist("recovery-failed"); throw error
            }
        }
    }
} catch {
    fputs("\(error)\n", stderr)
    exit(1)
}
