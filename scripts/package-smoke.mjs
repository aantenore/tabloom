import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'tabloom-package-'));
const consumerRoot = join(temporaryRoot, 'consumer');
const starterRoot = join(temporaryRoot, 'vite-webllm-starter');
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
      import { createRuntimeFingerprint } from '@aantenore/tabloom/core';
      import { DeterministicInferenceAdapter as AdapterSubpath } from '@aantenore/tabloom/adapters';
      import { WebLlmInferenceAdapter } from '@aantenore/tabloom/adapters/webllm';
      import {
        createAdaptiveBrowserBroker,
        createSharedWorkerBrokerHost,
      } from '@aantenore/tabloom/shared-worker';

      assert.equal(typeof TabLoomBroker, 'function');
      assert.equal(typeof createBrowserBroker, 'function');
      assert.equal(typeof BrowserBroadcastTransport, 'function');
      assert.equal(typeof createRuntimeFingerprint, 'function');
      assert.equal(typeof createAdaptiveBrowserBroker, 'function');
      assert.equal(typeof createSharedWorkerBrokerHost, 'function');
      assert.equal(AdapterSubpath, DeterministicInferenceAdapter);
      assert.equal(new DeterministicInferenceAdapter().descriptor.evidence, 'deterministic-simulation');
      assert.equal(new WebLlmInferenceAdapter({ modelId: 'consumer-model' }).descriptor.evidence, 'provider-runtime');
    `,
  );
  execFileSync(process.execPath, ['smoke.mjs'], {
    cwd: consumerRoot,
    stdio: 'pipe',
  });

  writeFileSync(
    join(consumerRoot, 'worker-consumer.ts'),
    `
      import type { InferenceAdapter as RootInferenceAdapter } from '@aantenore/tabloom';
      import {
        createRuntimeFingerprint,
        type InferenceAdapter,
      } from '@aantenore/tabloom/core';
      import { DeterministicInferenceAdapter } from '@aantenore/tabloom/adapters';
      import {
        createSharedWorkerBrokerHost,
        type SharedWorkerScopeLike,
      } from '@aantenore/tabloom/shared-worker';

      declare const scope: SharedWorkerScopeLike;
      const adapter = new DeterministicInferenceAdapter();
      const coreAdapter: InferenceAdapter<unknown, unknown, unknown> = adapter;
      const rootAdapter: RootInferenceAdapter<unknown, unknown, unknown> = adapter;
      void coreAdapter;
      void rootAdapter;
      void createRuntimeFingerprint({ adapter: 'consumer', model: 'fixture' });
      createSharedWorkerBrokerHost({
        adapter,
        config: {
          namespace: 'package-worker',
          runtimeFingerprint: 'sha256:${'0'.repeat(64)}',
        },
        scope,
      });
    `,
  );
  writeFileSync(
    join(consumerRoot, 'tsconfig.worker.json'),
    JSON.stringify({
      compilerOptions: {
        exactOptionalPropertyTypes: true,
        lib: ['ES2022', 'WebWorker'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        target: 'ES2022',
        types: [],
        verbatimModuleSyntax: true,
      },
      files: ['worker-consumer.ts'],
    }),
  );
  execFileSync(
    process.execPath,
    [
      join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      'tsconfig.worker.json',
    ],
    { cwd: consumerRoot, stdio: 'pipe' },
  );

  writeFileSync(
    join(consumerRoot, 'page-owner-consumer.ts'),
    `
      import { DeterministicInferenceAdapter } from '@aantenore/tabloom/adapters';
      import { createAdaptiveBrowserBroker } from '@aantenore/tabloom/shared-worker';

      void createAdaptiveBrowserBroker({
        adapter: new DeterministicInferenceAdapter(),
        config: {
          namespace: 'package-page-owner',
          runtimeFingerprint: 'sha256:${'0'.repeat(64)}',
        },
        topology: { mode: 'page-owner' },
      });
    `,
  );
  writeFileSync(
    join(consumerRoot, 'tsconfig.page-owner.json'),
    JSON.stringify({
      compilerOptions: {
        exactOptionalPropertyTypes: true,
        lib: ['ES2022', 'DOM'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        target: 'ES2022',
        types: [],
        verbatimModuleSyntax: true,
      },
      files: ['page-owner-consumer.ts'],
    }),
  );
  execFileSync(
    process.execPath,
    [
      join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      'tsconfig.page-owner.json',
    ],
    { cwd: consumerRoot, stdio: 'pipe' },
  );

  writeFileSync(
    join(consumerRoot, 'index.html'),
    '<!doctype html><script type="module" src="/main.ts"></script>',
  );
  writeFileSync(
    join(consumerRoot, 'worker.ts'),
    `
      import { DeterministicInferenceAdapter } from '@aantenore/tabloom/adapters';
      import { createSharedWorkerBrokerHost } from '@aantenore/tabloom/shared-worker';

      createSharedWorkerBrokerHost({
        adapter: new DeterministicInferenceAdapter(),
        config: {
          namespace: 'package-vite',
          runtimeFingerprint: 'sha256:${'0'.repeat(64)}',
        },
        scope: globalThis,
      });
    `,
  );
  writeFileSync(
    join(consumerRoot, 'main.ts'),
    `
      import Host from './worker.ts?sharedworker';
      import { DeterministicInferenceAdapter } from '@aantenore/tabloom/adapters';
      import { createAdaptiveBrowserBroker } from '@aantenore/tabloom/shared-worker';

      const selection = await createAdaptiveBrowserBroker({
        adapter: new DeterministicInferenceAdapter(),
        config: {
          namespace: 'package-vite',
          runtimeFingerprint: 'sha256:${'0'.repeat(64)}',
        },
        topology: {
          mode: 'shared-worker',
          workerFactory: (options) => new Host({ name: options.name }),
        },
      });
      await selection.broker.start();
      await selection.broker.stop();
    `,
  );
  writeFileSync(
    join(consumerRoot, 'vite.config.mjs'),
    'export default { build: { outDir: "dist-vite" }, worker: { format: "es" } };',
  );
  execFileSync(
    process.execPath,
    [
      join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build',
      '--config',
      'vite.config.mjs',
    ],
    { cwd: consumerRoot, stdio: 'pipe' },
  );
  const viteAssets = listFiles(join(consumerRoot, 'dist-vite'));
  assert.ok(
    viteAssets.some((entry) => /worker[^/]*\.js$/u.test(entry)),
    'The tarball consumer build did not emit a SharedWorker chunk.',
  );
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

  const starterSource = join(repositoryRoot, 'examples', 'vite-webllm');
  cpSync(starterSource, starterRoot, {
    filter: (source) => {
      const segments = relative(starterSource, source).split(sep);
      return !segments.some((segment) =>
        ['dist', 'node_modules'].includes(segment),
      );
    },
    recursive: true,
  });
  assert.equal(
    existsSync(join(starterRoot, 'node_modules')),
    false,
    'The starter smoke must begin without copied dependencies.',
  );
  assertPublicPackageImports(starterRoot);
  const starterPackagePath = join(starterRoot, 'package.json');
  const starterPackage = parsePackageManifest(
    readFileSync(starterPackagePath, 'utf8'),
  );
  const repositoryPackage = parsePackageManifest(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
  );
  const releaseBoundary = starterPackage['tabloomRelease'];
  assert.ok(
    isRecord(releaseBoundary) &&
      typeof releaseBoundary['version'] === 'string' &&
      typeof releaseBoundary['integrity'] === 'string' &&
      typeof releaseBoundary['webLlmVersion'] === 'string',
    'The starter must declare its verified published TabLoom boundary.',
  );
  assert.match(
    releaseBoundary['version'],
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u,
  );
  assert.match(releaseBoundary['integrity'], /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
  assertPinnedRuntimeArtifacts(
    starterRoot,
    releaseBoundary['webLlmVersion'],
    releaseBoundary['version'],
    releaseBoundary['integrity'],
  );
  const expectedArchive =
    `https://github.com/aantenore/tabloom/releases/download/` +
    `v${releaseBoundary['version']}/tabloom-${releaseBoundary['version']}.tgz`;
  assert.equal(
    starterPackage.dependencies['@aantenore/tabloom'],
    expectedArchive,
    'The starter archive URL must match its verified published boundary.',
  );
  const starterLock = readFileSync(join(starterRoot, 'pnpm-lock.yaml'), 'utf8');
  assert.ok(
    starterLock.includes(expectedArchive) &&
      starterLock.includes(`integrity: ${releaseBoundary['integrity']}`),
    'The starter lock must bind the declared release URL and archive integrity.',
  );
  assert.equal(
    starterPackage.dependencies['@mlc-ai/web-llm'],
    releaseBoundary['webLlmVersion'],
    'The starter WebLLM version must match its published TabLoom boundary.',
  );
  assert.ok(
    starterLock.includes(
      `'@mlc-ai/web-llm': ${releaseBoundary['webLlmVersion']}`,
    ),
    'The starter lock must retain the published TabLoom WebLLM peer boundary.',
  );
  execFileSync(
    process.execPath,
    [pnpmCli, 'install', '--frozen-lockfile', '--ignore-scripts', '--silent'],
    { cwd: starterRoot, stdio: 'pipe' },
  );
  const remoteInstalledPackage = parsePackageManifest(
    readFileSync(
      join(
        starterRoot,
        'node_modules',
        '@aantenore',
        'tabloom',
        'package.json',
      ),
      'utf8',
    ),
  );
  assert.equal(
    remoteInstalledPackage.version,
    releaseBoundary['version'],
    'The frozen starter install must resolve the declared published boundary.',
  );
  execFileSync(
    process.execPath,
    [pnpmCli, 'audit', '--prod', '--audit-level=high'],
    { cwd: starterRoot, stdio: 'pipe' },
  );
  const localArchiveUrl = pathToFileURL(join(temporaryRoot, archive)).href;
  starterPackage.dependencies['@aantenore/tabloom'] = localArchiveUrl;
  writeFileSync(
    starterPackagePath,
    `${JSON.stringify(starterPackage, null, 2)}\n`,
  );
  execFileSync(
    process.execPath,
    [
      pnpmCli,
      'install',
      '--no-frozen-lockfile',
      '--ignore-scripts',
      '--silent',
    ],
    { cwd: starterRoot, stdio: 'pipe' },
  );
  assert.ok(
    readFileSync(join(starterRoot, 'pnpm-lock.yaml'), 'utf8').includes(
      localArchiveUrl,
    ),
    'The current-source build must resolve TabLoom from the freshly packed local archive.',
  );
  execFileSync(process.execPath, [pnpmCli, 'build'], {
    cwd: starterRoot,
    stdio: 'pipe',
  });
  const starterAssets = listFiles(join(starterRoot, 'dist'));
  assert.ok(
    starterAssets.some((entry) => /tabloom\.worker-[^/]+\.js$/u.test(entry)),
    'The packed-artifact starter build did not emit its SharedWorker chunk.',
  );
  const installedPackage = parsePackageManifest(
    readFileSync(
      join(
        starterRoot,
        'node_modules',
        '@aantenore',
        'tabloom',
        'package.json',
      ),
      'utf8',
    ),
  );
  assert.equal(installedPackage.version, repositoryPackage.version);

  console.log(`Package and verified starter smoke passed: ${archive}`);
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function listFiles(root) {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory()
      ? listFiles(path).map((child) => `${entry}/${child}`)
      : [entry];
  });
}

