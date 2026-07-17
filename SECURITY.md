# Security policy

## Supported versions

Only the latest published prerelease is supported during alpha development.

## Reporting

Use GitHub private vulnerability reporting for security-sensitive findings. Do not place prompts, model inputs, credentials, or other private data in a public issue.

## Security boundary

TabLoom coordinates contexts within one browser storage partition and origin. It is not an authorization boundary between untrusted scripts already executing on that origin.

## Current audit posture

The production dependency audit reports no known vulnerability at the release threshold. The development graph currently carries one low-severity [esbuild advisory](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) affecting a Windows development server exposed to untrusted clients. The demo server is fixed to loopback, CI does not expose it publicly, and the dependency will be updated when the Vite toolchain supports the patched esbuild line.
