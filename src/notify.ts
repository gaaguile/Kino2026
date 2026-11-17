import * as fs from 'fs';
import * as path from 'path';
import nodemailer from 'nodemailer';
import { KinoDraw, readHistory } from './history';

const ROOT = path.join(__dirname, '..');
const NUMBER_COUNT = 25;
// Kino draws 14 numbers, so the draw is compared with the 14 most and least frequent.
const GROUP_SIZE = 14;
// Draw number of the last draw an email was sent for.
const STATE_PATH = path.join(ROOT, 'dist', 'notified.txt');
const PAGE_URL = 'https://kino.gabrieltekken.com';

interface DrawReport {
    draw: KinoDraw;
    mostFrequent: number[];
    leastFrequent: number[];
    mostMatches: number[];
    leastMatches: number[];
}

// Compares a draw with the rankings as they stood before it, built from every
// earlier draw. Ties are broken by the lower number, as in the chart.
function reportFor(draw: KinoDraw, history: KinoDraw[]): DrawReport {
    const counts = Array(NUMBER_COUNT).fill(0) as number[];
    for (const earlier of history) {
        if (earlier.drawNumber >= draw.drawNumber) continue;
        for (const number of earlier.numbers) counts[number - 1]++;
    }

    const ranked = counts.map((count, index) => ({ number: index + 1, count }));
    const pick = (order: 1 | -1) => [...ranked]
        .sort((a, b) => order * (a.count - b.count) || a.number - b.number)
        .slice(0, GROUP_SIZE)
        .map((entry) => entry.number)
        .sort((a, b) => a - b);

    const mostFrequent = pick(-1);
    const leastFrequent = pick(1);
    return {
        draw,
        mostFrequent,
        leastFrequent,
        mostMatches: draw.numbers.filter((number) => mostFrequent.includes(number)),
        leastMatches: draw.numbers.filter((number) => leastFrequent.includes(number)),
    };
}

function subjectFor(reports: DrawReport[]): string {
    const last = reports[reports.length - 1];
    const summary = `${last.mostMatches.length} of the ${GROUP_SIZE} most frequent, ${last.leastMatches.length} of the ${GROUP_SIZE} least frequent`;
    return reports.length === 1
        ? `Kino #${last.draw.drawNumber}: ${summary}`
        : `Kino #${reports[0].draw.drawNumber}–#${last.draw.drawNumber}: latest draw matched ${summary}`;
}

function textFor(reports: DrawReport[]): string {
    // With 14 numbers drawn from 25, a group of 14 matches 14 × 14 / 25 on average.
    const byChance = (GROUP_SIZE * GROUP_SIZE / NUMBER_COUNT).toFixed(1);
    const list = (numbers: number[]) => (numbers.length > 0 ? numbers.join(', ') : 'none');

    const sections = reports.map(({ draw, mostFrequent, leastFrequent, mostMatches, leastMatches }) => [
        `Draw #${draw.drawNumber} — ${draw.date}`,
        `Numbers drawn: ${list(draw.numbers)}`,
        '',
        `${GROUP_SIZE} most frequent numbers: ${mostMatches.length} matches`,
        `  Matched: ${list(mostMatches)}`,
        `  The group: ${list(mostFrequent)}`,
        '',
        `${GROUP_SIZE} least frequent numbers: ${leastMatches.length} matches`,
        `  Matched: ${list(leastMatches)}`,
        `  The group: ${list(leastFrequent)}`,
    ].join('\n'));

    return [
        ...sections,
        `Both groups are ranked on the draws before this one. A group of ${GROUP_SIZE} matches ${byChance} numbers per draw by chance alone. `
            + `With ${NUMBER_COUNT} numbers in play, the two groups share ${GROUP_SIZE * 2 - NUMBER_COUNT} numbers.`,
        `Chart: ${PAGE_URL}`,
    ].join('\n\n');
}

// Discord message in the GT Terminal style: amber accent bar, uppercase labels,
// monospace table, green / red only for meaning and always with an arrow.
// Discord has no custom fonts or CSS; an "ansi" code block is the one place
// text colour works.
const ESC = '\u001b';
const ansi = {
    reset: `${ESC}[0m`,
    label: `${ESC}[0;30m`,
    amber: `${ESC}[1;33m`,
    up: `${ESC}[0;32m`,
    down: `${ESC}[0;31m`,
    text: `${ESC}[0;37m`,
};
// Charts from `npm run backtest` sent with every Discord message: the PNGs
// show inline, the SVGs are the originals to download. Missing files are skipped.
const ATTACHMENT_NAMES = [
    'kino-backtest.png',
    'kino-backtest-distribution.png',
    'kino-backtest.svg',
    'kino-backtest-distribution.svg',
];
function attachments(): string[] {
    return ATTACHMENT_NAMES.map((name) => path.join(ROOT, 'stats', name)).filter((file) => fs.existsSync(file));
}

const AMBER = 0xffa028;
const EMBED_LIMIT = 10;

