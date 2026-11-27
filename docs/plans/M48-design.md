# M48 Send it in: plan

The brief (SPEC-6.md, M48): players send ideas and buildings; only the owner sees them unless accepted;
players see their own submissions' status through a private browser token; an accepted list in the
game; the owner reviews, replies, downloads and copies for Claude Code; caps, rates, a 30-day sweep.

## 1. The desk (relay, as M41's reports and M44's board)
- `relay/submissions.ts`: `SubmissionsDesk` on SQLite (`Sql`, the Worker's `SubmissionsObject`,
  migration v4, and the local relay with Node's SQLite).
  - Rows: id, kind (`idea` | `building`), for ideas a kind of idea (building, feature, fix, scenario,
    other), title (80), text (1,500), an optional screenshot (JPEG, 400 kB of base64); for buildings the
    model (base64, ≤ 1 MB of bytes), its hash (checked against the bytes), name, target, a line (200);
    credit (a display name, cleaned as room names are, through the owner's word filter); status `sent` |
    `seen` | `accepted` | `declined`, the owner's reply (300), times; the SHA-256 of the player's token
    (never the token), and nothing else about the player (the address only in memory, for rates).
  - Checks: shapes and lengths, the base64, a GLB's header and JSON (no outside links), the model's
    hash, a JPEG's magic; the full model check runs in the owner's browser (the Worker's CPU can't).
  - Limits (`SUBMIT_LIMITS`): 5 a day per token and per address (in memory, UTC day), bodies capped,
    at most 2,000 kept (then "the inbox is full"), 3,000 rows a day; declined ones deleted 30 days after
    the decision (the sweep, an alarm and on each write); accepted ones kept until deleted.
- `relay/submissionsHttp.ts`:
  - `POST /submit` (JSON as text/plain: no preflight) → `{ id }`.
  - `POST /submit/mine` `{ token }` (built as `GET ?token=`, moved to the body after the review) → the token's submissions: id, kind, title or name, status, reply, times.
    Never anyone else's: the token is 32 random hex digits from the browser, stored only as its hash.
  - `GET /submit/accepted` → accepted ones only: kind, title or name, credit, line, when.
  - `GET /owner/submissions?kind=&status=` → every submission newest first, without the files.
  - `GET /owner/submissions/<id>` → one with its screenshot or model.
  - `POST /owner/submissions/<id>` → `{ status, reply }` or `{ action: 'delete' }`.
  - `POST /owner/submissions/words` → `{ words }`.
  - Owner requests need `OWNER_KEY` (the reports' checker, limits on wrong keys).

## 2. The page
- `src/client/submissions.ts`: `SubmitClient` (`Game.submissions`): the token (localStorage
  `citybloom.submitToken`, made on first send), send an idea or a building, the player's list with
  statuses, the accepted list; a building is checked again before it goes.
- UI `src/ui/Submit.tsx`: the screen `submit` (Send an idea: kind, title, description, the screenshot
  ticked or not with its picture, credit me as), a review card showing exactly what will be sent and
  that only the owner sees it unless it's picked, then sent; My submissions (status, reply); Accepted
  ideas (screen `accepted`, also from the Learn page? no: from the main menu). "Send an idea" on the
  main and pause menus; "Send it in" on My buildings' rows and the Workshop's Use step (a building,
  prefilled).
- Phones: the screens as sheets, 44 px.

## 3. The owner area
- `src/owner/OwnerSubmissions.tsx` (a tab beside Reports and Weekly challenge): filters by kind and
  status; an idea's text and screenshot; a building's turntable (`ModelPreview`, day and night) and the
  check run in the owner's browser; Seen, Accept, Decline with a reply; Delete; the word filter;
  Download GLB (named with its credit); Copy for Claude Code (what it is, where it goes in
  `assets/models/`, the credit for CREDITS.md, an idea in full).

## 4. Tests and done
- Unit: the desk (shapes, caps, rates per token and address, the hash, the sweep, the owner key, a
  token reading only its own, the accepted list only accepted), the HTTP layer, the page client.
- E2E `e2e/m48-submit.spec.ts` against the local relay: an idea with a screenshot and a building sent
  through the UI; the owner area accepts one with a reply and declines the other; the player sees both
  statuses; the accepted list shows only the accepted one; nothing reachable without the key; a
  modified client past the caps refused and unable to read another's submissions. Phones.
