import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

const NUMBER_COUNT = 25;
const OUTPUT_PATH = path.join(__dirname, '..', 'stats', 'kino-number-distribution.svg');

async function main() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(__dirname, '..', 'stats', 'estadisticas-kino.xlsx'));

    const sheet = workbook.getWorksheet('Kino');
    if (!sheet) throw new Error('Sheet "Kino" not found in estadisticas-kino.xlsx');

    const frequencies = Array(NUMBER_COUNT).fill(0) as number[];
    let draws = 0;
    let appearances = 0;

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber < 8) return;
        const values = row.values as unknown[];
        if (typeof values[1] !== 'number') return;

        const numbers = (values.slice(3, 18) as unknown[])
            .filter((value): value is number => typeof value === 'number');
        if (numbers.length !== 14 && numbers.length !== 15) return;
        if (numbers.some((number) => !Number.isInteger(number) || number < 1 || number > NUMBER_COUNT)
            || new Set(numbers).size !== numbers.length) {
            throw new Error(`Invalid number set in workbook row ${rowNumber}`);
        }

        draws++;
        appearances += numbers.length;
        for (const number of numbers) frequencies[number - 1]++;
    });

    if (draws === 0) throw new Error('No valid draws found in the workbook');

    const expected = appearances / NUMBER_COUNT;
    const chiSquare = frequencies.reduce((sum, observed) => sum + (observed - expected) ** 2 / expected, 0);
    const width = 1100;
    const height = 650;
    const plot = { left: 90, top: 110, width: 950, height: 380 };
    const maximum = Math.ceil(Math.max(...frequencies, expected) / 500) * 500;
    const y = (value: number) => plot.top + plot.height - (value / maximum) * plot.height;
    const slot = plot.width / NUMBER_COUNT;
    const barWidth = slot * 0.68;
    const grid = Array.from({ length: maximum / 500 + 1 }, (_, index) => index * 500);

    const gridLines = grid.map((value) => `
        <line x1="${plot.left}" y1="${y(value)}" x2="${plot.left + plot.width}" y2="${y(value)}" class="grid" />
        <text x="${plot.left - 14}" y="${y(value) + 5}" class="tick" text-anchor="end">${value.toLocaleString('en-US')}</text>`).join('');
    const bars = frequencies.map((value, index) => {
        const x = plot.left + index * slot + (slot - barWidth) / 2;
        return `<rect x="${x.toFixed(1)}" y="${y(value).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(plot.top + plot.height - y(value)).toFixed(1)}" class="bar"><title>Number ${index + 1}: ${value.toLocaleString('en-US')} appearances</title></rect>
        <text x="${(x + barWidth / 2).toFixed(1)}" y="${plot.top + plot.height + 24}" class="tick" text-anchor="middle">${index + 1}</text>`;
    }).join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <style>
        text { fill: #243238; font-family: Georgia, 'Times New Roman', serif; }
        .title { font-size: 27px; font-weight: bold; }
        .subtitle { font-size: 15px; fill: #58666a; }
        .tick { font-size: 12px; fill: #58666a; }
        .axis-label { font-size: 14px; }
        .grid { stroke: #dce3df; stroke-width: 1; }
        .bar { fill: #43836f; }
        .fit { stroke: #bd663c; stroke-width: 3; stroke-dasharray: 8 6; }
    </style>
    <rect width="100%" height="100%" fill="#fbfaf6" />
    <text x="${plot.left}" y="43" class="title">Kino number frequency</text>
    <text x="${plot.left}" y="72" class="subtitle">${draws.toLocaleString('en-US')} draws · ${appearances.toLocaleString('en-US')} number appearances · values 1–${NUMBER_COUNT}</text>
    ${gridLines}
    <line x1="${plot.left}" y1="${y(expected)}" x2="${plot.left + plot.width}" y2="${y(expected)}" class="fit" />
    ${bars}
    <line x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${plot.top + plot.height}" stroke="#647174" />
    <line x1="${plot.left}" y1="${plot.top + plot.height}" x2="${plot.left + plot.width}" y2="${plot.top + plot.height}" stroke="#647174" />
    <text x="${plot.left + plot.width / 2}" y="550" class="axis-label" text-anchor="middle">Drawn number</text>
    <text x="25" y="${plot.top + plot.height / 2}" class="axis-label" text-anchor="middle" transform="rotate(-90 25 ${plot.top + plot.height / 2})">Appearances across all draws</text>
    <line x1="${plot.left + 10}" y1="592" x2="${plot.left + 42}" y2="592" class="fit" />
    <text x="${plot.left + 50}" y="597" class="subtitle">Discrete uniform fit: ${expected.toLocaleString('en-US', { maximumFractionDigits: 2 })} expected appearances per number</text>
    <text x="${plot.left + plot.width}" y="597" class="subtitle" text-anchor="end">Pearson χ² = ${chiSquare.toFixed(2)} (24 df)</text>
    </svg>`;

    fs.writeFileSync(OUTPUT_PATH, svg, 'utf8');
    console.log(`Draws: ${draws.toLocaleString('en-US')}`);
    console.log(`Number appearances: ${appearances.toLocaleString('en-US')}`);
    console.log(`Best-fit model: discrete uniform over 1–${NUMBER_COUNT}`);
    console.log(`Expected appearances per number: ${expected.toFixed(2)}`);
    console.log(`Pearson chi-square: ${chiSquare.toFixed(2)} (24 df)`);
    console.log(`Chart: ${OUTPUT_PATH}`);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});