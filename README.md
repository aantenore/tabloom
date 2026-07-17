# TabLoom

[![CI](https://github.com/aantenore/tabloom/actions/workflows/ci.yml/badge.svg)](https://github.com/aantenore/tabloom/actions/workflows/ci.yml)
[![Browser conformance](https://github.com/aantenore/tabloom/actions/workflows/browser.yml/badge.svg)](https://github.com/aantenore/tabloom/actions/workflows/browser.yml)
[![CodeQL](https://github.com/aantenore/tabloom/actions/workflows/codeql.yml/badge.svg)](https://github.com/aantenore/tabloom/actions/workflows/codeql.yml)

TabLoom is a same-origin browser inference broker. It coordinates sibling pages so one live page owns the inference runtime while peers stream requests through it.

It supplies the coordination layer, not a model runtime: exclusive ownership, monotonic fencing epochs, protocol validation, bounded admission, streaming sessions, cancellation, timeouts, takeover, and privacy-safe telemetry.

> **Alpha:** the release-gated adapter is deterministic simulation. WebLLM and Transformers.js are documented integration seams, not verified GPU or model evidence.

## Why

Loading the same local model in every open page can multiply scarce device memory. Browser runtimes already solve inference and generic election packages already solve ownership; TabLoom focuses on the missing inference-specific lifecycle across owner changes.

## Architecture

```mermaid
flowchart LR
  P1["Peer page A"] <--> C["BroadcastChannel protocol"]
  P2["Peer page B"] <--> C
  C <--> O["Elected owner page"]
  L["Exclusive Web Lock"] --> O
  E["Persistent monotonic epoch"] --> O
  O --> A["Replaceable inference adapter"]
```

- Web Locks elect exactly one owner inside a storage bucket.
- Same-origin storage advances the fencing epoch while the lock is held.
- BroadcastChannel carries runtime-validated, versioned envelopes.
- Ports keep election, transport, clock, IDs, telemetry, and inference replaceable.
- Clients reject stale epochs and accept at most one terminal result per session.

## Install the prerelease archive

The first alpha is distributed as a GitHub release archive rather than an npm registry publication.

```bash
curl -LO https://github.com/aantenore/tabloom/releases/download/v0.1.0-alpha.1/tabloom-0.1.0-alpha.1.tgz
pnpm add ./tabloom-0.1.0-alpha.1.tgz
```

Verify the adjacent `.sha256` asset before installing in a controlled delivery pipeline.

## Quick start

```ts
import {
  DeterministicInferenceAdapter,
  createBrowserBroker,
} from '@aantenore/tabloom';

const broker = createBrowserBroker({
  adapter: new DeterministicInferenceAdapter(),
  config: {
    namespace: 'my-app-local-inference',
    queueCapacity: 8,
    requestTimeoutMs: 30_000,
  },
});

const unsubscribe = broker.subscribe((snapshot, event) => {
  console.log(snapshot.role, snapshot.epoch, event?.type);
  if (event?.type === 'retry') {
    // Clear any partial presentation: streaming restarts on the new epoch.
  }
});

await broker.start();

const session = broker.request({ text: 'Explain fenced ownership.' });
try {
  for await (const chunk of session) {
    console.log(chunk.text);
  }
  console.log(await session.result);
} finally {
  unsubscribe();
  await broker.stop();
}
```

The deterministic adapter makes lifecycle behavior reproducible. Replace it with an application adapter for a real runtime; see [adapter integrations](docs/integrations.md).

## Session semantics

| Concern                  | Alpha contract                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Ownership                | One Web Lock holder owns the adapter; peers do not initialize it                                   |
| Fencing                  | Every owner attempt carries a monotonically increasing epoch                                       |
| Streaming                | Chunks are ordered and deduplicated inside the current attempt                                     |
| Takeover                 | Pending work can restart on a newer owner; observe `retry` and replace partial presentation        |
| Terminal state           | A client session accepts one completion or typed failure                                           |
| Provider execution       | At-least-once across takeover; adapters with external side effects need their own idempotency key  |
| Admission                | Queue capacity is fixed by validated configuration; excess work fails with `BACKPRESSURE`          |
| Privacy-safe diagnostics | Built-in telemetry types expose lifecycle metadata, never request payloads or generated chunk data |

## Browser requirements

Serve from HTTPS, or loopback for development. The alpha requires Web Locks, BroadcastChannel, local storage, and cryptographic UUID support in the same storage partition.

The multi-page suite is locally verified with Playwright 1.61.1 against Chromium 149.0.7827.55, Firefox 151.0, and WebKit 26.5. Each engine exercises one-owner convergence, peer streaming, cancellation, backpressure, and owner takeover.

## Development

Requires Node.js 24 or newer and pnpm 11.13.0.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open `http://127.0.0.1:4173`, then use **Open sibling tab** to build a visible cluster.

Run the complete local quality gate:

```bash
corepack pnpm check
corepack pnpm package:smoke
corepack pnpm test:browser
corepack pnpm run audit
```

## Evidence and boundaries

- [Delivery contract](docs/delivery-contract.md)
- [Architecture decision](docs/adr/0001-browser-broker.md)
- [Threat model](docs/threat-model.md)
- [Compatibility matrix](docs/compatibility.md)
- [Market and build-vs-buy review](docs/market-scan.md)
- [Operations runbook](docs/runbook.md)
- [Visual QA ledger](docs/visual-qa.md)

Cross-origin coordination, durable recovery after all pages close, mutually untrusted same-origin scripts, and exactly-once provider side effects are intentionally out of scope.

## License

Apache-2.0.
