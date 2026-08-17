import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';

interface RawDraw {
  date: string;
  numbers: number[];
}

interface KinoDraw {
  date: string;
  numbers: number[];
  drawNumber: number;
}

// The source site only exposes results per calendar year via #year_selection;
// each year must be selected and "Load All" clicked to reveal its full history.
async function scrapeYear(page: Page, year: string): Promise<RawDraw[]> {
  // The year switch and "Load All" button re-render via client-side JS, not
  // navigation, so networkidle resolves before the DOM updates; fixed delays
  // proved reliable instead.
  await page.selectOption('#year_selection', year);
  await page.waitForTimeout(1500);

  const loadAllButton = page.locator('text=/Load All Past Results/');
  if (await loadAllButton.count()) {
    await loadAllButton.first().click();
    await page.waitForTimeout(2500);
  }

  return page.evaluate(() => {
    const results: { date: string; numbers: number[] }[] = [];

    document.querySelectorAll('.custom-row.custom-row2').forEach((card) => {
      const date = card.querySelector('.lottery-date')?.textContent?.trim();
      const numbers = Array.from(card.querySelectorAll('.lottery-balls-below *'))
        .map((element) => Number(element.textContent?.trim()))
        .filter((number) => Number.isInteger(number) && number >= 1 && number <= 25);

      if (date && numbers.length === 14 && new Set(numbers).size === 14) {
        results.push({ date, numbers: numbers.sort((a, b) => a - b) });
      }
    });

    return results;
  });
}

async function scrapeKinoWithPlaywright(): Promise<KinoDraw[]> {
  let browser: Browser | null = null;

  try {
    // Launch browser (headless = true means no visible window)
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    const page: Page = await context.newPage();

    console.log('Navigating to the page...');

    // You can change this URL if needed
    const url = 'https://lotterytexts.com/chile/kino/past-results';
    await page.goto(url, {
      waitUntil: 'networkidle', // Wait until network is mostly idle
      timeout: 60000,
    });

    await page.waitForSelector('#year_selection', { timeout: 15000 });

    const years = await page
      .locator('#year_selection option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));

    const rawDraws: RawDraw[] = [];
    for (const year of years) {
      console.log(`Extracting data for ${year}...`);
      rawDraws.push(...(await scrapeYear(page, year)));
    }

    const uniqueByDate = Array.from(new Map(rawDraws.map((draw) => [draw.date, draw])).values());
    uniqueByDate.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    // No official "sorteo" number is exposed by the source, so number draws
    // sequentially in chronological order (oldest = 1).
    return uniqueByDate.map((draw, index) => ({
      ...draw,
      drawNumber: index + 1,
    }));
  } catch (error) {
    console.error('Error during scraping:', error);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function main() {
  console.log('Starting Playwright Kino scraper...\n');

  const draws = await scrapeKinoWithPlaywright();

  if (draws.length === 0) {
    console.log('No draws found. The website structure may have changed.');
    console.log('Tip: Open the page in a browser and inspect the HTML to update the selectors.');
    return;
  }

  // Save as JSON
  fs.writeFileSync('kino-history.json', JSON.stringify(draws, null, 2), 'utf-8');
  console.log(`✅ Saved ${draws.length} draws → kino-history.json`);

  // Also save as XML
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<kinoHistory>\n`;
  draws.forEach((draw) => {
    xml += `  <draw>\n`;
    xml += `    <drawNumber>${draw.drawNumber}</drawNumber>\n`;
    xml += `    <date>${draw.date.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</date>\n`;
    xml += `    <numbers>${draw.numbers.join(',')}</numbers>\n`;
    xml += `  </draw>\n`;
  });
  xml += `</kinoHistory>`;

  fs.writeFileSync('kino-history.xml', xml, 'utf-8');
  console.log(`✅ Saved ${draws.length} draws → kino-history.xml`);
}

main();