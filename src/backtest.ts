import * as fs from 'fs';
import * as path from 'path';
import { readHistory } from './history';

// One-time back analysis: for every draw from #1 on, how many of its numbers
// were among the 14 most and the 14 least frequent numbers *before* that draw
// (ranked on all earlier draws, ties to the lower number, as in notify).
// Writes stats/kino-backtest.json and stats/kino-backtest.svg.

const NUMBER_COUNT = 25;
const GROUP_SIZE = 14;
const FIRST_DRAW = 1;
const WINDOW = 100;
const JSON_OUT = path.join(__dirname, '..', 'stats', 'kino-backtest.json');
const SVG_OUT = path.join(__dirname, '..', 'stats', 'kino-backtest.svg');
const AUTHOR = 'Gabriel Tekken';

const THEME = {
    surface: '#0b0d10', ink: '#f2f3f5', secondary: '#9ba1a9', muted: '#6b7078', rule: '#23272e',
    accent: '#fb8b1e', info: '#5cc8ff',
};

interface Row {
    drawNumber: number;
    date: string;
    drawn: number;
    mostFrequent: number[];
    leastFrequent: number[];
    matchesMost: number;
    matchesLeast: number;
    // Matches expected by chance: drawn numbers x group size / numbers in play.
    expected: number;
    // Variance of the matches by chance (hypergeometric).
    variance: number;
}

const formatCount = (value: number) => value.toLocaleString('en-US');

function run(): Row[] {
    const draws = readHistory().sort((a, b) => a.drawNumber - b.drawNumber);
    const counts = Array(NUMBER_COUNT).fill(0) as number[];
    const rows: Row[] = [];

    for (const draw of draws) {
        if (draw.drawNumber >= FIRST_DRAW) {
            const ranked = counts.map((count, index) => ({ number: index + 1, count }));
            const pick = (order: 1 | -1) => [...ranked]
                .sort((a, b) => order * (a.count - b.count) || a.number - b.number)
                .slice(0, GROUP_SIZE)
                .map((entry) => entry.number)
                .sort((a, b) => a - b);
            const mostFrequent = pick(-1);
            const leastFrequent = pick(1);

            const n = draw.numbers.length;
            const p = GROUP_SIZE / NUMBER_COUNT;
            rows.push({
                drawNumber: draw.drawNumber,
                date: draw.date,
                drawn: n,
                mostFrequent,
                leastFrequent,
                matchesMost: draw.numbers.filter((number) => mostFrequent.includes(number)).length,
                matchesLeast: draw.numbers.filter((number) => leastFrequent.includes(number)).length,
                expected: n * p,
                variance: n * p * (1 - p) * ((NUMBER_COUNT - n) / (NUMBER_COUNT - 1)),
            });
        }
        for (const number of draw.numbers) counts[number - 1]++;
    }
    return rows;
}

function summarise(rows: Row[], key: 'matchesMost' | 'matchesLeast') {
    const total = rows.reduce((sum, row) => sum + row[key], 0);
    const expected = rows.reduce((sum, row) => sum + row.expected, 0);
    const variance = rows.reduce((sum, row) => sum + row.variance, 0);
    return {
        averageMatches: Number((total / rows.length).toFixed(4)),
        averageExpected: Number((expected / rows.length).toFixed(4)),
        excessMatches: Number((total - expected).toFixed(2)),
        // Treats draws as independent; |z| under about 2 is within chance.
        zScore: Number(((total - expected) / Math.sqrt(variance)).toFixed(2)),
    };
}

function rolling(values: number[], window: number): number[] {
    const out: number[] = [];
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= window) sum -= values[i - window];
        if (i >= window - 1) out.push(sum / window);
    }
    return out;
}

