import { test, expect, chromium } from '@playwright/test';
test('streaming chunks UI update', async () => {
    // Basic test checking the UI updates dynamically
    const browser = await chromium.launch({ headless: false, slowMo: 50 });
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:5000');
    
    await page.fill('#inputFolder', 'f:\\PyApps\\imagedescripter\\testing');
    await page.click('#btnBrowse');
    
    // give images time to load UI
    await page.waitForTimeout(1000);
    
    await page.click('#btnStart');
    
    // check that the element updates...
    await page.waitForTimeout(4000);
    
    // find elements that should be streaming text into them
    let processingElementContent = await page.locator('.card-desc').first().textContent();
    console.log('Streamed text 1:', processingElementContent)
    
    await page.waitForTimeout(5000);
    
    let processingElementContent2 = await page.locator('.card-desc').first().textContent();
    console.log('Streamed text 2:', processingElementContent2)
    
    if(processingElementContent.length < processingElementContent2.length) {
        console.log('Successfully streaming content in UI');
    } else {
        console.log('Content does not appear to be streaming, or something failed.');
    }
    await browser.close();
});

