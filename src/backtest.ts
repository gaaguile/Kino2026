import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import { readHistory } from './history';

// One-time back analysis: for every draw from #1 on, how many of its numbers
// were among the 14 most and the 14 least frequent numbers *before* that draw
// (ranked on all earlier draws, ties to the lower number, as in notify).
// Writes to stats/: kino-backtest.json, kino-backtest.svg (matches over time),
// kino-backtest-distribution.svg (how many draws had each number of matches)
// and a PNG of each chart, since Discord does not preview SVG files.

const NUMBER_COUNT = 25;
const GROUP_SIZE = 14;
const FIRST_DRAW = 1;
const WINDOW = 100;
// Match counts shown in the distribution panel.
const DIST_FROM = 3;
const DIST_TO = 14;
const STATS_DIR = path.join(__dirname, '..', 'stats');
const JSON_OUT = path.join(STATS_DIR, 'kino-backtest.json');
const SVG_OUT = path.join(STATS_DIR, 'kino-backtest.svg');
const DIST_SVG_OUT = path.join(STATS_DIR, 'kino-backtest-distribution.svg');
const PNG_SCALE = 2;
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

const CSS = `
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
        .bar-most { fill: ${THEME.accent}; }
        .bar-least { fill: ${THEME.info}; }
        .chance { fill: none; stroke: ${THEME.ink}; stroke-width: 1.5; stroke-dasharray: 6 5; }
        .chance-dot { fill: ${THEME.ink}; stroke: ${THEME.surface}; stroke-width: 2; }
        .accent { fill: ${THEME.accent}; }
        .info { fill: ${THEME.info}; }`;

interface Distribution {
    draws: number;
    matches: number[];
    most: number[];
    least: number[];
    chance: number[];
}

// How many draws had each number of matches, against the chance
// (hypergeometric) distribution. Only 14-number draws: the 15-number draws of
// the early years have a different chance curve.
function distribution(rows: Row[]): Distribution {
    const era = rows.filter((row) => row.drawn === 14);
    const choose = (n: number, k: number) => {
        if (k < 0 || k > n) return 0;
        let result = 1;
        for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
        return result;
    };
    const matches = Array.from({ length: DIST_TO - DIST_FROM + 1 }, (_, i) => DIST_FROM + i);
    const total = choose(NUMBER_COUNT, GROUP_SIZE);
    const dist = {
        draws: era.length,
        matches,
        most: matches.map((m) => era.filter((row) => row.matchesMost === m).length),
        least: matches.map((m) => era.filter((row) => row.matchesLeast === m).length),
        chance: matches.map((m) => (era.length * choose(GROUP_SIZE, m) * choose(NUMBER_COUNT - GROUP_SIZE, 14 - m)) / total),
    };
    for (const [name, counts] of [['most', dist.most], ['least', dist.least]] as const) {
        const outside = era.length - counts.reduce((a, b) => a + b, 0);
        if (outside > 0) console.warn(`${outside} draw(s) of the ${name} group fall outside ${DIST_FROM}–${DIST_TO} matches.`);
    }
    return dist;
}

