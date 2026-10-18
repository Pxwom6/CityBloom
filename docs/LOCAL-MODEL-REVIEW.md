# Local model review (Qwen 3.5 35B-A3B via `local-delegate`)

A trial on 2026-10-18, branch `local-model-test`: three Vitest files delegated one per call, each
reviewed, run, linted and typechecked by Claude. Nothing is committed yet.

## Results

| File | Calls | Wall time | Tokens out | Lines | Fixes needed |
| --- | --- | --- | --- | --- | --- |
| `tests/unlocks.test.ts` | 1 | 138 s | 5,626 | 30 | none |
| `tests/achievements.test.ts` | 2 | 249 s (failed) + 26 s | 12,000 + 1,230 | 25 | none (first call wrote nothing) |
| `tests/policies-data.test.ts` | 1 | 208 s | 10,195 | 66 | none |

All 13 tests pass; `npm run lint` and `npm run typecheck` are clean. A deliberate break (renaming
the `skyline` check in `progress.ts`) made the achievements test fail and name `skyline`, so the
tests do catch what they claim to.

## What it does well

- **Turns a precise spec into correct code.** No code errors in any of the three files: right
  imports, Vitest idioms, `expect(value, message)` failure labels, Prettier-clean formatting.
- **Copies house style** from a file in `context_files` (`tests/unlocks.test.ts` worked well as the
  template).
- **Small, sensible restructuring** where the spec allowed it (it folded the `freeTransitSeconds`
  check into the effects loop; same meaning).

## What goes wrong

- **Runaway reasoning.** Most output tokens are hidden thinking, not code: about 10,000 tokens to
  write 66 lines. With the default `max_tokens` of 12,000 the achievements call hit the limit after
  249 s and wrote nothing. The retry took 26 s once the spec said "the spec is complete; don't
  analyse the context files at length" and `max_tokens` was raised to 24,000.
- **Slow.** 2–4 minutes per small file, so every call goes to the background and costs Claude an
  extra turn when the result arrives.
- **Needs the thinking done for it.** Every file worked only because the spec already settled the
  hard parts: that `unlocksAt(0)` lists the 'Extra truck' module (modules and policies skip the
  population > 0 guard), that `CHECKS` in `progress.ts` isn't exported and must be read as text, and
  that unlock populations should be `MILESTONES` thresholds. The local model never had to discover
  any of these.

## Is it cheaper than Claude writing the file?

**Not for files this small.** The Claude-side cost of a delegation is reading the source (needed
either way) + writing a spec nearly as long as the test itself + an extra turn when the background
result arrives (which re-sends the whole conversation) + reading the result back for review. For a
30–70 line test that adds up to roughly as much or more than writing it directly, and it takes
minutes longer.

It should pay off when the output is much bigger than the spec: many similar files from one
pattern, long data tables, bulk boilerplate.

## Tips for the next session

- Always pass `max_tokens: 24000` (or more); a cut-off call writes nothing and wastes the wait.
- Open the spec with "The spec below is complete; don't analyse the context files at length, just
  write the file." That turned a 249 s failure into a 26 s success.
- If the `local-delegate` server can turn Qwen's thinking off (`enable_thinking: false` in the chat
  template, or `/no_think`), try it: the hidden reasoning is most of the time spent.
- Give one short template file in `context_files`, plus the source under test.
- Still review every result and run the tests with a deliberate break: it was right three times out
  of three here, but these tasks were spelled out in detail.
