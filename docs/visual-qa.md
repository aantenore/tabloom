# Visual QA ledger

Reviewed 2026-07-19.

## Method

- Reference concept native size: 1536 × 1024.
- Implementation capture viewport: 1536 × 1024 in Playwright Chromium.
- Runtime state: three live pages, one owner, two peers, completed deterministic stream.
- Responsive capture: 390 px wide full-page Chromium render with the same three-page topology.
- The repository Playwright runtime was used for inspection because the interactive browser runtime was unavailable.

## Fidelity comparison

| Point                 | Reference intent                                      | Implemented result                                                         | Assessment             |
| --------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| Information hierarchy | Global status, topology, controls, then event lineage | Same three-level hierarchy with persistent status header and lower ledger  | High                   |
| Topology composition  | Owner above a woven hub with two lateral peers        | Same owner/peer geometry, explicit local-page flag, live lease state       | High                   |
| Control rail          | Compact prompt, actions, capacity, privacy, protocol  | Same rail plus an explicit sibling-page action and request output          | High                   |
| Event evidence        | Dense, safe, chronological table                      | Live newest-first table with epoch, attempt, source, request, and queue    | High                   |
| Palette and depth     | Navy/graphite, cyan ownership, coral disruption       | Matched tokens, borders, restrained glow, and code-native SVG mark         | High                   |
| Copy                  | Product-control wording                               | Uses precise alpha terms such as deterministic simulation and owner stop   | Intentional difference |
| Mobile adaptation     | Not specified by the desktop concept                  | Cards stack, connectors collapse, controls remain reachable, table scrolls | Added                  |

## Findings resolved

- Hid the secondary broker health pill on narrow screens so the status header no longer exposes a clipped partial control.
- Preserved horizontal scrolling only for the dense event ledger, where column integrity is more useful than destructive wrapping.
- Kept every visible metric tied to live broker state; no decorative throughput or memory number is fabricated.

## Result

Pass. The implementation preserves the concept's visual system and primary information architecture while making copy, interactions, accessibility labels, and responsive behavior executable.

## WebLLM live lab

The opt-in provider page was inspected at a 1280 × 720 Playwright Chrome viewport with two pages sharing one namespace.

- Owner view exposed role, readiness, provider evidence, WebGPU availability, selected model, peer count, and provider progress without showing prompt content in diagnostics.
- Peer view kept generation controls disabled until broker readiness, then displayed the exact streamed result and completed terminal state.
- The compact dark surface remained readable with the long model identifier and the generated response wrapped without horizontal overflow.
- No synthetic throughput or memory figure was added; token usage and lifecycle assertions remain hidden test evidence rather than decorative UI metrics.

## Adaptive-topology labs

The v0.3 deterministic route at `/shared-worker.html` is a focused protocol surface rather than a replacement for the main observability dashboard. It exposes only values tied to broker state:

- requested and selected topology;
- pre-commit fallback reason;
- broker role, readiness, host identity, tab identity, and fencing epoch;
- runtime-fingerprint compatibility;
- request terminal state, deterministic output, cancellation, and safe error code.

Multiple sibling pages exercise one shared admission boundary. The page that creates the first worker can close while the remaining pages verify the supported host lifecycle. On the portable Apple WebKit policy, the same route visibly selects the page-owner baseline before worker startup. Explicit SharedWorker scenarios remain testable without presenting them as portable lifecycle support.

The built preview route was inspected in the interactive browser at the default 1512 px viewport and at 390 × 844. The first visual pass exposed that the lab had inherited the main dashboard shell without owning its section styles; a dedicated stylesheet now isolates its hero, live-status grid, request controls, focus states, and mobile stacking. The corrected route had no horizontal overflow or console warnings/errors. Its primary interaction completed with `Woven once: Shared worker runtime`, proving that the polished surface still drives the real broker flow.

The WebLLM lab retains its page-owner baseline and accepts `?topology=shared-worker` for opt-in provider evidence. In that mode the page displays the selected topology while the model adapter lives in the worker entry. The lab does not display prompts in diagnostics and does not invent memory, throughput, cost, or portability metrics.

Final visual acceptance was taken from the built preview routes, because development-server worker behavior alone is not packaging evidence.
