import * as fs from 'fs';
import * as path from 'path';
import { readHistory } from './history';

const NUMBER_COUNT = 25;
// Kino draws 14 numbers, so the tables list the 14 most and least frequent.
const TABLE_ROWS = 14;
// Shown in the top-right corner of the chart.
const AUTHOR = 'Gabriel Tekken';
const OUTPUT_PATH = path.join(__dirname, '..', 'stats', 'kino-number-distribution.svg');

// Dark, terminal-style theme: one accent colour for the data, ink for all text.
const THEME = {
    surface: '#0b0d10',
    ink: '#f2f3f5',
    secondary: '#9ba1a9',
    muted: '#6b7078',
    rule: '#23272e',
    accent: '#fb8b1e',
    above: '#4af6c3',
    below: '#ff433d',
};

const formatCount = (value: number) => value.toLocaleString('en-US');

// Reads kino-history.json (not the workbook) so the chart includes every draw
// added by update-latest.
async function main() {
    const frequencies = Array(NUMBER_COUNT).fill(0) as number[];
    let draws = 0;
    let appearances = 0;
    let latest: { drawNumber: number; date: string } | null = null;

    for (const { drawNumber, date, numbers } of readHistory()) {
        // The game drew 15 numbers until ~2005 and 14 afterwards.
        if ((numbers.length !== 14 && numbers.length !== 15)
            || numbers.some((number) => !Number.isInteger(number) || number < 1 || number > NUMBER_COUNT)
            || new Set(numbers).size !== numbers.length) {
            throw new Error(`Invalid number set in kino-history.json draw #${drawNumber}`);
        }

        draws++;
        appearances += numbers.length;
        for (const number of numbers) frequencies[number - 1]++;
        if (!latest || drawNumber > latest.drawNumber) latest = { drawNumber, date };
    }

    if (draws === 0 || !latest) throw new Error('No draws found in kino-history.json');

    const expected = appearances / NUMBER_COUNT;
    const chiSquare = frequencies.reduce((sum, observed) => sum + (observed - expected) ** 2 / expected, 0);

    // Layout, top to bottom: header, bar chart, legend row, two tables, footer.
    const width = 1100;
    const margin = 48;
    const right = width - margin;
    const plot = { left: margin, top: 150, width: width - margin * 2, height: 360 };
    const baseline = plot.top + plot.height;
    const legendY = baseline + 62;
    const table = { top: baseline + 130, rowHeight: 26, width: 482, gap: 40 };
    const firstRowY = table.top + 78;
    const footerY = firstRowY + (TABLE_ROWS - 1) * table.rowHeight + 46;
    const height = footerY + 28;

    const maximum = Math.ceil(Math.max(...frequencies, expected) / 500) * 500;
    const y = (value: number) => baseline - (value / maximum) * plot.height;

    // Grid labels sit above their line in a gutter left of the bars.
    const gutter = 56;
    const slot = (plot.width - gutter) / NUMBER_COUNT;
    const barWidth = slot * 0.7;
    const grid = Array.from({ length: maximum / 500 + 1 }, (_, index) => index * 500);

    const gridLines = grid.map((value) => `
        <line x1="${plot.left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" class="${value === 0 ? 'baseline' : 'grid'}" />
        <text x="${plot.left}" y="${y(value) - 7}" class="tick">${formatCount(value)}</text>`).join('');

    const bars = frequencies.map((value, index) => {
        const x = plot.left + gutter + index * slot + (slot - barWidth) / 2;
        const top = y(value);
        const radius = 3;
        const outline = `M${x.toFixed(1)},${baseline} V${(top + radius).toFixed(1)} Q${x.toFixed(1)},${top.toFixed(1)} ${(x + radius).toFixed(1)},${top.toFixed(1)} `
            + `H${(x + barWidth - radius).toFixed(1)} Q${(x + barWidth).toFixed(1)},${top.toFixed(1)} ${(x + barWidth).toFixed(1)},${(top + radius).toFixed(1)} V${baseline} Z`;
        return `<path d="${outline}" class="bar"><title>Number ${index + 1}: ${formatCount(value)} appearances</title></path>
        <text x="${(x + barWidth / 2).toFixed(1)}" y="${baseline + 22}" class="tick" text-anchor="middle">${index + 1}</text>`;
    }).join('');

    // Ranking tables below the chart. Ties are broken by the lower number.
    const ranked = frequencies.map((count, index) => ({ number: index + 1, count }));
    const mostFrequent = [...ranked].sort((a, b) => b.count - a.count || a.number - b.number).slice(0, TABLE_ROWS);
    const leastFrequent = [...ranked].sort((a, b) => a.count - b.count || a.number - b.number).slice(0, TABLE_ROWS);

    const renderTable = (title: string, markerClass: string, rows: { number: number; count: number }[], left: number) => {
        const columns = { rank: left, number: left + 86, count: left + 240, delta: left + 358, share: left + table.width };
        const headerY = table.top + 44;
        const body = rows.map((row, index) => {
            const rowY = firstRowY + index * table.rowHeight;
            const delta = row.count - expected;
            const sign = delta >= 0 ? '+' : '−';
            // Direction marker: the colour carries no information the sign does not.
            const markerX = columns.delta + 8;
            const marker = delta >= 0
                ? `<path d="M${markerX},${rowY - 2} l5,-8 l5,8 Z" class="above" />`
                : `<path d="M${markerX},${rowY - 10} l5,8 l5,-8 Z" class="below" />`;
            return `
        <text x="${columns.rank}" y="${rowY}" class="td dim">${index + 1}</text>
        <text x="${columns.number}" y="${rowY}" class="td number">${row.number}</text>
        <text x="${columns.count}" y="${rowY}" class="td" text-anchor="end">${formatCount(row.count)}</text>
        <text x="${columns.delta}" y="${rowY}" class="td" text-anchor="end">${sign}${Math.abs(delta).toFixed(1)}</text>${marker}
        <text x="${columns.share}" y="${rowY}" class="td" text-anchor="end">${((row.count / draws) * 100).toFixed(2)}%</text>
        <line x1="${left}" y1="${rowY + 9}" x2="${left + table.width}" y2="${rowY + 9}" class="grid" />`;
        }).join('');

        return `
        <rect x="${left}" y="${table.top}" width="10" height="10" class="${markerClass}" />
        <text x="${left + 18}" y="${table.top + 10}" class="table-title">${title}</text>
        <text x="${columns.rank}" y="${headerY}" class="th">RANK</text>
        <text x="${columns.number}" y="${headerY}" class="th">NUMBER</text>
        <text x="${columns.count}" y="${headerY}" class="th" text-anchor="end">APPEARANCES</text>
        <text x="${columns.delta}" y="${headerY}" class="th" text-anchor="end">VS EXPECTED</text>
        <text x="${columns.share}" y="${headerY}" class="th" text-anchor="end">SHARE OF DRAWS</text>
        <line x1="${left}" y1="${headerY + 10}" x2="${left + table.width}" y2="${headerY + 10}" class="baseline" />${body}`;
    };

    const tables = renderTable(`${TABLE_ROWS} most frequent numbers`, 'above', mostFrequent, margin)
        + renderTable(`${TABLE_ROWS} least frequent numbers`, 'below', leastFrequent, margin + table.width + table.gap);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <style>
        text { fill: ${THEME.ink}; font-family: 'Helvetica Neue', Helvetica, Arial, 'Segoe UI', sans-serif; font-variant-numeric: tabular-nums; }
        .title { font-size: 30px; font-weight: 700; letter-spacing: -0.3px; }
        .subtitle { font-size: 15px; fill: ${THEME.secondary}; }
        .tick { font-size: 12px; fill: ${THEME.secondary}; }
        .note { font-size: 13px; fill: ${THEME.secondary}; }
        .author { font-size: 12px; fill: ${THEME.secondary}; letter-spacing: 0.6px; }
        .footer { font-size: 12px; fill: ${THEME.muted}; }
        .grid { stroke: ${THEME.rule}; stroke-width: 1; }
        .baseline { stroke: ${THEME.muted}; stroke-width: 1; }
        .bar { fill: ${THEME.accent}; }
        .fit { stroke: ${THEME.ink}; stroke-width: 1.5; stroke-dasharray: 6 5; }
        .accent { fill: ${THEME.accent}; }
        .above { fill: ${THEME.above}; }
        .below { fill: ${THEME.below}; }
        .table-title { font-size: 16px; font-weight: 700; }
        .th { font-size: 11px; fill: ${THEME.muted}; letter-spacing: 0.8px; }
        .td { font-size: 14px; }
        .dim { fill: ${THEME.secondary}; }
        .number { font-weight: 700; }
    </style>
    <rect width="100%" height="100%" fill="${THEME.surface}" />
    <rect x="${margin}" y="34" width="44" height="6" class="accent" />
    <text x="${right}" y="42" class="author" text-anchor="end">${AUTHOR}</text>
    <text x="${margin}" y="78" class="title">Kino number frequency</text>
    <text x="${margin}" y="104" class="subtitle">Appearances of each number, 1–${NUMBER_COUNT}, across ${formatCount(draws)} draws (${formatCount(appearances)} numbers drawn)</text>
    ${gridLines}
    ${bars}
    <line x1="${plot.left + gutter}" y1="${y(expected)}" x2="${right}" y2="${y(expected)}" class="fit" />
    <line x1="${margin}" y1="${legendY - 4}" x2="${margin + 30}" y2="${legendY - 4}" class="fit" />
    <text x="${margin + 40}" y="${legendY}" class="note">Expected if every number were equally likely: ${expected.toLocaleString('en-US', { maximumFractionDigits: 2 })} appearances</text>
    <text x="${right}" y="${legendY}" class="note" text-anchor="end">Pearson χ² = ${chiSquare.toFixed(2)} (24 df)</text>
    <line x1="${margin}" y1="${legendY + 30}" x2="${right}" y2="${legendY + 30}" class="grid" />
    ${tables}
    <text x="${margin}" y="${footerY}" class="footer">Data through draw #${latest.drawNumber} (${latest.date}) · Vs expected: appearances above or below the equal-likelihood count · Share of draws: draws that included the number</text>
    </svg>`;

    fs.writeFileSync(OUTPUT_PATH, svg, 'utf8');
    console.log(`Draws: ${formatCount(draws)}`);
    console.log(`Number appearances: ${formatCount(appearances)}`);
    console.log(`Best-fit model: discrete uniform over 1–${NUMBER_COUNT}`);
    console.log(`Expected appearances per number: ${expected.toFixed(2)}`);
    console.log(`Pearson chi-square: ${chiSquare.toFixed(2)} (24 df)`);
    console.log(`Chart: ${OUTPUT_PATH}`);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
