import ExcelJS from 'exceljs';
import * as path from 'path';
import { KinoDraw, formatSourceDate, writeHistory } from './history';

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
        if (!isValid) {
            console.warn(`Skipping workbook row ${rowNumber} (draw #${drawNumber}): invalid number set`);
            return;
        }

        draws.push({
            drawNumber,
            date: formatSourceDate(rawDate),
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
        throw new Error('No draws found in the xlsx file. Check the sheet structure.');
    }

    writeHistory(draws);
    console.log(`✅ Saved ${draws.length} draws → kino-history.json / kino-history.xml`);
}

main().catch((error: unknown) => {
    console.error('Build failed:', error);
    process.exitCode = 1;
});
