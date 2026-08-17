import ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

interface KinoDraw {
    date: string;
    numbers: number[];
    drawNumber: number;
}

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
});

// Source dates are "DD-MM-YYYY"; parsed as UTC to avoid local-timezone day shifts.
function parseSourceDate(raw: string): Date {
    const [day, month, year] = raw.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

async function buildFromXlsx(): Promise<KinoDraw[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(__dirname, '..', 'stats', 'estadisticas-kino.xlsx'));

    const sheet = workbook.getWorksheet('Kino');
    if (!sheet) {
        throw new Error('Sheet "Kino" not found in estadisticas-kino.xlsx');
    }

    const draws: KinoDraw[] = [];

    // Data rows start at row 8 (row 7 is the header: Draw, Date, DrawNumbers x15, ...).
    // The game drew 15 numbers until ~2005 and 14 numbers afterwards; the 15th
    // column is simply blank for modern rows.
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber < 8) return;

        const values = row.values as unknown[];
        const drawNumber = values[1];
        const rawDate = values[2];

        if (typeof drawNumber !== 'number' || typeof rawDate !== 'string') return;

        const numbers = (values.slice(3, 18) as unknown[])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 1 && value <= 25);

        const isValid = (numbers.length === 14 || numbers.length === 15) && new Set(numbers).size === numbers.length;
        if (!isValid) return;

        draws.push({
            drawNumber,
            date: DATE_FORMATTER.format(parseSourceDate(rawDate)),
            numbers: numbers.sort((a, b) => a - b),
        });
    });

    draws.sort((a, b) => a.drawNumber - b.drawNumber);
    return draws;
}

async function main() {
    console.log('Reading stats/estadisticas-kino.xlsx...');
    const draws = await buildFromXlsx();

    if (draws.length === 0) {
        console.log('No draws found in the xlsx file. Check the sheet structure.');
        return;
    }

    const jsonPath = path.join(__dirname, '..', 'kino-history.json');
    fs.writeFileSync(jsonPath, JSON.stringify(draws, null, 2), 'utf-8');
    console.log(`✅ Saved ${draws.length} draws → kino-history.json`);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<kinoHistory>\n`;
    draws.forEach((draw) => {
        xml += `  <draw>\n`;
        xml += `    <drawNumber>${draw.drawNumber}</drawNumber>\n`;
        xml += `    <date>${draw.date.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</date>\n`;
        xml += `    <numbers>${draw.numbers.join(',')}</numbers>\n`;
        xml += `  </draw>\n`;
    });
    xml += `</kinoHistory>`;

    const xmlPath = path.join(__dirname, '..', 'kino-history.xml');
    fs.writeFileSync(xmlPath, xml, 'utf-8');
    console.log(`✅ Saved ${draws.length} draws → kino-history.xml`);
}

main();
