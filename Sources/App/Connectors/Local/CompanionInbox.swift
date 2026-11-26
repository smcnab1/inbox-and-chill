import Foundation
import SwiftData

/// Only these fields cross the loopback bridge. Connector payloads, session
/// origins, local file URLs and Keychain entries stay on the Mac.
struct CompanionItem: Encodable, Sendable {
    static let sources = ["github", "linear", "ntfy", "local"]
    let id: String
    let source: String
    let kind: String
    let title: String
    let body: String?
    let url: String?
    let group: String?
    let time: Double
    let unread: Bool
    let pinned: Bool
    let archived: Bool
    let until: Double?

    init(_ item: Item) {
        id = item.uid
        source = item.sourceKind
        kind = item.kind
        title = item.title
        body = item.snippet
        let link = item.url
        url = ["https", "http"].contains(link?.scheme?.lowercased() ?? "")
            && link?.host != nil && link?.user == nil && link?.password == nil
            ? link?.absoluteString : nil
        group = item.groupLabel
        time = item.occurredAt.timeIntervalSince1970 * 1000
        unread = !item.isSeen
        pinned = item.isPinned
        archived = item.isDone
        until = item.snoozedUntil.map { $0.timeIntervalSince1970 * 1000 }
    }
}

struct CompanionAction: Codable, Sendable {
    enum Verb: String, Codable { case read, unread, pin, unpin, snooze, archive, done, restore }
    let id: String
    let verb: Verb
    var until: Double?
}

extension Store {
    func companionItems() throws -> [CompanionItem] {
        let sources = CompanionItem.sources
        let query = FetchDescriptor<Item>(predicate: #Predicate { sources.contains($0.sourceKind) })
        return try modelContext.fetch(query).map(CompanionItem.init)
    }

    func companionTarget(_ uid: String) throws -> SyncEngine.Target? {
        let query = FetchDescriptor<Item>(predicate: #Predicate { $0.uid == uid })
        guard let item = try modelContext.fetch(query).first,
            CompanionItem.sources.contains(item.sourceKind)
        else { return nil }
        return SyncEngine.Target(uid: uid, sourceID: item.sourceID,
            externalID: String(uid.dropFirst(item.sourceKind.count + 1)), payload: item.payload)
    }
}
