import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const LIVE_ENABLED = process.env['TABLOOM_WEBLLM_LIVE'] === '1';

test.describe('verified Vite WebLLM starter', () => {
  test.skip(
    !LIVE_ENABLED,
    'Set TABLOOM_WEBLLM_LIVE=1 to download and run the pinned live model.',
  );

  test('loads pinned artifacts and completes through the selected owner', async ({
    context,
  }, testInfo) => {
    const errors: string[] = [];
    const first = await openStarter(context, errors);
    await expect(first).toHaveTitle('TabLoom WebLLM starter');
    await expect(first.locator('[data-field="topology"]')).not.toHaveText(
      'starting',
      { timeout: 30_000 },
    );

    const topology = await first
      .locator('[data-field="topology"]')
      .textContent();
    const peer =
      topology === 'page-owner' ? await openStarter(context, errors) : first;
    await expect(peer.locator('[data-field="readiness"]')).toHaveText('ready', {
      timeout: 600_000,
    });
    await expect(peer.locator('[data-field="submit"]')).toBeEnabled();

    await peer.locator('[data-field="prompt"]').fill('Return only: ready');
    await peer.locator('[data-field="submit"]').click();
    const status = peer.locator('[data-field="status"]');
    await expect(status).toHaveText('Completed locally.', {
      timeout: 180_000,
    });
    await peer.waitForTimeout(1_500);
    await expect(status).toHaveText('Completed locally.');
    await expect(status).not.toHaveClass(/error/u);
    await expect
      .poll(
        async () =>
          (await peer.locator('[data-field="output"]').textContent())?.trim()
            .length ?? 0,
      )
      .toBeGreaterThan(0);
    expect(errors).toEqual([]);

    await testInfo.attach('starter-runtime-evidence.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            browserVersion: context.browser()?.version() ?? 'unknown',
            modelId: await peer.locator('[data-field="model"]').textContent(),
            outputLength:
              (
                await peer.locator('[data-field="output"]').textContent()
              )?.trim().length ?? 0,
            role: await peer.locator('[data-field="role"]').textContent(),
            topology,
          },
          null,
          2,
        ),
      ),
      contentType: 'application/json',
    });
  });
});

async function openStarter(
  context: BrowserContext,
  errors: string[],
): Promise<Page> {
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  return page;
}