function discordPayload(reports: DrawReport[]) {
    const chance = (GROUP_SIZE * GROUP_SIZE) / NUMBER_COUNT;
    const pad = (numbers: number[]) => (numbers.length > 0 ? numbers.map((n) => String(n).padStart(2, '0')).join(' ') : '--');
    const row = (label: string, matches: number) => {
        const delta = matches - chance;
        const colour = delta >= 0 ? ansi.up : ansi.down;
        const marker = delta >= 0 ? '▲' : '▼';
        return `${ansi.text}${label.padEnd(10)}${String(matches).padStart(7)}   ${colour}${marker} ${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(1)}${ansi.reset}`;
    };

    const embeds = reports.slice(-EMBED_LIMIT).map(({ draw, mostMatches, leastMatches }) => ({
        color: AMBER,
        author: { name: 'GT TERMINAL │ KINO SCREENER' },
        title: `DRAW #${draw.drawNumber} · ${draw.date.toUpperCase()}`,
        url: PAGE_URL,
        description: [
            '```ansi',
            `${ansi.amber}NUMBERS${ansi.reset}  ${ansi.text}${pad(draw.numbers)}${ansi.reset}`,
            '',
            `${ansi.label}${'GROUP'.padEnd(10)}${'MATCHES'.padStart(7)}   VS EXP${ansi.reset}`,
            row(`${GROUP_SIZE} MOST`, mostMatches.length),
            row(`${GROUP_SIZE} LEAST`, leastMatches.length),
            '',
            `${ansi.label}MOST MATCHED  ${ansi.text}${pad(mostMatches)}${ansi.reset}`,
            `${ansi.label}LEAST MATCHED ${ansi.text}${pad(leastMatches)}${ansi.reset}`,
            '```',
        ].join('\n'),
        footer: { text: `VS EXP: matches against ${chance.toFixed(1)} by chance · groups ranked before this draw` },
    }));

    const payload: { username: string; avatar_url?: string; embeds: typeof embeds } = { username: 'GT TERMINAL', embeds };
    if (process.env.DISCORD_AVATAR_URL) payload.avatar_url = process.env.DISCORD_AVATAR_URL;
    return payload;
}

function readLastNotified(): number | null {
    if (!fs.existsSync(STATE_PATH)) return null;
    const value = Number(fs.readFileSync(STATE_PATH, 'utf8').trim());
    return Number.isInteger(value) ? value : null;
}

// Flags: --preview prints the email without sending it; --draw N reports on
// draw N instead of the draws added since the last email.
async function main() {
    const flags = process.argv.slice(2);
    const preview = flags.includes('--preview');
    const envFile = path.join(ROOT, '.env');
    if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

    const history = readHistory();
    if (history.length === 0) throw new Error('No draws found in kino-history.json');
    const latest = history.reduce((a, b) => (b.drawNumber > a.drawNumber ? b : a));

    let draws: KinoDraw[];
    const drawFlag = flags.indexOf('--draw');
    if (drawFlag >= 0) {
        const wanted = Number(flags[drawFlag + 1]);
        draws = history.filter((draw) => draw.drawNumber === wanted);
        if (draws.length === 0) throw new Error(`Draw #${flags[drawFlag + 1]} is not in kino-history.json`);
    } else {
        // The first run has no record of earlier emails, so it reports the latest draw only.
        const lastNotified = readLastNotified();
        draws = lastNotified === null ? [latest] : history.filter((draw) => draw.drawNumber > lastNotified);
    }

    if (draws.length === 0) {
        console.log('No new draws to email.');
        return;
    }

    const reports = draws.sort((a, b) => a.drawNumber - b.drawNumber).map((draw) => reportFor(draw, history));
    const subject = subjectFor(reports);
    const text = textFor(reports);
    const discord = discordPayload(reports);

    if (preview) {
        console.log(`Subject: ${subject}\n\n${text}\n\n--- Discord message (webhook JSON) ---\n${JSON.stringify(discord, null, 2)}`);
        console.log(`\n--- Discord message (ANSI block, as Discord renders it) ---\n${discord.embeds[0].description}`);
        console.log(`\nDiscord attachments: ${attachments().map((file) => path.basename(file)).join(', ') || 'none'}`);
        return;
    }

    const user = process.env.GMAIL_USER;
    const password = process.env.GMAIL_APP_PASSWORD;
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    const emailOn = Boolean(user && password);
    if (!emailOn && !webhook) {
        console.log('Neither GMAIL_USER / GMAIL_APP_PASSWORD nor DISCORD_WEBHOOK_URL is set (see .env.example); nothing sent.');
        return;
    }

    const through = reports[reports.length - 1].draw.drawNumber;
    if (emailOn) {
        // Sends through Gmail with an app password (Google account › Security › App passwords).
        const transport = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: { user, pass: password },
        });
        await transport.sendMail({ from: `Kino2026 <${user}>`, to: process.env.NOTIFY_TO || user, subject, text });
        console.log(`Email sent for ${reports.length} draw(s), through #${through}.`);
    }
    if (webhook) {
        // Sent as multipart so the back-analysis charts travel with the message.
        const body = new FormData();
        body.append('payload_json', JSON.stringify(discord));
        attachments().forEach((file, index) => {
            const type = file.endsWith('.png') ? 'image/png' : 'image/svg+xml';
            body.append(`files[${index}]`, new Blob([fs.readFileSync(file)], { type }), path.basename(file));
        });
        const response = await fetch(webhook, { method: 'POST', body });
        if (!response.ok) throw new Error(`Discord webhook answered ${response.status}: ${await response.text()}`);
        console.log(`Discord message sent for ${reports.length} draw(s), through #${through}.`);
    }

    // Recorded only after every configured channel succeeded, so a failed run is retried next time.
    if (drawFlag < 0) {
        fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
        fs.writeFileSync(STATE_PATH, String(latest.drawNumber), 'utf8');
    }
}

main().catch((error: unknown) => {
    console.error('Notify failed:', error);
    process.exitCode = 1;
});
