# Security policy

## Supported versions

Only the latest published prerelease is supported during alpha development.

## Reporting

Use GitHub private vulnerability reporting for security-sensitive findings. Do not place prompts, model inputs, credentials, or other private data in a public issue.

## Security boundary

TabLoom coordinates contexts within one browser storage partition and origin. It is not an authorization boundary between untrusted scripts already executing on that origin.

## Current audit posture

The `0.4.0-alpha.1` release gate reports no known vulnerability in the current dependency graph. CI also runs the production dependency audit at the high-severity threshold for every change. This is point-in-time package-manager evidence, not a guarantee that a dependency will remain vulnerability-free.

The demo and preview servers bind to loopback for repository tests. Do not expose a development server to untrusted networks as a production deployment.
