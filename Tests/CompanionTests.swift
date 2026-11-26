import Foundation
import SwiftData
import Testing

@testable import InboxAndChill

@MainActor
struct CompanionTests {
    @Test func bridgeUsesConnectorStateAndLimitsItsScope() async throws {
        let container = try ModelContainer(for: Item.self, SourceConfig.self, Topic.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let store = Store(modelContainer: container)
        let engine = SyncEngine(store: store) { _ in }
        for kind in ["github", "linear", "ntfy", "local", "appleMail"] {
            let item = RemoteItem(externalID: "1", kind: "review", title: "Review",
                url: kind == "local" ? "file:///private/example" : "https://example.org",
                occurredAt: .now, groupLabel: "example/repo")
            _ = try await store.reconcile(snapshot: [item], sourceID: kind,
                sourceKind: kind, remoteTruth: false)
        }
        let rows = try await engine.companionSnapshot()
        #expect(Set(rows.map(\.source)) == Set(CompanionItem.sources))
        #expect(rows.first { $0.source == "local" }?.url == nil)
        #expect(try await engine.applyCompanionAction(.init(id: "appleMail:1", verb: .done)) == 404)
        for verb in [CompanionAction.Verb.read, .pin, .archive, .restore, .unread] {
            #expect(try await engine.applyCompanionAction(.init(id: "github:1", verb: verb)) == 200)
        }
        #expect(try await engine.applyCompanionAction(.init(id: "github:1", verb: .snooze, until: 1)) == 400)
        let row = try #require(try await store.companionItems().first { $0.source == "github" })
        #expect(row.unread && row.pinned && !row.archived && row.group == "example/repo")
    }

    @Test func sourceWritesUseTheOriginalExternalIDAndLocalArchiveStaysLocal() async throws {
        actor Source: Connector {
            let sourceID = "workspace"
            let sourceKind = "linear"
            let capabilities: ConnectorCapabilities = [.push, .remoteSnooze, .markDone]
            var snoozedID: String?
            var doneID: String?
            func fetch() async throws -> [RemoteItem] { [] }
            func snooze(externalID: String, until: Date, payload: Data?) { snoozedID = externalID }
            func markDone(externalID: String, payload: Data?) throws {
                doneID = externalID
                throw URLError(.notConnectedToInternet)
            }
        }
        let store = try Store(modelContainer: ModelContainer(for: Item.self, SourceConfig.self, Topic.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)))
        let engine = SyncEngine(store: store) { _ in }
        let source = Source()
        await engine.register(source)
        let item = RemoteItem(externalID: "inbox:42", kind: "mention", title: "Mention", occurredAt: .now)
        _ = try await store.reconcile(snapshot: [item], sourceID: source.sourceID, sourceKind: "linear", remoteTruth: false)
        let id = "linear:inbox:42"
        #expect(try await engine.applyCompanionAction(.init(id: id, verb: .archive)) == 200)
        #expect(await source.doneID == nil)
        #expect(try await engine.applyCompanionAction(.init(id: id, verb: .restore)) == 200)
        #expect(try await engine.applyCompanionAction(.init(id: id, verb: .snooze,
            until: Date.now.addingTimeInterval(600).timeIntervalSince1970 * 1000)) == 200)
        #expect(await source.snoozedID == "inbox:42")
        #expect(try await engine.applyCompanionAction(.init(id: id, verb: .done)) == 502)
        #expect(await source.doneID == "inbox:42")
        #expect(try await store.companionItems().first?.archived == true)
        await engine.unregisterAll()
    }

    @Test func loopbackBridgeSeparatesProducerAndCompanionPermissions() async throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appending(path: "local-api.json")
        let listener = LocalListener(infoFileURL: file)
        let container = try ModelContainer(for: Item.self, SourceConfig.self, Topic.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let store = Store(modelContainer: container)
        let item = RemoteItem(externalID: "abc", kind: "codex_waiting", title: "Review on Mac", occurredAt: .now)
        _ = try await store.reconcile(snapshot: [item], sourceID: "agent", sourceKind: "local", remoteTruth: false)
        await listener.useCompanionEngine(SyncEngine(store: store) { _ in })
        let generation = try await listener.start(onNotify: { _ in }, onClear: { _ in })
        struct Info: Decodable { let port: Int; let token, companionToken: String }
        let info = try JSONDecoder().decode(Info.self, from: Data(contentsOf: file))
        func call(_ path: String, _ token: String, _ body: String? = nil) async throws -> (Data, Int) {
            let parsedURL = URL(string: "http://127.0.0.1:\(info.port)"+path)
            var request = URLRequest(url: try #require(parsedURL))
            request.setValue("Bearer "+token, forHTTPHeaderField: "Authorization")
            if let body { request.httpMethod = "POST"; request.httpBody = Data(body.utf8) }
            let (data, response) = try await URLSession.shared.data(for: request)
            return (data, try #require((response as? HTTPURLResponse)?.statusCode))
        }
        do {
            #expect(try await call("/companion/items", info.token).1 == 401)
            #expect(try await call("/notify", info.companionToken, #"{"title":"test"}"#).1 == 401)
            let (data, status) = try await call("/companion/items", info.companionToken)
            #expect(status == 200)
            #expect(String(decoding: data, as: UTF8.self).contains("codex_waiting"))
            #expect(try await call("/companion/action", info.companionToken,
                #"{"id":"local:abc","verb":"archive"}"#).1 == 200)
            #expect(try await store.companionItems().first?.archived == true)
        } catch {
            await listener.stop(generation: generation)
            throw error
        }
        await listener.stop(generation: generation)
        #expect(!FileManager.default.fileExists(atPath: file.path))
    }
}
