#!/usr/bin/env node
// Fetches all raw results from an Athlinks-powered leaderboard API.
// Usage: node fetch-athlinks.js <rid> <api-key> [--offset=N]
// Output: data/raw-athlinks-<rid>.json

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const RID     = process.argv[2];
const API_KEY = process.argv[3];
if (!RID ) {
  console.error('Usage: node fetch-athlinks.js <rid> <api-key> [--offset=N]');
  console.error('  rid     — the "rid" query param from the leaderboard URL');
  console.error('  --offset=N  — resume fetching from this offset (requires existing output file)');
  process.exit(1);
}

const OFFSET_ARG   = process.argv.find(a => a.startsWith('--offset='));
const START_OFFSET = OFFSET_ARG ? parseInt(OFFSET_ARG.split('=')[1], 10) : 0;

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const outFile = path.join(DATA_DIR, `raw-athlinks-${RID}.json`);

const BASE    = 'https://public.sportstats.one/getsortedresults';
const LIMIT   = 10;
const DELAY_MS = 1000; // pause between requests to avoid rate limiting

const HEADERS = {
  'accept': '*/*',
  'accept-language': 'en-US,en;q=0.8',
  'origin': 'https://sportstats.one',
  'referer': 'https://sportstats.one/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
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

async function getWithRetry(url) {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await get(url);
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) throw e;
      console.log(` error (attempt ${attempt}/${MAX_ATTEMPTS}): ${e.message}. Retrying in 10s…`);
      await sleep(10000);
    }
  }
}

function writeIncremental(out) {
  fs.writeFileSync(outFile, JSON.stringify(out));
}

async function main() {
  let info, finishers, all;

  if (START_OFFSET > 0) {
    if (!fs.existsSync(outFile)) {
      console.error(`Cannot resume: ${outFile} does not exist`);
      process.exit(1);
    }
    const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    info      = existing.info;
    finishers = existing.finishers;
    all       = existing.participantData;
    console.log(`Resuming from offset=${START_OFFSET}, have ${all.length} participants so far`);
  } else {
    const url0 = `${BASE}?rid=${RID}&sort=overall&timeType=chip&limit=${LIMIT}&offset=0`;
    process.stdout.write('Fetching page 1…');
    await sleep(DELAY_MS);
    const first = await getWithRetry(url0);
    if (!first.ok) throw new Error(`API returned ok=false: ${JSON.stringify(first).slice(0, 200)}`);

    info      = first.info;
    finishers = first.finishers;
    all       = [...first.participantData];
    console.log(` ${all.length}/${info.total}`);

    writeIncremental({ rid: RID, fetchedAt: new Date().toISOString(), info, finishers, participantData: all });
  }

  const total = info.total;
  let offset = START_OFFSET > 0 ? START_OFFSET : LIMIT;

  while (offset < total) {
    await sleep(DELAY_MS);
    const url = `${BASE}?rid=${RID}&sort=overall&timeType=chip&limit=${LIMIT}&offset=${offset}`;
    process.stdout.write(`Fetching offset=${offset}…`);
    const page = await getWithRetry(url);
    if (!page.ok) throw new Error(`API error at offset=${offset}: ${JSON.stringify(page)}`);
    all.push(...page.participantData);
    console.log(` ${all.length}/${total}`);
    offset += LIMIT;

    writeIncremental({ rid: RID, fetchedAt: new Date().toISOString(), info, finishers, participantData: all });
  }

  console.log(`\nWrote ${all.length} participants to ${outFile}`);
  console.log('Next: node process-athlinks.js <rid> "<Event Name>" <distanceKm>');
}

main().catch(err => { console.error(err.message); process.exit(1); });
