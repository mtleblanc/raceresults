#!/usr/bin/env node
// Fetches all raw results from an Athlinks-powered leaderboard API.
// Usage: node fetch-athlinks.js <rid> <api-key>
// Output: data/raw-athlinks-<rid>.json

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const RID     = process.argv[2];
const API_KEY = process.argv[3];
if (!RID || !API_KEY) {
  console.error('Usage: node fetch-athlinks.js <rid> <api-key>');
  console.error('  rid     — the "rid" query param from the leaderboard URL');
  console.error('  api-key — the x-api-key header value from the browser request');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const BASE = 'https://5b8btxj9jd.execute-api.us-west-2.amazonaws.com/public/results/leaderboard';
const LIMIT = 10;
const DELAY_MS = 1000; // pause between requests to avoid rate limiting

const HEADERS = {
  'accept': '*/*',
  'accept-language': 'en-US,en;q=0.8',
  'origin': 'https://sportstats.one',
  'referer': 'https://sportstats.one/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'x-api-key': API_KEY,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: HEADERS }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}\nBody: ${body.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const url0 = `${BASE}?rid=${RID}&sort=overall&timeType=chip&limit=${LIMIT}&offset=0`;
  process.stdout.write('Fetching page 1…');
  await sleep(DELAY_MS);
  const first = await get(url0);

  if (!first.ok) throw new Error(`API returned ok=false: ${JSON.stringify(first).slice(0, 200)}`);

  const total = first.info.total;
  const all   = [...first.participantData];
  console.log(` ${all.length}/${total}`);

  let offset = LIMIT;
  while (offset < total) {
    await sleep(DELAY_MS);
    const url = `${BASE}?rid=${RID}&sort=overall&timeType=chip&limit=${LIMIT}&offset=${offset}`;
    process.stdout.write(`Fetching offset=${offset}…`);
    const page = await get(url);
    if (!page.ok) throw new Error(`API error at offset=${offset}: ${JSON.stringify(page)}`);
    all.push(...page.participantData);
    console.log(` ${all.length}/${total}`);
    offset += LIMIT;
  }

  // Store raw data including top-level metadata (category summaries, etc.)
  const out = {
    rid: RID,
    fetchedAt: new Date().toISOString(),
    info: first.info,
    finishers: first.finishers,
    participantData: all,
  };

  const outFile = path.join(DATA_DIR, `raw-athlinks-${RID}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out));
  console.log(`\nWrote ${all.length} participants to ${outFile}`);
  console.log('Next: node process-athlinks.js <rid> "<Event Name>" <distanceKm>');
}

main().catch(err => { console.error(err.message); process.exit(1); });
