import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const CHART_NAME = 'kino-number-distribution.svg';
const CHART_PATH = path.join(ROOT, 'stats', CHART_NAME);
const TEMPLATE_PATH = path.join(ROOT, 'site', 'index.html');
const OUT_DIR = path.join(ROOT, 'dist', 'site');
// Hash of the last page that was deployed, so an unchanged chart is not re-uploaded.
const HASH_PATH = path.join(ROOT, 'dist', 'published.hash');
const PLACEHOLDER = '<!--CHART-->';
// The Cloudflare Pages project; kino.gabrieltekken.com is attached to it.
const PROJECT_NAME = 'kino';

// Builds dist/site: the page with the chart inlined (so its hover tooltips
// work) plus the SVG itself for the download link. Returns the page's hash.
function buildSite(): string {
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    if (!template.includes(PLACEHOLDER)) throw new Error(`${TEMPLATE_PATH} has no ${PLACEHOLDER} placeholder`);

    const chart = fs.readFileSync(CHART_PATH, 'utf8');
    const page = template.replace(PLACEHOLDER, () => chart);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'index.html'), page, 'utf8');
    fs.copyFileSync(CHART_PATH, path.join(OUT_DIR, CHART_NAME));
    return createHash('sha256').update(page).digest('hex');
}

function deploy() {
    for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
        if (!process.env[name]) throw new Error(`${name} is not set (see .env.example)`);
    }

    // Runs wrangler's JS entry point with node directly: no shell, so paths with spaces stay one argument.
    const wrangler = path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
    const result = spawnSync(process.execPath,
        [wrangler, 'pages', 'deploy', OUT_DIR, '--project-name', PROJECT_NAME, '--branch', 'main', '--commit-dirty=true'],
        { env: process.env, stdio: ['ignore', 'inherit', 'inherit'], timeout: 10 * 60_000 });

    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`wrangler exited with code ${result.status}`);
}

// Flags: --build-only writes dist/site without deploying; --force deploys
// even if the page has not changed since the last deploy.
function main() {
    const flags = process.argv.slice(2);
    const envFile = path.join(ROOT, '.env');
    if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

    const hash = buildSite();
    if (flags.includes('--build-only')) {
        console.log(`Built ${OUT_DIR}`);
        return;
    }

    const last = fs.existsSync(HASH_PATH) ? fs.readFileSync(HASH_PATH, 'utf8').trim() : '';
    if (last === hash && !flags.includes('--force')) {
        console.log('Site unchanged. Nothing to deploy.');
        return;
    }

    deploy();
    // Recorded only after a successful deploy, so a failed one is retried next time.
    fs.writeFileSync(HASH_PATH, hash, 'utf8');
    console.log('Site deployed.');
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
