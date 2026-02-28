import { test, expect, chromium } from '@playwright/test';
test('image preview screenshot', async () => {
    // Basic test to see network requests
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    page.on('response', response => {
        if(response.url().includes('/api/image')) {
            console.log('Image fetch status:', response.status(), response.url());
        }
    });

    await page.goto('http://127.0.0.1:5000');
    
    await page.fill('#inputFolder', 'C:\\\\Users\\\\ferna\\\\OneDrive\\\\Desktop\\\\+ai');
    await page.click('#btnBrowse');
    
    // give images time to load UI
    await page.waitForTimeout(2000);
    
    console.log(await page.content());
    
    await browser.close();
});

