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

// 经典复刻冒烟：标题屏 → Enter → 过场「第 1 关」 → 战斗（canvas 持续重绘）→ Esc 暂停/恢复。
// 界面为 ScreensOverlay 动态生成的 DOM（无固定 id），用文案匹配；渲染为 Canvas 2D，无 WebGL 依赖。
async function runView(browser, name, viewport) {
  console.log(`[ui-smoke] ${name}: context`);
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(process.env.CI ? 15_000 : 12_000);
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('crash', () => errors.push('browser page crashed'));
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText('坦克大作战', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText('按 Enter 开始').waitFor({ state: 'visible' });
    console.log(`[ui-smoke] ${name}: title screen loaded`);

    const canvas = page.locator('#game-root canvas');
    assert(await canvas.count() === 1, `${name}: renderer canvas missing`);

    await page.keyboard.press('Enter');
    await page.getByText('第 1 关').waitFor({ state: 'visible' });
    console.log(`[ui-smoke] ${name}: stage intro shown`);

    // 过场约 2 秒后自动进入战斗，覆盖层隐藏
    await page.getByText('第 1 关').waitFor({ state: 'hidden', timeout: 8_000 });
    console.log(`[ui-smoke] ${name}: combat started`);

    // 战斗画面在持续重绘：间隔采样两次 canvas 内容应不同（敌人出生动画/水面动画必然变化）
    const sample = () => canvas.evaluate((el) => el.toDataURL());
    const first = await sample();
    await page.waitForTimeout(600);
    const second = await sample();
    assert(first !== second, `${name}: canvas is not repainting during combat`);

    // 玩家开火 + 移动一小段，验证输入通路无异常
    await page.keyboard.press('Space');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowUp');

    await page.keyboard.press('Escape');
    await page.getByText('暂停中').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.getByText('暂停中').waitFor({ state: 'hidden' });
    console.log(`[ui-smoke] ${name}: pause/resume ok`);

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
});
try {
  await runView(browser, 'desktop', { width: 1440, height: 900 });
  await runView(browser, 'compact', { width: 1024, height: 768 });
  console.log('UI smoke passed: title → stage intro → combat → pause on desktop and compact viewports');
} finally {
  await browser.close();
}
