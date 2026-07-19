import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'tabloom-package-'));
const consumerRoot = join(temporaryRoot, 'consumer');
const pnpmCli = process.env.npm_execpath;
assert.ok(pnpmCli, 'Run this smoke through the package manager script.');

try {
  execFileSync(
    process.execPath,
    [pnpmCli, 'pack', '--pack-destination', temporaryRoot, '--silent'],
    { cwd: repositoryRoot, stdio: 'pipe' },
  );
  const archive = readdirSync(temporaryRoot).find((entry) =>
    entry.endsWith('.tgz'),
  );
  assert.ok(archive, 'pnpm pack did not create an archive');

  mkdirSync(consumerRoot);
  writeFileSync(
    join(consumerRoot, 'package.json'),
    JSON.stringify({
      name: 'tabloom-package-smoke',
      private: true,
      type: 'module',
    }),
  );
  execFileSync(
    process.execPath,
    [
      pnpmCli,
      'add',
      '--ignore-scripts',
      '--silent',
      join(temporaryRoot, archive),
    ],
    { cwd: consumerRoot, stdio: 'pipe' },
  );
  writeFileSync(
    join(consumerRoot, 'smoke.mjs'),
    `
      import assert from 'node:assert/strict';
      import {
        DeterministicInferenceAdapter,
        TabLoomBroker,
        createBrowserBroker,
      } from '@aantenore/tabloom';
      import { BrowserBroadcastTransport } from '@aantenore/tabloom/browser';
      import { DeterministicInferenceAdapter as AdapterSubpath } from '@aantenore/tabloom/adapters';
      import { WebLlmInferenceAdapter } from '@aantenore/tabloom/adapters/webllm';

      assert.equal(typeof TabLoomBroker, 'function');
      assert.equal(typeof createBrowserBroker, 'function');
      assert.equal(typeof BrowserBroadcastTransport, 'function');
      assert.equal(AdapterSubpath, DeterministicInferenceAdapter);
      assert.equal(new DeterministicInferenceAdapter().descriptor.evidence, 'deterministic-simulation');
      assert.equal(new WebLlmInferenceAdapter({ modelId: 'consumer-model' }).descriptor.evidence, 'provider-runtime');
    `,
  );
  execFileSync(process.execPath, ['smoke.mjs'], {
    cwd: consumerRoot,
    stdio: 'pipe',
  });
  const webLlmEntry = join(
    consumerRoot,
    'node_modules',
    '@aantenore',
    'tabloom',
    'dist',
    'webllm.js',
  );
  assert.ok(
    statSync(webLlmEntry).size < 64_000,
    'The optional WebLLM runtime was bundled into the adapter entry.',
  );
  assert.ok(
    /import\(["']@mlc-ai\/web-llm["']\)/u.test(
      readFileSync(webLlmEntry, 'utf8'),
    ),
    'The optional provider import must remain lazy.',
  );
  console.log(`Package smoke passed: ${archive}`);
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
