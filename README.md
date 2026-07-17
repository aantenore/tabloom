# TabLoom

TabLoom is a same-origin browser inference broker. It coordinates open tabs so one live tab owns the model runtime while peer tabs stream requests through it.

The project is an early alpha under active construction. Its release contract includes fenced leadership epochs, bounded admission, cancellation, timeouts, protocol negotiation, takeover, provider-neutral adapters, and privacy-safe telemetry.

The first runnable adapter is deterministic simulation. It exists to make coordination behavior repeatable; it is not GPU or model evidence.

## Why this exists

Browser model runtimes already solve local inference. Generic tab-election libraries already solve shared ownership. TabLoom focuses on the missing layer between them: inference-specific request lifecycle and correctness across owner changes.

See [the delivery contract](docs/delivery-contract.md), [market scan](docs/market-scan.md), and [architecture decision](docs/adr/0001-browser-broker.md).
