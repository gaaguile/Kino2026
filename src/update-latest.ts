import { chromium, Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface KinoDraw {
    date: string;
    numbers: number[];
    drawNumber: number;
}

const RESULTS_URL = 'https://www.loteria.cl/resultados/resultado-completo/?id=kino';
const JSON_PATH = path.join(__dirname, '..', 'kino-history.json');
const XML_PATH = path.join(__dirname, '..', 'kino-history.xml');

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
});

// Source dates are "DD/MM/YYYY"; parsed as UTC to avoid local-timezone day shifts.
function parseSourceDate(raw: string): Date {
    const [day, month, year] = raw.split('/').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

interface ScrapedDraw {
    drawNumber: number;
    rawDate: string;
    numbers: number[];
}

// The Kino results are rendered inside a same-origin-blocked iframe
// (rckino.loteria.cl); the main page's DOM never exposes them directly.
async function scrapeLatestDraw(): Promise<ScrapedDraw> {
    let browser: Browser | null = null;

    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const context = await browser.newContext({
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 },
        });

        const page = await context.newPage();
        await page.goto(RESULTS_URL, { waitUntil: 'networkidle', timeout: 60000 });

        const resultFrame = await page.waitForSelector('iframe[src*="rckino.loteria.cl"]', {
            timeout: 30000,
        });
        const frame = await resultFrame.contentFrame();
        if (!frame) {
            throw new Error('Could not access the Kino results iframe.');
        }

        await frame.waitForSelector('select[aria-label="Sorteos"]', { timeout: 30000 });

        const info = await frame.evaluate(() => {
            const select = document.querySelector('select[aria-label="Sorteos"]') as HTMLSelectElement | null;
            const drawNumber = select?.value ?? null;

            const leaves = Array.from(document.querySelectorAll('body *'))
                .filter((el) => el.children.length === 0 && el.textContent?.trim())
                .map((el) => el.textContent!.trim());

            const fechaIndex = leaves.findIndex((t) => t === 'Fecha Sorteo:');
            const rawDate = fechaIndex >= 0 ? leaves[fechaIndex + 1] : null;

            // The main "Kino" numbers are the 14 leaves right before the
            // "Categoría Kino" table heading (other games/prizes follow after).
            const headingIndex = leaves.indexOf('Categoría Kino');
            const numberLeaves = headingIndex >= 0 ? leaves.slice(headingIndex - 14, headingIndex) : [];

            return { drawNumber, rawDate, numberLeaves };
        });

        if (!info.drawNumber || !info.rawDate || info.numberLeaves.length !== 14) {
            throw new Error(`Unexpected page structure: ${JSON.stringify(info)}`);
        }

        const numbers = info.numberLeaves.map(Number);
        if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 25) || new Set(numbers).size !== 14) {
            throw new Error(`Invalid numbers scraped: ${JSON.stringify(info.numberLeaves)}`);
        }

        return {
            drawNumber: Number(info.drawNumber),
            rawDate: info.rawDate,
            numbers: numbers.sort((a, b) => a - b),
        };
    } finally {
        if (browser) await browser.close();
    }
}

function writeHistory(draws: KinoDraw[]): void {
    fs.writeFileSync(JSON_PATH, JSON.stringify(draws, null, 2), 'utf-8');

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<kinoHistory>\n`;
    draws.forEach((draw) => {
        xml += `  <draw>\n`;
        xml += `    <drawNumber>${draw.drawNumber}</drawNumber>\n`;
        xml += `    <date>${draw.date.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</date>\n`;
        xml += `    <numbers>${draw.numbers.join(',')}</numbers>\n`;
        xml += `  </draw>\n`;
    });
    xml += `</kinoHistory>`;
    fs.writeFileSync(XML_PATH, xml, 'utf-8');
}

async function main() {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Checking ${RESULTS_URL} for the latest Kino draw...`);

    const scraped = await scrapeLatestDraw();
    console.log(`Latest draw on site: #${scraped.drawNumber} (${scraped.rawDate}) -> ${scraped.numbers.join(',')}`);
    const draws: KinoDraw[] = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
    const alreadyExists = draws.some((d) => d.drawNumber === scraped.drawNumber);

    if (alreadyExists) {
        console.log(`Draw #${scraped.drawNumber} is already recorded. Nothing to do.`);
        return;
    }

    draws.push({
        drawNumber: scraped.drawNumber,
        date: DATE_FORMATTER.format(parseSourceDate(scraped.rawDate)),
        numbers: scraped.numbers,
    });
    draws.sort((a, b) => a.drawNumber - b.drawNumber);

    writeHistory(draws);
    console.log(`✅ Added draw #${scraped.drawNumber} → kino-history.json / kino-history.xml`);
}

main().catch((error) => {
    console.error('Update failed:', error);
    process.exitCode = 1;
});
