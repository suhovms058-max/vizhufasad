import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get("VIZHUFASAD_QA_BASE", "http://127.0.0.1:3019").rstrip("/")
OUT = Path(__file__).resolve().parent / "qa"
OUT.mkdir(exist_ok=True)


def validate(page, name):
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    response = page.goto(f"{BASE}/partners", wait_until="networkidle")
    assert response and response.status == 200
    assert page.get_by_role("heading", name="Помогите клиенту увидеть фасад до покупки материалов").is_visible()
    assert page.get_by_role("heading", name="Образец партнёрского договора").is_visible()
    contact_link = page.get_by_role("link", name="Перейти к оформлению")
    assert contact_link.is_visible()
    assert contact_link.get_attribute("href") == "#partner-contact"
    contact_link.click()
    assert page.url.endswith("#partner-contact")
    assert page.get_by_role("heading", name="Заключить партнёрский договор").is_visible()
    assert page.get_by_role("link", name="Скачать DOCX для заполнения").is_visible()
    overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
    assert not overflow, f"horizontal overflow: {name}"
    page.screenshot(path=str(OUT / f"partners-{name}.png"), full_page=True)
    assert not errors, errors


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    desktop = browser.new_page(viewport={"width": 1440, "height": 1000})
    validate(desktop, "desktop")
    mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    validate(mobile, "mobile")
    request = p.request.new_context(base_url=BASE)
    for path in (
        "/documents/vizhufasad-partner-contract-template.pdf",
        "/documents/vizhufasad-partner-contract-template.docx",
    ):
        response = request.get(path)
        assert response.status == 200, (path, response.status)
        assert len(response.body()) > 20_000, (path, len(response.body()))
    request.dispose()
    browser.close()

print("PARTNER_PAGE_QA_OK")
