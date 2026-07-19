import { expect, test, type BrowserContext, type Page } from '@playwright/test';

test.describe('TabLoom adaptive SharedWorker topology', () => {
  test('ships a responsive, dedicated lab layout', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto('/shared-worker.html');

    await expect(page.locator('.status-grid')).toHaveCSS('display', 'grid');
    await expect(page.locator('.control-panel')).toHaveCSS(
      'border-top-style',
      'solid',
    );
    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  });

  test('shares one runtime host and reconnects after the creator page closes', async ({
    browserName,
    context,
  }, testInfo) => {
    const pages = await openCluster(context, 3);
    await Promise.all(
      pages.map((page) =>
        expect(page.locator('#topology')).not.toHaveText('connecting'),
      ),
    );
    const selected = await Promise.all(
      pages.map((page) => page.locator('#topology').textContent()),
    );
    expect(new Set(selected).size).toBe(1);

    if (selected[0] === 'shared-worker') {
      await Promise.all(
        pages.map(async (page) => {
          await expect(page.locator('#role')).toHaveText('peer');
          await expect(page.locator('#readiness')).toHaveText('ready');
          await expect(page.locator('#compatibility')).toHaveText('compatible');
        }),
      );
      const leaderIds = await Promise.all(
        pages.map((page) => page.locator('#leader-id').textContent()),
      );
      expect(new Set(leaderIds).size).toBe(1);
      expect(leaderIds[0]).not.toBe('');
    } else {
      testInfo.annotations.push({
        description: `${browserName} selected the verified page-owner fallback.`,
        type: 'capability-fallback',
      });
      expect(selected[0]).toBe('page-owner');
      await waitForRoles(pages, 1, 2);
    }

    await pages[1]!.locator('#prompt').fill('three tabs');
    await pages[1]!.locator('#send').click();
    await expect(pages[1]!.locator('#request-status')).toHaveText('completed');
    await expect(pages[1]!.locator('#output')).toHaveText(
      'Woven once: three tabs',
    );

    if (selected[0] === 'shared-worker') {
      const leaderId = await pages[1]!.locator('#leader-id').textContent();
      await pages[0]!.close();
      await expect(pages[2]!.locator('#leader-id')).toHaveText(leaderId ?? '');
      await pages[2]!.locator('#prompt').fill('owner survived page close');
      await pages[2]!.locator('#send').click();
      await expect(pages[2]!.locator('#output')).toHaveText(
        'Woven once: owner survived page close',
      );
    }
  });

  test('falls back only for topology capability failure', async ({ page }) => {
    await page.goto('/shared-worker.html?forceFallback=1');
    await expect(page.locator('#topology')).toHaveText('page-owner');
    await expect(page.locator('#fallback')).toHaveText('TOPOLOGY_UNAVAILABLE');
    await expect(page.locator('#readiness')).toHaveText('ready');
  });

  test('refuses a fingerprint mismatch without fallback', async ({ page }) => {
    await page.goto('/shared-worker.html?mode=shared-worker&mismatch=1');
    await expect(page.locator('#topology')).toHaveText('unavailable');
    await expect(page.locator('#error')).toHaveText('RUNTIME_MISMATCH');
    await expect(page.locator('#request-status')).toHaveText('failed');
  });

  test('cancels a request across the worker port', async ({ page }) => {
    await page.goto('/shared-worker.html?mode=shared-worker');
    await expect(page.locator('#topology')).toHaveText('shared-worker');
    await expect(page.locator('#readiness')).toHaveText('ready');
    await page
      .locator('#prompt')
      .fill('cancel this stream after it starts '.repeat(40));
    await page.locator('#send').click();
    await expect(page.locator('#cancel')).toBeEnabled();
    await expect(page.locator('#output')).not.toHaveText('');
    await page.locator('#cancel').click();
    await expect(page.locator('#request-status')).toHaveText('failed');
    await expect(page.locator('#error')).toHaveText('CANCELLED');
  });

  test('enforces one admission budget across worker clients', async ({
    context,
  }) => {
    const pages = await openCluster(context, 5, '?mode=shared-worker');
    const holder = pages[0]!;
    const contenders = pages.slice(1);
    const work = 'bounded-work-'.repeat(512);
    await Promise.all(
      pages.map((page) =>
        expect(page.locator('#readiness')).toHaveText('ready'),
      ),
    );
    await holder.locator('#prompt').fill(`holder-${work}`);
    await Promise.all(
      contenders.map((page, index) =>
        page.locator('#prompt').fill(`contender-${index}-${work}`),
      ),
    );
    await holder.locator('#send').click();
    await expect(holder.locator('#output')).not.toHaveText('');
    await Promise.all(
      contenders.map((page) => page.locator('#send').dispatchEvent('click')),
    );
    await expect
      .poll(async () => {
        const errors = await Promise.all(
          pages.map((page) => page.locator('#error').textContent()),
        );
        return errors.filter((error) => error === 'BACKPRESSURE').length;
      })
      .toBe(1);
    await Promise.all(
      pages.map(async (page) => {
        const cancel = page.locator('#cancel');
        if (await cancel.isEnabled()) {
          await cancel.dispatchEvent('click');
        }
      }),
    );
    await Promise.all(
      pages.map((page) =>
        expect(page.locator('#request-status')).toHaveText(/completed|failed/u),
      ),
    );
    const errors = await Promise.all(
      pages.map((page) => page.locator('#error').textContent()),
    );
    expect(errors.filter((error) => error === 'BACKPRESSURE')).toHaveLength(1);
    expect(errors.filter((error) => error === 'CANCELLED')).toHaveLength(4);
  });
});

async function openCluster(
  context: BrowserContext,
  count: number,
  suffix = '',
): Promise<Page[]> {
  const pages: Page[] = [];
  for (let index = 0; index < count; index += 1) {
    const page = await context.newPage();
    await page.goto(`/shared-worker.html${suffix}`);
    await expect(page.locator('#topology')).not.toHaveText('connecting');
    pages.push(page);
  }
  return pages;
}

async function waitForRoles(
  pages: readonly Page[],
  leaders: number,
  peers: number,
): Promise<void> {
  await expect
    .poll(async () => {
      const roles = await Promise.all(
        pages.map((page) => page.locator('#role').textContent()),
      );
      return {
        leaders: roles.filter((role) => role === 'leader').length,
        peers: roles.filter((role) => role === 'peer').length,
      };
    })
    .toEqual({ leaders, peers });
}
