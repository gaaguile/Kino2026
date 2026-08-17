import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';

interface KinoDraw {
  date: string;
  numbers: number[];
  drawNumber?: string;
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

    // Wait for results to appear (adjust selector if needed)
    await page.waitForSelector('body', { timeout: 15000 });

    // Optional: scroll down to load more results if the page uses infinite scroll
    await autoScroll(page);

    console.log('Extracting data...');

    const draws = await page.evaluate(() => {
      const results: { date: string; numbers: number[] }[] = [];

      // Try different possible structures
      // Strategy 1: Look for date headings + nearby numbers
      const dateElements = Array.from(
        document.querySelectorAll('h2, h3, .date, .draw-date, .result-date, strong')
      );

      dateElements.forEach((el) => {
        const dateText = el.textContent?.trim() || '';

        // Skip if it doesn't look like a date
        if (!dateText.match(/\d{4}|\b(January|February|March|April|May|June|July|August|September|October|November|December|Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre)\b/i)) {
          return;
        }

        // Get the next sibling or parent content that might contain numbers
        let container = el.parentElement || el;
        let numbersText = container.textContent || '';

        // Extract numbers between 1 and 25
        const matches = numbersText.match(/\b([1-9]|1[0-9]|2[0-5])\b/g);

        if (matches && matches.length >= 14) {
          const numbers = [...new Set(matches.map((n) => parseInt(n, 10)))]
            .filter((n) => n >= 1 && n <= 25)
            .slice(0, 14)
            .sort((a, b) => a - b);

          if (numbers.length === 14) {
            results.push({
              date: dateText,
              numbers,
            });
          }
        }
      });

      // Strategy 2: Fallback - look for any list of 14 numbers
      if (results.length === 0) {
        const allText = document.body.innerText;
        const lines = allText.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const numbersInLine = line.match(/\b([1-9]|1[0-9]|2[0-5])\b/g);

          if (numbersInLine && numbersInLine.length >= 14) {
            const numbers = [...new Set(numbersInLine.map((n) => parseInt(n, 10)))]
              .filter((n) => n >= 1 && n <= 25)
              .slice(0, 14)
              .sort((a, b) => a - b);

            if (numbers.length === 14) {
              // Try to find a nearby date
              const possibleDate = lines[i - 1] || lines[i - 2] || `Draw ${results.length + 1}`;
              results.push({
                date: possibleDate.trim(),
                numbers,
              });
            }
          }
        }
      }

      // Remove duplicates by date
      const unique = results.filter(
        (item, index, self) =>
          index === self.findIndex((t) => t.date === item.date)
      );

      return unique;
    });

    return draws;
  } catch (error) {
    console.error('Error during scraping:', error);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Helper: auto-scroll to load more content
async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
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
    xml += `    <date>${draw.date.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</date>\n`;
    xml += `    <numbers>${draw.numbers.join(',')}</numbers>\n`;
    xml += `  </draw>\n`;
  });
  xml += `</kinoHistory>`;

  fs.writeFileSync('kino-history.xml', xml, 'utf-8');
  console.log(`✅ Saved ${draws.length} draws → kino-history.xml`);
}

main();