/**
 * @param {string} starter
 * @returns {void}
 */
function assertPublicPackageImports(starter) {
  for (const entry of listFiles(join(starter, 'src'))) {
    if (!entry.endsWith('.ts')) {
      continue;
    }
    const source = readFileSync(join(starter, 'src', entry), 'utf8');
    assert.doesNotMatch(
      source,
      /@aantenore\/tabloom\/(?:dist|src)|(?:\.\.\/)+src\//u,
      `${entry} imports an internal TabLoom module.`,
    );
  }
}

/**
 * @param {string} starter
 * @param {string} webLlmVersion
 * @param {string} tabloomVersion
 * @param {string} tabloomIntegrity
 * @returns {void}
 */
function assertPinnedRuntimeArtifacts(
  starter,
  webLlmVersion,
  tabloomVersion,
  tabloomIntegrity,
) {
  const source = readFileSync(
    join(starter, 'src', 'runtime-config.ts'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /(?:raw\.githubusercontent\.com|huggingface\.co)[^'\n]*\/main(?:\/|')/u,
    'The verified starter must not resolve model artifacts from a mutable main branch.',
  );
  assert.match(
    source,
    /huggingface\.co\/[^'\n]+\/resolve\/[0-9a-f]{40}\//u,
    'The model weights must resolve from an immutable Hugging Face revision.',
  );
  assert.match(
    source,
    /raw\.githubusercontent\.com\/[^'\n]+\/[0-9a-f]{40}\//u,
    'The model library must resolve from an immutable Git commit.',
  );
  assert.equal(
    (source.match(/'sha384-[A-Za-z0-9+/=]+'/gu) ?? []).length,
    3,
    'The model config, tokenizer, and model library require explicit SRI.',
  );
  assert.match(
    source,
    /integrityMode: 'error'/u,
    'Runtime artifact integrity must fail closed.',
  );
  assert.match(source, /onFailure: artifactPolicy\.integrityMode/u);
  assert.match(source, /cacheBackend: artifactPolicy\.cacheBackend/u);
  assert.match(
    source,
    /createRuntimeFingerprint\(\{\s*\.\.\.runtimeManifest,/u,
    'The runtime fingerprint must bind the immutable artifact manifest.',
  );
  assert.ok(
    source.includes(`adapter: 'webllm@${webLlmVersion}'`),
    'The fingerprinted adapter identity must match the published WebLLM boundary.',
  );
  assert.ok(
    source.includes(`controlPlane: 'tabloom@${tabloomVersion}'`) &&
      source.includes(`controlPlaneIntegrity:\n    '${tabloomIntegrity}'`),
    'The runtime fingerprint must bind the verified TabLoom release boundary.',
  );

  for (const entry of ['main.ts', 'tabloom.worker.ts']) {
    assert.match(
      readFileSync(join(starter, 'src', entry), 'utf8'),
      /engineConfig: runtime\.engineConfig/u,
      `${entry} must use the integrity-pinned WebLLM AppConfig.`,
    );
  }
}

/**
 * @typedef {{ dependencies: Record<string, string>, version: string, [key: string]: unknown }} PackageManifest
 */

/**
 * @param {string} source
 * @returns {PackageManifest}
 */
function parsePackageManifest(source) {
  const parsed = /** @type {unknown} */ (JSON.parse(source));
  assert.ok(isRecord(parsed), 'The package manifest must be an object.');
  assert.ok(
    isStringRecord(parsed['dependencies']),
    'The package manifest must have string dependencies.',
  );
  assert.equal(
    typeof parsed['version'],
    'string',
    'The package manifest must have a version.',
  );
  return /** @type {PackageManifest} */ (parsed);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, string>}
 */
function isStringRecord(value) {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}
