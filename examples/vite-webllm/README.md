# TabLoom Vite + WebLLM starter

This is a clean consumer of the released TabLoom package. The application and
SharedWorker import only documented package exports; neither entry point reaches
into the TabLoom source tree.

## Pinned boundaries

| Boundary         | Pinned value                                         | Change rule                                              |
| ---------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| TabLoom          | Verified `0.3.0-alpha.2` GitHub release + lock SRI   | Update `tabloomRelease`, lock, and all consumer gates    |
| WebLLM           | `0.2.84`                                             | Update the adapter identity and re-run a real-model gate |
| Model            | `SmolLM2-360M-Instruct-q4f16_1-MLC` at one HF commit | Update the commit and SRI values; expect a new download  |
| Runtime identity | Runtime, immutable artifact URLs, SRI, and policies  | Never reuse a fingerprint after any behavior change      |
| Concurrency      | One generation per owner                             | Keep at one for the current WebLLM adapter               |

`package.json` names the independently verified published TabLoom boundary; it
is intentionally separate from the repository's next unreleased package
version. The exact application policy lives in `src/runtime-config.ts`. Model
weights are resolved at one immutable Hugging Face revision; the config,
tokenizer, and WASM library additionally fail closed on SRI mismatch. Both the
page and SharedWorker derive the same fingerprint from those artifact identities
and the runtime policy, so incompatible deployments fail negotiation instead of
silently sharing a runtime.

## Run

Requires Node.js 24+, pnpm 11.13.0, a WebGPU-capable browser, and HTTPS or a
loopback development origin.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:4173`. The first model load downloads provider assets and
can take time. The adaptive policy prefers a SharedWorker where its lifecycle is
portable; otherwise it selects the fenced page-owner path. In page-owner mode,
open the sibling page before submitting a prompt.

From the repository root, the opt-in live gate exercises the pinned URLs, SRI,
owner handshake, streaming path, and one real generation in Chrome/WebGPU:

```bash
TABLOOM_WEBLLM_LIVE=1 pnpm test:live:starter
```

## Alpha contract

- There is no automatic cloud fallback or provider routing.
- Prompts stay in the selected local browser owner unless you add an external
  adapter yourself.
- A request may execute again after owner takeover; external side effects need
  an application idempotency key.
- Built-in telemetry excludes request and generated content, but application
  logging remains your responsibility.
- The checked-in model and provider pair is the verified boundary, not a claim
  that every browser, GPU, model, or later provider version works.

From the repository root, `pnpm package:smoke` packs TabLoom, installs that fresh
archive into a temporary copy of this starter, and runs its production build.
