# Vice Bay Nights — Firestore Security Specification (Phase 0)

## Data Invariants
1. **Save Ownership & Isolation (`/players/{userId}`)**: A cloud save document may only be read (`get`), created, or updated by the verified authenticated user whose `request.auth.uid == userId` and `incoming().uid == request.auth.uid`. Collection listing (`list`) and deletion (`delete`) are forbidden.
2. **Leaderboard Integrity (`/leaderboard/{entryId}`)**: Publicly readable (`get`, `list` constrained by `resource.data.contractsCompleted >= 1`), but writes (`create`, `update`) are strictly restricted to the verified owner whose `entryId == request.auth.uid` and `incoming().uid == request.auth.uid`.
3. **Immutable Fields & Server Time**: `uid` and `createdAt` cannot change after creation; `createdAt` (on create) and `updatedAt` (on create & update) must equal `request.time`.
4. **Strict Keys & Bounds**: Every document enforces `hasAll` + `hasOnly` on create, `affectedKeys().hasOnly(...)` on update, bounded strings/numbers/arrays, and enum constraints.

## Dirty Dozen Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. Unauthenticated read/write to `/players/userA`.
2. Unverified email user writing to `/players/userA` or `/leaderboard/userA`.
3. User B attempting `get` or `update` on `/players/userA`.
4. User B attempting `create` on `/players/userB` with spoofed `uid: "userA"`.
5. Creating `/players/userA` with a ghost field `isAdmin: true` (Shadow Update).
6. Creating `/players/userA` with oversized `completed` array (`size > 20`) or non-string element.
7. Updating `/players/userA` with invalid `weather: "blizzard"` or `money: -500` or `upgrade: 99`.
8. Updating `/players/userA` while modifying immutable `createdAt` or `uid`, or client-forging `updatedAt`.
9. User B attempting `create` on `/leaderboard/userA` or `update` on `/leaderboard/userA`.
10. Creating `/leaderboard/userA` with `contractsCompleted: 0` or `contractsCompleted: 99999999` or `bestDurationMs: 10`.
11. Creating `/leaderboard/userA` with PII field `email: "a@b.com"` or oversized `displayName` (`> 40` chars).
12. Querying `/players` collection via `list` or reading/writing any undeclared collection path `/secrets/doc1`.
