import { chromium, Browser, Frame } from 'playwright';
import { KinoDraw, formatSourceDate, readHistory, writeHistory } from './history';

const RESULTS_URL = 'https://www.loteria.cl/resultados/resultado-completo/?id=kino';
const DRAW_SELECT = 'select[aria-label="Sorteos"]';

interface ScrapedDraw {
    drawNumber: number;
    rawDate: string;
    numbers: number[];
}

interface DisplayedDraw {
    drawNumber: string | null;
    rawDate: string | null;
    numberLeaves: string[];
}

// Reads whichever draw the results iframe is currently showing.
function readDisplayedDraw(frame: Frame): Promise<DisplayedDraw> {
    return frame.evaluate((selector) => {
        const select = document.querySelector(selector) as HTMLSelectElement | null;
        const drawNumber = select?.value ?? null;

        const leaves = Array.from(document.querySelectorAll('body *'))
            .filter((el) => el.children.length === 0 && el.textContent?.trim())
            .map((el) => el.textContent!.trim());

        const fechaIndex = leaves.findIndex((t) => t === 'Fecha Sorteo:');
        const rawDate = fechaIndex >= 0 ? leaves[fechaIndex + 1] ?? null : null;

        // The main "Kino" numbers are the 14 leaves right before the
        // "Categoría Kino" table heading (other games/prizes follow after).
        const headingIndex = leaves.indexOf('Categoría Kino');
        const numberLeaves = headingIndex >= 14 ? leaves.slice(headingIndex - 14, headingIndex) : [];

        return { drawNumber, rawDate, numberLeaves };
    }, DRAW_SELECT);
}

function toScrapedDraw(info: DisplayedDraw, expectedDrawNumber: number): ScrapedDraw {
    if (!info.drawNumber || !info.rawDate || info.numberLeaves.length !== 14) {
        throw new Error(`Unexpected page structure: ${JSON.stringify(info)}`);
    }
    if (Number(info.drawNumber) !== expectedDrawNumber) {
        throw new Error(`Expected draw #${expectedDrawNumber} but the page shows #${info.drawNumber}`);
    }

    const numbers = info.numberLeaves.map(Number);
    if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 25) || new Set(numbers).size !== 14) {
        throw new Error(`Invalid numbers scraped for draw #${expectedDrawNumber}: ${JSON.stringify(info.numberLeaves)}`);
    }

    return {
        drawNumber: expectedDrawNumber,
        rawDate: info.rawDate,
        numbers: numbers.sort((a, b) => a - b),
    };
}

interface ScrapeResult {
    // Draw numbers offered by the site's "Sorteos" selector (recent draws only).
    available: number[];
    draws: ScrapedDraw[];
}

// The Kino results are rendered inside a same-origin-blocked iframe
// (rckino.loteria.cl); the main page's DOM never exposes them directly.
// Scrapes every draw the selector offers that `known` does not contain, so a
// skipped scheduled run is recovered on the next one.
async function scrapeMissingDraws(known: Set<number>): Promise<ScrapeResult> {
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

        await frame.waitForSelector(DRAW_SELECT, { timeout: 30000 });

        const optionValues = await frame.evaluate(
            (selector) => Array.from((document.querySelector(selector) as HTMLSelectElement).options).map((o) => o.value),
            DRAW_SELECT,
        );
        const available = optionValues.map(Number).filter((n) => Number.isInteger(n) && n > 0);
        if (available.length === 0) {
            throw new Error(`No draw numbers found in the selector: ${JSON.stringify(optionValues)}`);
        }

        const draws: ScrapedDraw[] = [];
        let displayed = await readDisplayedDraw(frame);

        for (const drawNumber of available.filter((n) => !known.has(n)).sort((a, b) => a - b)) {
            if (Number(displayed.drawNumber) !== drawNumber) {
                // Selecting a draw re-renders the iframe from an API call, not a
                // navigation; the date is the field that proves the new draw's
                // content has replaced the previous one.
                const previousDate = displayed.rawDate;
                await frame.selectOption(DRAW_SELECT, String(drawNumber));
                await frame.waitForFunction(
                    (previous) => {
                        const leaves = Array.from(document.querySelectorAll('body *'))
                            .filter((el) => el.children.length === 0 && el.textContent?.trim())
                            .map((el) => el.textContent!.trim());
                        const index = leaves.findIndex((t) => t === 'Fecha Sorteo:');
                        const date = index >= 0 ? leaves[index + 1] : undefined;
                        return Boolean(date) && date !== previous && leaves.includes('Categoría Kino');
                    },
                    previousDate,
                    { timeout: 30000 },
                );
                displayed = await readDisplayedDraw(frame);
            }
            draws.push(toScrapedDraw(displayed, drawNumber));
        }

        return { available, draws };
    } finally {
        if (browser) await browser.close();
    }
}

async function main() {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Checking ${RESULTS_URL} for new Kino draws...`);

    const history = readHistory();
    const known = new Set(history.map((d) => d.drawNumber));
    const lastKnown = Math.max(...known);

    const { available, draws: scraped } = await scrapeMissingDraws(known);
    const latestOnSite = Math.max(...available);
    console.log(`Latest draw on site: #${latestOnSite}. Latest recorded: #${lastKnown}.`);

    if (scraped.length === 0) {
        console.log('No new draws. Nothing to do.');
    } else {
        const added: KinoDraw[] = scraped.map((draw) => ({
            drawNumber: draw.drawNumber,
            date: formatSourceDate(draw.rawDate),
            numbers: draw.numbers,
        }));
        for (const draw of added) {
            console.log(`Draw #${draw.drawNumber} (${draw.date}) -> ${draw.numbers.join(',')}`);
        }

        writeHistory([...history, ...added]);
        console.log(`✅ Added ${added.length} draw(s) → kino-history.json / kino-history.xml`);
    }

    // Draws older than the selector's range cannot be recovered from this page.
    const oldestOnSite = Math.min(...available);
    const unrecoverable: number[] = [];
    for (let n = lastKnown + 1; n < oldestOnSite; n++) unrecoverable.push(n);
    if (unrecoverable.length > 0) {
        throw new Error(
            `History has a gap the site no longer lists: draws #${unrecoverable[0]}–#${unrecoverable[unrecoverable.length - 1]} ` +
                `(the site only goes back to #${oldestOnSite}). Add them to stats/estadisticas-kino.xlsx and run "npm run build-from-xlsx".`,
        );
    }
}

main().catch((error) => {
    console.error('Update failed:', error);
    process.exitCode = 1;
});
