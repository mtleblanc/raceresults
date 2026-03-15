#!/usr/bin/env node
// Fetches all race results from RaceRoster and writes results.json
const https = require('https');

const BASE = 'https://results.raceroster.com/v2/api/result-events/97210/sub-events/253764/results';
const LIMIT = 50;

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  process.stdout.write('Fetching page 1...');
  const first = await get(`${BASE}?filter_search=&start=0&limit=${LIMIT}`);
  const total = first.meta.filteredResults;
  const all = [...first.data];
  console.log(` ${all.length}/${total}`);

  let start = LIMIT;
  while (start < total) {
    process.stdout.write(`Fetching start=${start}...`);
    const page = await get(`${BASE}?filter_search=&start=${start}&limit=${LIMIT}`);
    all.push(...page.data);
    console.log(` ${all.length}/${total}`);
    start += LIMIT;
  }

  require('fs').writeFileSync('results.json', JSON.stringify(all));
  console.log(`Done. Wrote ${all.length} results to results.json`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
