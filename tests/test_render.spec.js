import { test, expect, chromium } from '@playwright/test';
test('screenshot check', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    await page.goto('http://127.0.0.1:5000');
    
    await page.fill('#inputFolder', 'C:\\\\Users\\\\ferna\\\\OneDrive\\\\Desktop\\\\+ai');
    await page.click('#btnBrowse');
    
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: 'test_render.png' });
    
    await browser.close();
});

