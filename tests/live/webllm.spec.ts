import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const DEFAULT_MODEL_ID = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
const LIVE_ENABLED = process.env['TABLOOM_WEBLLM_LIVE'] === '1';
const MODEL_ID =
  process.env['TABLOOM_WEBLLM_MODEL']?.trim() || DEFAULT_MODEL_ID;

interface ObservedPage {
  readonly errors: string[];
  readonly page: Page;
}

test.describe('TabLoom WebLLM live evidence', () => {
  test.skip(
    !LIVE_ENABLED,
    'Set TABLOOM_WEBLLM_LIVE=1 to download and run the live model.',
  );

  test('serves a peer request from one provider runtime owner', async ({
    context,
  }, testInfo) => {
    const startedAt = Date.now();
    const cluster = await openCluster(
      context,
      namespace(testInfo.title),
      MODEL_ID,
    );

    await expect
      .poll(() => roles(cluster), { timeout: 600_000 })
      .toEqual(['leader', 'peer']);
    await Promise.all(
      cluster.map(async ({ page }) => {
        await expect(page.getByTestId('webgpu')).toHaveText('available');
        await expect(page.getByTestId('readiness')).toHaveText('ready', {
          timeout: 600_000,
        });
        await expect(page.getByTestId('evidence')).toHaveText(
          'provider-runtime',
        );
      }),
    );

    const ownerIds = await Promise.all(
      cluster.map(async ({ page }) =>
        page.getByTestId('owner-id').textContent(),
      ),
    );
    expect(ownerIds[0]).not.toBe('');
    expect(new Set(ownerIds).size).toBe(1);
    const progressEventCounts = await Promise.all(
      cluster.map(async ({ page }) => numberText(page, 'progress-event-count')),
    );
    expect(progressEventCounts.filter((count) => count > 0)).toHaveLength(1);

    const peer = await pageWithRole(cluster, 'peer');
    await peer.page
      .getByTestId('prompt')
      .fill('Respond with one short word confirming readiness.');
    await peer.page.getByTestId('send').click();
    await expect(peer.page.getByTestId('request-status')).toHaveText(
      'completed',
      { timeout: 180_000 },
    );
    await expect
      .poll(
        async () =>
          (await peer.page.getByTestId('output').textContent())?.trim()
            .length ?? 0,
        { timeout: 180_000 },
      )
      .toBeGreaterThan(0);
    await expect(peer.page.getByTestId('terminal-count')).toHaveText('1');
    await expect
      .poll(() => numberText(peer.page, 'usage-tokens'))
      .toBeGreaterThan(0);
    expect(await peer.page.getByTestId('output').textContent()).toBe(
      await peer.page.getByTestId('result-text').textContent(),
    );

    expect(cluster.flatMap((item) => item.errors)).toEqual([]);
    const owner = await pageWithRole(cluster, 'leader');
    await testInfo.attach('runtime-evidence.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            browserVersion: context.browser()?.version() ?? 'unknown',
            durationMs: Date.now() - startedAt,
            modelId: MODEL_ID,
            ownerProgress: await owner.page
              .getByTestId('progress')
              .textContent(),
            progressEventCounts,
            providerVersion: '0.2.84',
            terminalCount: await numberText(peer.page, 'terminal-count'),
            usageTokens: await numberText(peer.page, 'usage-tokens'),
            webgpu: await owner.page.getByTestId('webgpu').textContent(),
          },
          null,
          2,
        ),
      ),
      contentType: 'application/json',
    });
  });

  test('keeps a real WebLLM runtime alive in one SharedWorker', async ({
    context,
  }, testInfo) => {
    const startedAt = Date.now();
    const cluster = await openCluster(
      context,
      namespace(testInfo.title),
      MODEL_ID,
      'shared-worker',
    );

    await expect
      .poll(() => roles(cluster), { timeout: 600_000 })
      .toEqual(['peer', 'peer']);
    await Promise.all(
      cluster.map(async ({ page }) => {
        await expect(page.getByTestId('topology')).toHaveText('shared-worker');
        await expect(page.getByTestId('readiness')).toHaveText('ready', {
          timeout: 600_000,
        });
        await expect(page.getByTestId('evidence')).toHaveText(
          'provider-runtime',
        );
      }),
    );

    const ownerIds = await Promise.all(
      cluster.map(async ({ page }) =>
        page.getByTestId('owner-id').textContent(),
      ),
    );
    expect(ownerIds[0]).not.toBe('');
    expect(new Set(ownerIds).size).toBe(1);
    const progressEventCounts = await Promise.all(
      cluster.map(async ({ page }) => numberText(page, 'progress-event-count')),
    );
    expect(progressEventCounts).toEqual([0, 0]);

    const firstPeer = cluster[0];
    if (firstPeer === undefined) {
      throw new Error('The SharedWorker cluster did not open.');
    }
    await runPrompt(firstPeer);
    await firstPeer.page.close();

    const survivingPeer = cluster[1];
    if (survivingPeer === undefined) {
      throw new Error('The surviving SharedWorker peer was not found.');
    }
    await expect(survivingPeer.page.getByTestId('readiness')).toHaveText(
      'ready',
    );
    await runPrompt(survivingPeer);

    expect(cluster.flatMap((item) => item.errors)).toEqual([]);
    await testInfo.attach('shared-worker-runtime-evidence.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            browserVersion: context.browser()?.version() ?? 'unknown',
            durationMs: Date.now() - startedAt,
            modelId: MODEL_ID,
            ownerId: ownerIds[0],
            progressEventCounts,
            providerVersion: '0.2.84',
            survivingPeerUsageTokens: await numberText(
              survivingPeer.page,
              'usage-tokens',
            ),
            topology: await survivingPeer.page
              .getByTestId('topology')
              .textContent(),
          },
          null,
          2,
        ),
      ),
      contentType: 'application/json',
    });
  });
});

