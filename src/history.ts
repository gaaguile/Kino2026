import * as fs from 'fs';
import * as path from 'path';

export interface KinoDraw {
    date: string;
    numbers: number[];
    // Official "sorteo" number published by Lotería. Every script must keep
    // this numbering; never renumber draws sequentially.
    drawNumber: number;
}

export const JSON_PATH = path.join(__dirname, '..', 'kino-history.json');
export const XML_PATH = path.join(__dirname, '..', 'kino-history.xml');

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
});

// Source dates are "DD-MM-YYYY" or "DD/MM/YYYY"; built as UTC to avoid
// local-timezone day shifts. Returns e.g. "Friday, Nov 13, 2026".
export function formatSourceDate(raw: string): string {
    const match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(raw.trim());
    if (!match) throw new Error(`Unrecognized date: "${raw}"`);

    const [day, month, year] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw new Error(`Invalid calendar date: "${raw}"`);
    }
    return DATE_FORMATTER.format(date);
}

export function readHistory(): KinoDraw[] {
    return JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8')) as KinoDraw[];
}

function escapeXml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Writes both history files, sorted by official draw number.
export function writeHistory(draws: KinoDraw[]): void {
    const sorted = [...draws].sort((a, b) => a.drawNumber - b.drawNumber);

    fs.writeFileSync(JSON_PATH, JSON.stringify(sorted, null, 2), 'utf-8');

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<kinoHistory>\n`;
    for (const draw of sorted) {
        xml += `  <draw>\n`;
        xml += `    <drawNumber>${draw.drawNumber}</drawNumber>\n`;
        xml += `    <date>${escapeXml(draw.date)}</date>\n`;
        xml += `    <numbers>${draw.numbers.join(',')}</numbers>\n`;
        xml += `  </draw>\n`;
    }
    xml += `</kinoHistory>`;
    fs.writeFileSync(XML_PATH, xml, 'utf-8');
}
