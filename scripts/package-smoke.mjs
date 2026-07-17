import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'tabloom-package-'));
const consumerRoot = join(temporaryRoot, 'consumer');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

try {
  execFileSync(
    pnpmCommand,
    ['pack', '--pack-destination', temporaryRoot, '--silent'],
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
    npmCommand,
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
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

      assert.equal(typeof TabLoomBroker, 'function');
      assert.equal(typeof createBrowserBroker, 'function');
      assert.equal(typeof BrowserBroadcastTransport, 'function');
      assert.equal(AdapterSubpath, DeterministicInferenceAdapter);
      assert.equal(new DeterministicInferenceAdapter().descriptor.evidence, 'deterministic-simulation');
    `,
  );
  execFileSync(process.execPath, ['smoke.mjs'], {
    cwd: consumerRoot,
    stdio: 'pipe',
  });
  console.log(`Package smoke passed: ${archive}`);
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