function chart(rows: Row[], summary: ReturnType<typeof buildSummary>): string {
    const width = 1100;
    const margin = 48;
    const right = width - margin;
    const gutter = 56;
    const left = margin + gutter;
    const plotWidth = right - left;
    const x = (index: number) => left + (index / (rows.length - 1)) * plotWidth;

    const panelHeight = 230;
    const top1 = 170;
    const top2 = top1 + panelHeight + 90;
    const legendY = top2 + panelHeight + 64;
    const height = legendY + 90;

    const path = (values: number[], offset: number, y: (value: number) => number) =>
        values.map((value, i) => `${i === 0 ? 'M' : 'L'}${x(i + offset).toFixed(1)},${y(value).toFixed(1)}`).join(' ');

    const axis = (top: number, y: (value: number) => number, ticks: number[], format: (v: number) => string) =>
        ticks.map((tick) => `
    <line x1="${margin}" y1="${y(tick).toFixed(1)}" x2="${right}" y2="${y(tick).toFixed(1)}" class="grid" />
    <text x="${margin}" y="${(y(tick) - 6).toFixed(1)}" class="tick">${format(tick)}</text>`).join('');

    const xAxis = (bottom: number) => {
        const labels: string[] = [];
        for (let n = 500; n < rows[rows.length - 1].drawNumber; n += 500) {
            const index = rows.findIndex((row) => row.drawNumber >= n);
            labels.push(`<text x="${x(index).toFixed(1)}" y="${bottom + 20}" class="tick" text-anchor="middle">#${n}</text>`);
        }
        labels.push(`<text x="${left}" y="${bottom + 20}" class="tick" text-anchor="start">#${rows[0].drawNumber}</text>`);
        labels.push(`<text x="${right}" y="${bottom + 20}" class="tick" text-anchor="end">#${rows[rows.length - 1].drawNumber}</text>`);
        return labels.join('');
    };

    // Panel 1: rolling average of matches per draw.
    const most = rolling(rows.map((row) => row.matchesMost), WINDOW);
    const least = rolling(rows.map((row) => row.matchesLeast), WINDOW);
    const expectedRolling = rolling(rows.map((row) => row.expected), WINDOW);
    const low1 = Math.floor(Math.min(...most, ...least, ...expectedRolling) * 2) / 2 - 0.5;
    const high1 = Math.ceil(Math.max(...most, ...least, ...expectedRolling) * 2) / 2 + 0.5;
    const y1 = (value: number) => top1 + panelHeight - ((value - low1) / (high1 - low1)) * panelHeight;
    const ticks1: number[] = [];
    for (let t = low1; t <= high1 + 1e-9; t += 0.5) ticks1.push(t);

    // Panel 2: cumulative matches above chance.
    const cumulative = (key: 'matchesMost' | 'matchesLeast') => {
        let total = 0;
        return rows.map((row) => (total += row[key] - row.expected));
    };
    const cumMost = cumulative('matchesMost');
    const cumLeast = cumulative('matchesLeast');
    const bound2 = Math.ceil(Math.max(...cumMost.map(Math.abs), ...cumLeast.map(Math.abs)) / 50) * 50 + 50;
    const y2 = (value: number) => top2 + panelHeight / 2 - (value / bound2) * (panelHeight / 2);
    const ticks2 = [-bound2, -bound2 / 2, 0, bound2 / 2, bound2];

    const sign = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;
    const line = (label: string, s: ReturnType<typeof summarise>) =>
        `${label}: ${s.averageMatches.toFixed(2)} matches per draw vs ${s.averageExpected.toFixed(2)} expected (${sign(s.excessMatches)} in total, z = ${s.zScore.toFixed(2)})`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <style>
        text { fill: ${THEME.ink}; font-family: 'Helvetica Neue', Helvetica, Arial, 'Segoe UI', sans-serif; font-variant-numeric: tabular-nums; }
        .title { font-size: 30px; font-weight: 700; letter-spacing: -0.3px; }
        .subtitle { font-size: 15px; fill: ${THEME.secondary}; }
        .panel { font-size: 14px; font-weight: 700; }
        .tick { font-size: 12px; fill: ${THEME.secondary}; }
        .note { font-size: 13px; fill: ${THEME.secondary}; }
        .author { font-size: 12px; fill: ${THEME.secondary}; letter-spacing: 0.6px; }
        .footer { font-size: 12px; fill: ${THEME.muted}; }
        .grid { stroke: ${THEME.rule}; stroke-width: 1; }
        .zero { stroke: ${THEME.muted}; stroke-width: 1; }
        .series { fill: none; stroke-width: 2; stroke-linejoin: round; }
        .most { stroke: ${THEME.accent}; }
        .least { stroke: ${THEME.info}; }
        .chance { fill: none; stroke: ${THEME.ink}; stroke-width: 1.5; stroke-dasharray: 6 5; }
        .accent { fill: ${THEME.accent}; }
        .info { fill: ${THEME.info}; }
    </style>
    <rect width="100%" height="100%" fill="${THEME.surface}" />
    <rect x="${margin}" y="34" width="44" height="6" class="accent" />
    <text x="${right}" y="42" class="author" text-anchor="end">${AUTHOR}</text>
    <text x="${margin}" y="78" class="title">Back analysis: most and least frequent numbers</text>
    <text x="${margin}" y="104" class="subtitle">Matches of every draw #${rows[0].drawNumber}–#${rows[rows.length - 1].drawNumber} with the 14 most and 14 least frequent numbers before it (${formatCount(rows.length)} draws)</text>

    <text x="${margin}" y="${top1 - 22}" class="panel">Matches per draw, ${WINDOW}-draw average</text>
    ${axis(top1, y1, ticks1, (v) => v.toFixed(1))}
    <path d="${path(expectedRolling, WINDOW - 1, y1)}" class="chance" />
    <path d="${path(least, WINDOW - 1, y1)}" class="series least" />
    <path d="${path(most, WINDOW - 1, y1)}" class="series most" />
    ${xAxis(top1 + panelHeight)}

    <text x="${margin}" y="${top2 - 22}" class="panel">Cumulative matches above chance</text>
    ${axis(top2, y2, ticks2, (v) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0'))}
    <line x1="${margin}" y1="${y2(0)}" x2="${right}" y2="${y2(0)}" class="zero" />
    <path d="${path(cumLeast, 0, y2)}" class="series least" />
    <path d="${path(cumMost, 0, y2)}" class="series most" />
    ${xAxis(top2 + panelHeight)}

    <rect x="${margin}" y="${legendY - 9}" width="10" height="10" class="accent" />
    <text x="${margin + 18}" y="${legendY}" class="note">${line('14 most frequent', summary.mostFrequent)}</text>
    <rect x="${margin}" y="${legendY + 17}" width="10" height="10" class="info" />
    <text x="${margin + 18}" y="${legendY + 26}" class="note">${line('14 least frequent', summary.leastFrequent)}</text>
    <line x1="${margin}" y1="${legendY + 47}" x2="${margin + 30}" y2="${legendY + 47}" class="chance" />
    <text x="${margin + 40}" y="${legendY + 51}" class="note">Matches expected by chance (14 numbers vs a group of 14 from 25 gives 7.84)</text>
    <text x="${margin}" y="${legendY + 80}" class="footer">Groups are ranked on all draws before each draw; ties go to the lower number. Early rankings rest on very few draws. z: total excess over its chance spread, draws treated as independent.</text>
    </svg>`;
}

function buildSummary(rows: Row[]) {
    return {
        fromDraw: rows[0].drawNumber,
        toDraw: rows[rows.length - 1].drawNumber,
        draws: rows.length,
        mostFrequent: summarise(rows, 'matchesMost'),
        leastFrequent: summarise(rows, 'matchesLeast'),
    };
}

function main() {
    const rows = run();
    if (rows.length === 0) throw new Error('No draws found in kino-history.json');

    const summary = buildSummary(rows);
    const draws = rows.map(({ variance, ...row }) => row);
    fs.writeFileSync(JSON_OUT, JSON.stringify({ summary, draws }), 'utf8');
    fs.writeFileSync(SVG_OUT, chart(rows, summary), 'utf8');

    console.log(`Draws analysed: #${summary.fromDraw}–#${summary.toDraw} (${formatCount(summary.draws)})`);
    console.log('14 most frequent: ', summary.mostFrequent);
    console.log('14 least frequent:', summary.leastFrequent);
    console.log(`JSON:  ${JSON_OUT}`);
    console.log(`Chart: ${SVG_OUT}`);
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
