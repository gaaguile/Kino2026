import { chromium, Browser, Page } from 'playwright';
import { readHistory } from './history';

// This source (lotterytexts.com) does not expose the official "sorteo" number,
// so it cannot feed kino-history directly. The script is a cross-check only:
// it compares the site's draws with the recorded history, by date, and never
// writes the history files. History is built by build-from-xlsx and extended
// by update-latest, both of which carry official draw numbers.

interface RawDraw {
  date: string;
  numbers: number[];
}

// Calendar-day key, independent of how each source spells the date.
function dayKey(date: string): string {
  const parsed = new Date(Date.parse(date));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Unrecognized date: "${date}"`);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
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

async function scrapeKinoWithPlaywright(): Promise<RawDraw[]> {
  let browser: Browser | null = null;

  try {
    // Launch browser (headless = true means no visible window)
    browser = await chromium.launch({
      headless: true,
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

    return Array.from(new Map(rawDraws.map((draw) => [dayKey(draw.date), draw])).values());
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function main() {
  console.log('Starting Playwright Kino scraper (cross-check, read-only)...\n');

  const scraped = await scrapeKinoWithPlaywright();
  if (scraped.length === 0) {
    throw new Error('No draws found. The website structure may have changed; inspect the page and update the selectors.');
  }

  const history = new Map(readHistory().map((draw) => [dayKey(draw.date), draw]));
  const mismatched: string[] = [];
  const missing: string[] = [];

  for (const draw of scraped) {
    const recorded = history.get(dayKey(draw.date));
    if (!recorded) {
      missing.push(`${draw.date} -> ${draw.numbers.join(',')}`);
    } else if (recorded.numbers.join(',') !== draw.numbers.join(',')) {
      mismatched.push(`#${recorded.drawNumber} ${draw.date}: history ${recorded.numbers.join(',')} vs site ${draw.numbers.join(',')}`);
    }
  }

  console.log(`Compared ${scraped.length} scraped draws against kino-history.json.`);
  console.log(`Matching: ${scraped.length - mismatched.length - missing.length}`);
  console.log(`Different numbers: ${mismatched.length}`);
  mismatched.forEach((line) => console.log(`  ${line}`));
  console.log(`On the site but not in history: ${missing.length}`);
  missing.forEach((line) => console.log(`  ${line}`));

  if (mismatched.length > 0 || missing.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('Scrape failed:', error);
  process.exitCode = 1;
});
