import { test, expect, chromium } from '@playwright/test';

test('check console for network block', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Log all network requests
    page.on('request', request => {
      console.log('>>', request.method(), request.url());
    });
    
    // Log all network responses
    page.on('response', response => {
      console.log('<<', response.status(), response.url());
    });
    
    // Log all page errors
    page.on('pageerror', error => {
      console.log('Page error:', error.message);
    });

    console.log('Navigating...');
    await page.goto('http://127.0.0.1:5000');
    
    console.log('Filling folder...');
    await page.fill('#inputFolder', 'C:\\\\Users\\\\ferna\\\\OneDrive\\\\Desktop\\\\+ai');
    
    console.log('Clicking browse...');
    await page.click('#btnBrowse');
    
    console.log('Waiting for elements...');
    try {
        await page.waitForSelector('.card-image-wrapper img', { timeout: 10000 });
        console.log('Found images!');
    } catch(e) {
        console.log('Failed to find image elements in time');
    }
    
    await browser.close();
});