// Grouped bars (most / least frequent) per match count, with the chance
// distribution as a dashed line. Returns SVG for the panel.
function distributionPanel(dist: Distribution, top: number, height: number, margin: number, left: number, right: number): string {
    const high = Math.ceil(Math.max(...dist.most, ...dist.least, ...dist.chance) / 200) * 200;
    const y = (value: number) => top + height - (value / high) * height;
    const slot = (right - left) / dist.matches.length;
    const barWidth = Math.min(22, slot * 0.3);
    const gap = 3;
    const radius = 3;

    const ticks: number[] = [];
    for (let t = 0; t <= high; t += 200) ticks.push(t);
    const gridLines = ticks.map((t) => `
    <line x1="${margin}" y1="${y(t).toFixed(1)}" x2="${right}" y2="${y(t).toFixed(1)}" class="${t === 0 ? 'zero' : 'grid'}" />
    <text x="${margin}" y="${(y(t) - 6).toFixed(1)}" class="tick">${formatCount(t)}</text>`).join('');

    const bar = (x: number, count: number, cls: string, label: string) => {
        if (count === 0) return '';
        const topY = y(count);
        const r = Math.min(radius, y(0) - topY);
        const d = `M${x.toFixed(1)},${y(0)} V${(topY + r).toFixed(1)} Q${x.toFixed(1)},${topY.toFixed(1)} ${(x + r).toFixed(1)},${topY.toFixed(1)} `
            + `H${(x + barWidth - r).toFixed(1)} Q${(x + barWidth).toFixed(1)},${topY.toFixed(1)} ${(x + barWidth).toFixed(1)},${(topY + r).toFixed(1)} V${y(0)} Z`;
        return `<path d="${d}" class="${cls}"><title>${label}: ${formatCount(count)} draws</title></path>`;
    };

    const bars = dist.matches.map((m, i) => {
        const centre = left + slot * (i + 0.5);
        return bar(centre - gap / 2 - barWidth, dist.most[i], 'bar-most', `${m} matches, 14 most frequent`)
            + bar(centre + gap / 2, dist.least[i], 'bar-least', `${m} matches, 14 least frequent`)
            + `<text x="${centre.toFixed(1)}" y="${top + height + 20}" class="tick" text-anchor="middle">${m}</text>`;
    }).join('\n    ');

    const points = dist.matches.map((_, i) => ({ x: left + slot * (i + 0.5), y: y(dist.chance[i]) }));
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const dots = points.map((p, i) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" class="chance-dot"><title>${dist.matches[i]} matches by chance: ${dist.chance[i].toFixed(1)} draws</title></circle>`).join('');

    return `${gridLines}
    ${bars}
    <path d="${line}" class="chance" />
    ${dots}
    <text x="${right}" y="${top + height + 42}" class="note" text-anchor="end">Matches in the draw</text>`;
}

// The distribution on its own, with its own header and legend.
function distributionChart(dist: Distribution): string {
    const width = 1100;
    const margin = 48;
    const right = width - margin;
    const left = margin + 56;
    const top = 170;
    const panelHeight = 300;
    const legendY = top + panelHeight + 84;
    const height = legendY + 78;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <style>${CSS}
    </style>
    <rect width="100%" height="100%" fill="${THEME.surface}" />
    <rect x="${margin}" y="34" width="44" height="6" class="accent" />
    <text x="${right}" y="42" class="author" text-anchor="end">${AUTHOR}</text>
    <text x="${margin}" y="78" class="title">Matches per draw against chance</text>
    <text x="${margin}" y="104" class="subtitle">Draws with each number of matches with the 14 most and 14 least frequent numbers before them (${formatCount(dist.draws)} draws of 14 numbers)</text>
    <text x="${margin}" y="${top - 22}" class="panel">Number of draws</text>
    ${distributionPanel(dist, top, panelHeight, margin, left, right)}
    <rect x="${margin}" y="${legendY - 9}" width="10" height="10" class="accent" />
    <text x="${margin + 18}" y="${legendY}" class="note">14 most frequent</text>
    <rect x="${margin + 150}" y="${legendY - 9}" width="10" height="10" class="info" />
    <text x="${margin + 168}" y="${legendY}" class="note">14 least frequent</text>
    <line x1="${margin + 310}" y1="${legendY - 4}" x2="${margin + 340}" y2="${legendY - 4}" class="chance" />
    <text x="${margin + 350}" y="${legendY}" class="note">Expected by chance</text>
    <text x="${margin}" y="${legendY + 36}" class="footer">Groups are ranked on all draws before each draw; ties go to the lower number. Draws of the early years, with 15 numbers, are left out because chance differs for them.</text>
    </svg>`;
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
    <style>${CSS}
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

// Discord shows PNG images but not SVG, so each chart is also saved as a PNG.
async function renderPng(svgPath: string): Promise<string> {
    const pngPath = svgPath.replace(/\.svg$/, '.png');
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
    try {
        const page = await browser.newPage({ deviceScaleFactor: PNG_SCALE });
        await page.setContent(`<!doctype html><body style="margin:0;background:${THEME.surface}">${fs.readFileSync(svgPath, 'utf8')}</body>`);
        await page.locator('svg').screenshot({ path: pngPath });
    } finally {
        await browser.close();
    }
    return pngPath;
}

async function main() {
    const rows = run();
    if (rows.length === 0) throw new Error('No draws found in kino-history.json');

    const summary = buildSummary(rows);
    const dist = distribution(rows);
    const draws = rows.map(({ variance, ...row }) => row);
    fs.writeFileSync(JSON_OUT, JSON.stringify({ summary, distribution: dist, draws }), 'utf8');
    fs.writeFileSync(SVG_OUT, chart(rows, summary), 'utf8');
    fs.writeFileSync(DIST_SVG_OUT, distributionChart(dist), 'utf8');
    const pngs = [await renderPng(SVG_OUT), await renderPng(DIST_SVG_OUT)];

    console.log(`Draws analysed: #${summary.fromDraw}–#${summary.toDraw} (${formatCount(summary.draws)})`);
    console.log('14 most frequent: ', summary.mostFrequent);
    console.log('14 least frequent:', summary.leastFrequent);
    console.log(`JSON:  ${JSON_OUT}`);
    console.log(`Charts: ${SVG_OUT}, ${DIST_SVG_OUT}`);
    console.log(`PNGs:   ${pngs.join(', ')}`);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
