import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(root, 'test-results');
fs.mkdirSync(results, { recursive: true });
const baseUrl = 'http://127.0.0.1:4317';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runView(browser, name, viewport, touch = false) {
  console.log(`[ui-smoke] ${name}: context`);
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: false });
  const page = await context.newPage();
  page.setDefaultTimeout(process.env.CI ? 12_000 : 5_000);
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('crash', () => errors.push('browser page crashed'));
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    console.log(`[ui-smoke] ${name}: menu loaded`);
    await page.locator('#main-menu h1').waitFor({ state: 'visible' });
    assert(await page.locator('.theme-option').count() === 6, `${name}: expected six themes`);
    assert((await page.locator('#daily-detail').innerText()).trim(), `${name}: daily rules missing`);

    // GitHub-hosted runners render WebGL through SwiftShader. Battery mode still
    // exercises the real 3D pipeline while keeping three sequential viewports
    // responsive enough for deterministic interaction assertions.
    if (process.env.CI) {
      await page.locator('#quality-select').selectOption('battery', { force: true });
      await page.waitForTimeout(250);
      assert(await page.locator('#quality-select').inputValue() === 'battery', `${name}: CI quality override failed`);
    }

    if (name === 'desktop') {
      for (const panel of ['settings']) {
        await page.locator(`[data-panel="${panel}"]`).click({ force: true });
        await page.locator('#side-panel').waitFor({ state: 'visible' });
        await page.locator('#panel-close').click({ force: true });
      }
      await page.locator('[data-theme="crystal-ocean"]').click({ force: true });
    } else if (name === 'ipad') {
      await page.locator('#team-select').selectOption('crew');
      assert((await page.locator('#control-hint').innerText()).includes('共享车组'), 'iPad: crew hint missing');
      await page.locator('#assist-select').selectOption('easy');
    }

    await page.locator('#start-button').click({ force: true });
    await page.locator('#workshop').waitFor({ state: 'visible' });
    console.log(`[ui-smoke] ${name}: workshop loaded`);
    assert(await page.locator('#workshop-items .module-card').count() > 0, `${name}: workshop parts missing`);
    const launch = page.locator('#workshop-launch');
    console.log(`[ui-smoke] ${name}: launch enabled=${await launch.isEnabled()} title=${await launch.getAttribute('title')}`);
    if (!await launch.isEnabled()) {
      const amphibious = page.locator('[data-module-id="amphibious"]');
      console.log(`[ui-smoke] ${name}: amphibious count=${await amphibious.count()} locked=${await amphibious.first().getAttribute('class')}`);
      await amphibious.first().click({ force: true, timeout: 3_000 });
      await page.waitForTimeout(100);
      console.log(`[ui-smoke] ${name}: route reopened=${await launch.isEnabled()}`);
      assert(await launch.isEnabled(), `${name}: compatible movement module did not open route`);
    }
    await launch.click({ force: true, timeout: 3_000 });
    await page.locator('#hud').waitFor({ state: 'visible' });
    await page.waitForTimeout(700);
    assert((await page.locator('#wave-label').innerText()).trim(), `${name}: combat HUD did not update`);
    console.log(`[ui-smoke] ${name}: combat active, ${await page.locator('#enemy-label').innerText()}`);

    if (touch) {
      await page.locator('#touch-controls').waitFor({ state: 'visible' });
      assert(await page.locator('.ability-button').count() === 4, `${name}: ability controls missing`);
      if (name === 'ipad') {
        assert(await page.locator('#p2-status').isVisible(), 'iPad: crew status hidden');
        assert((await page.locator('#p2-hp-text').innerText()).includes('共享炮塔'), 'iPad: gunner role missing');
      }
    } else {
      await page.keyboard.down('KeyW'); await page.waitForTimeout(250); await page.keyboard.up('KeyW');
      await page.locator('#pause-button').click({ force: true });
      await page.locator('#pause-overlay').waitFor({ state: 'visible' });
      await page.locator('#resume-button').click({ force: true });
      await page.locator('#pause-overlay').waitFor({ state: 'hidden' });
    }

    assert(errors.length === 0, `${name}: browser errors: ${errors.join(' | ')}`);
    console.log(`[ui-smoke] ${name}: passed`);
  } catch (error) {
    await page.screenshot({ path: path.join(results, `${name}-failure.png`), fullPage: true }).catch(() => undefined);
    const diagnostics = errors.length ? `\nBrowser diagnostics: ${errors.join(' | ')}` : '';
    if (error instanceof Error) error.message += diagnostics;
    throw error;
  } finally {
    await context.close();
  }
}

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  headless: true,
  executablePath: !process.env.CI && fs.existsSync(chrome) ? chrome : undefined,
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
try {
  await runView(browser, 'desktop', { width: 1440, height: 900 });
  await runView(browser, 'ipad', { width: 1180, height: 820 }, true);
  await runView(browser, 'phone', { width: 390, height: 844 }, true);
  console.log('UI smoke passed: menu → workshop → combat on desktop, iPad crew and phone');
} finally {
  await browser.close();
}
