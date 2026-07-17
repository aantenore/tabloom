import { expect, test, type BrowserContext, type Page } from '@playwright/test';

interface OpenedPage {
  readonly errors: string[];
  readonly page: Page;
}

test.describe('TabLoom browser conformance', () => {
  test('elects one owner and streams a peer request', async ({
    context,
  }, testInfo) => {
    const cluster = await openCluster(context, 3, namespace(testInfo.title), {
      delay: 10,
    });
    await expectRoles(cluster, 1, 2);
    const peer = await pageWithRole(cluster, 'peer');

    await peer.page.getByTestId('prompt').fill('one owner across three tabs');
    await peer.page.getByTestId('send').click();
    await expect(peer.page.getByTestId('request-status')).toHaveText(
      'completed',
    );
    await expect(peer.page.getByTestId('output')).toHaveText(
      'Woven once: one owner across three tabs',
    );
    await expect
      .poll(() => numberText(peer.page, 'chunk-count'))
      .toBeGreaterThan(0);
    await expect(peer.page.getByTestId('terminal-count')).toHaveText('1');

    const ownerIds = await Promise.all(
      cluster.map(async ({ page }) =>
        page.getByTestId('leader-id').textContent(),
      ),
    );
    expect(new Set(ownerIds).size).toBe(1);
    for (const item of cluster) {
      await expect(item.page.locator('[data-node-role="leader"]')).toHaveCount(
        1,
      );
      expect(item.errors).toEqual([]);
    }
  });

  test('cancels an active stream and drains the owner', async ({
    context,
  }, testInfo) => {
    const cluster = await openCluster(context, 2, namespace(testInfo.title), {
      delay: 80,
    });
    await expectRoles(cluster, 1, 1);
    const peer = await pageWithRole(cluster, 'peer');
    const owner = await pageWithRole(cluster, 'leader');

    await peer.page
      .getByTestId('prompt')
      .fill('cancel this deliberately long deterministic stream');
    await peer.page.getByTestId('send').click();
    await expect
      .poll(() => numberText(peer.page, 'chunk-count'))
      .toBeGreaterThan(0);
    await peer.page.getByTestId('cancel').click();
    await expect(peer.page.getByTestId('request-status')).toHaveText(
      'cancelled',
    );
    await expect(peer.page.getByTestId('terminal-count')).toHaveText('1');
    await expect(owner.page.getByTestId('queue-depth')).toHaveText('0');
    expect(cluster.flatMap((item) => item.errors)).toEqual([]);
  });

  test('rejects excess work with backpressure', async ({
    context,
  }, testInfo) => {
    const cluster = await openCluster(context, 3, namespace(testInfo.title), {
      capacity: 1,
      delay: 120,
    });
    await expectRoles(cluster, 1, 2);
    const peers = await pagesWithRole(cluster, 'peer');
    const owner = await pageWithRole(cluster, 'leader');

    await peers[0]!.page
      .getByTestId('prompt')
      .fill(
        'first request keeps the single owner slot occupied for long enough',
      );
    await peers[0]!.page.getByTestId('send').click();
    await expect(owner.page.getByTestId('queue-depth')).toHaveText('1');
    await peers[1]!.page
      .getByTestId('prompt')
      .fill('second request must not enter');
    await peers[1]!.page.getByTestId('send').click();

    await expect(peers[1]!.page.getByTestId('request-status')).toHaveText(
      'backpressure',
    );
    await expect(peers[1]!.page.getByTestId('terminal-count')).toHaveText('1');
    await peers[0]!.page.getByTestId('cancel').click();
    await expect(owner.page.getByTestId('queue-depth')).toHaveText('0');
    expect(cluster.flatMap((item) => item.errors)).toEqual([]);
  });

  test('takes over after owner loss without a duplicate terminal', async ({
    context,
  }, testInfo) => {
    const cluster = await openCluster(context, 3, namespace(testInfo.title), {
      delay: 55,
    });
    await expectRoles(cluster, 1, 2);
    const owner = await pageWithRole(cluster, 'leader');
    const requester = await pageWithRole(cluster, 'peer');
    const oldEpoch = await numberText(owner.page, 'epoch');

    await requester.page
      .getByTestId('prompt')
      .fill('continue this stream after the original owner disappears');
    await requester.page.getByTestId('send').click();
    await expect
      .poll(() => numberText(requester.page, 'chunk-count'))
      .toBeGreaterThan(0);
    await owner.page.close();

    const survivors = cluster.filter((item) => item !== owner);
    await expectRoles(survivors, 1, 1);
    await expect
      .poll(async () =>
        Math.max(
          ...(await Promise.all(
            survivors.map(({ page }) => numberText(page, 'epoch')),
          )),
        ),
      )
      .toBeGreaterThan(oldEpoch);
    await expect(requester.page.getByTestId('request-status')).toHaveText(
      'completed',
    );
    await expect(requester.page.getByTestId('terminal-count')).toHaveText('1');
    expect(survivors.flatMap((item) => item.errors)).toEqual([]);
  });
});

async function openCluster(
  context: BrowserContext,
  count: number,
  brokerNamespace: string,
  options: { capacity?: number; delay?: number } = {},
): Promise<OpenedPage[]> {
  const pages: OpenedPage[] = [];
  for (let index = 0; index < count; index += 1) {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const search = new URLSearchParams({
      capacity: String(options.capacity ?? 8),
      delay: String(options.delay ?? 20),
      namespace: brokerNamespace,
    });
    await page.goto(`/?${search.toString()}`);
    await expect(page).toHaveTitle('TabLoom broker lab');
    await expect(page.getByRole('heading', { name: 'Topology' })).toBeVisible();
    pages.push({ errors, page });
  }
  return pages;
}

async function expectRoles(
  cluster: readonly OpenedPage[],
  leaders: number,
  peers: number,
): Promise<void> {
  await expect
    .poll(async () => {
      const roles = await Promise.all(
        cluster.map(async ({ page }) => page.getByTestId('role').textContent()),
      );
      return {
        leaders: roles.filter((role) => role === 'leader').length,
        peers: roles.filter((role) => role === 'peer').length,
      };
    })
    .toEqual({ leaders, peers });
}

async function pageWithRole(
  cluster: readonly OpenedPage[],
  role: 'leader' | 'peer',
): Promise<OpenedPage> {
  await expectRoles(cluster, 1, cluster.length - 1);
  const matches = await pagesWithRole(cluster, role);
  const match = matches[0];
  if (match === undefined) {
    throw new Error(`No ${role} page was found.`);
  }
  return match;
}

async function pagesWithRole(
  cluster: readonly OpenedPage[],
  role: 'leader' | 'peer',
): Promise<OpenedPage[]> {
  const matches: OpenedPage[] = [];
  for (const item of cluster) {
    if ((await item.page.getByTestId('role').textContent()) === role) {
      matches.push(item);
    }
  }
  return matches;
}

async function numberText(page: Page, testId: string): Promise<number> {
  return Number(await page.getByTestId(testId).textContent());
}

function namespace(title: string): string {
  return `e2e-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .slice(0, 36)}-${Date.now()}`;
}