async function openCluster(
  context: BrowserContext,
  brokerNamespace: string,
  modelId: string,
  topology: 'page-owner' | 'shared-worker' = 'page-owner',
): Promise<ObservedPage[]> {
  const cluster: ObservedPage[] = [];
  for (let index = 0; index < 2; index += 1) {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const search = new URLSearchParams({
      model: modelId,
      namespace: brokerNamespace,
      topology,
    });
    await page.goto(`/webllm.html?${search.toString()}`);
    await expect(page).toHaveTitle('TabLoom WebLLM live lab');
    cluster.push({ errors, page });
  }
  return cluster;
}

async function runPrompt(peer: ObservedPage): Promise<void> {
  await peer.page
    .getByTestId('prompt')
    .fill('Respond with one short word confirming readiness.');
  await peer.page.getByTestId('send').click();
  await expect(peer.page.getByTestId('request-status')).toHaveText(
    'completed',
    { timeout: 180_000 },
  );
  await expect
    .poll(
      async () =>
        (await peer.page.getByTestId('output').textContent())?.trim().length ??
        0,
      { timeout: 180_000 },
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() => numberText(peer.page, 'usage-tokens'))
    .toBeGreaterThan(0);
  expect(await peer.page.getByTestId('output').textContent()).toBe(
    await peer.page.getByTestId('result-text').textContent(),
  );
}

async function numberText(page: Page, testId: string): Promise<number> {
  return Number(await page.getByTestId(testId).textContent());
}

async function roles(cluster: readonly ObservedPage[]): Promise<string[]> {
  return (
    await Promise.all(
      cluster.map(async ({ page }) => page.getByTestId('role').textContent()),
    )
  )
    .map((role) => role ?? '')
    .sort();
}

async function pageWithRole(
  cluster: readonly ObservedPage[],
  role: 'leader' | 'peer',
): Promise<ObservedPage> {
  for (const item of cluster) {
    if ((await item.page.getByTestId('role').textContent()) === role) {
      return item;
    }
  }
  throw new Error(`No ${role} page was found.`);
}

function namespace(title: string): string {
  return `live-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .slice(0, 32)}-${Date.now()}`;
}
