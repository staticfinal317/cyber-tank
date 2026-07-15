from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCREENSHOTS = ROOT / "test-results"
SCREENSHOTS.mkdir(exist_ok=True)


def run_view(browser, name, viewport, touch=False):
    context = browser.new_context(
        viewport=viewport,
        device_scale_factor=1,
        has_touch=touch,
        is_mobile=touch,
    )
    page = context.new_page()
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" or (message.type == "warning" and ("404" in message.text or "Failed" in message.text)) else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:4173", wait_until="networkidle")
    page.locator("#main-menu h1").wait_for(state="visible")
    assert page.locator(".theme-option").count() == 6
    page.screenshot(path=str(SCREENSHOTS / f"{name}-menu.png"), full_page=True)

    if name == "desktop":
        for panel in ["tech", "armory", "leaderboard", "replays"]:
            page.locator(f'[data-panel="{panel}"]').click()
            page.locator("#panel-content h2").wait_for(state="visible")
            page.screenshot(path=str(SCREENSHOTS / f"desktop-{panel}.png"), full_page=True)
            page.locator("#panel-close").click()
        page.locator('[data-theme="crystal-ocean"]').click()
    elif name == "ipad":
        page.locator("#team-select").select_option("coop")
        page.locator("#assist-select").select_option("easy")
    else:
        page.locator("#assist-select").select_option("easy")
    page.locator("#start-button").click()
    page.locator("#hud").wait_for(state="visible")
    page.wait_for_function("document.querySelector('#enemy-label').textContent !== '伙伴机 0'", timeout=8000)
    page.wait_for_timeout(800)
    if touch:
        page.locator("#touch-controls").wait_for(state="visible")
        assert page.locator(".ability-button").count() == 4
    else:
        page.keyboard.down("KeyW")
        page.wait_for_timeout(450)
        page.keyboard.up("KeyW")
        page.mouse.down()
        page.wait_for_timeout(300)
        page.mouse.up()
        page.locator("#pause-button").click()
        page.locator("#pause-overlay").wait_for(state="visible")
        page.locator("#resume-button").click()
    page.screenshot(path=str(SCREENSHOTS / f"{name}-game.png"), full_page=True)
    assert not errors, f"Browser errors in {name}: {errors}"
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        args=["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
    )
    run_view(browser, "desktop", {"width": 1440, "height": 900})
    run_view(browser, "ipad", {"width": 1180, "height": 820}, touch=True)
    run_view(browser, "phone", {"width": 390, "height": 844}, touch=True)
    browser.close()
    print("UI smoke tests passed: desktop + iPad + phone")
