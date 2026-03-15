#!/usr/bin/env node
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT       = 8080;
const DATA_DIR   = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, '[]');

// ── helpers ──────────────────────────────────────────────────────────────────

function readEvents() {
  return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
}
function writeEvents(events) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse error from ${url}`)); }
      });
    }).on('error', reject);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data, ct = 'application/json') {
  res.writeHead(status, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}

function parseRaceRosterUrl(input) {
  const m = input.match(/result-events\/(\d+)\/sub-events\/(\d+)/);
  return m ? { eventId: m[1], subEventId: m[2] } : null;
}

// ── fetch all pages from RaceRoster ──────────────────────────────────────────

async function fetchAllResults(eventId, subEventId) {
  const LIMIT = 50;
  const base  = `https://results.raceroster.com/v2/api/result-events/${eventId}/sub-events/${subEventId}/results`;

  const first  = await httpsGet(`${base}?filter_search=&start=0&limit=${LIMIT}`);
  const total  = first.meta.filteredResults;
  const all    = [...first.data];
  process.stdout.write(`  fetched ${all.length}/${total}`);

  let start = LIMIT;
  while (start < total) {
    const page = await httpsGet(`${base}?filter_search=&start=${start}&limit=${LIMIT}`);
    all.push(...page.data);
    process.stdout.write(`\r  fetched ${all.length}/${total}`);
    start += LIMIT;
  }
  console.log();
  return { results: all, total };
}

// ── static files ─────────────────────────────────────────────────────────────

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath)) return send(res, 404, { error: 'Not found' });
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

// ── router ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const method = req.method;

  // preflight
  if (method === 'OPTIONS') { send(res, 204, ''); return; }

  try {
    // GET / → index.html
    if (method === 'GET' && pathname === '/') {
      serveFile(res, path.join(__dirname, 'index.html'));
      return;
    }

    // GET /api/events → list stored events
    if (method === 'GET' && pathname === '/api/events') {
      send(res, 200, readEvents());
      return;
    }

    // POST /api/events → fetch & store a new event
    if (method === 'POST' && pathname === '/api/events') {
      const body = await readBody(req);
      const { name, distance } = body;

      if (!name)     return send(res, 400, { error: '"name" is required' });
      if (!distance) return send(res, 400, { error: '"distance" (km) is required' });

      let eventId, subEventId;
      if (body.url) {
        const parsed = parseRaceRosterUrl(body.url);
        if (!parsed) return send(res, 400, { error: 'Could not parse event/subevent IDs from URL' });
        ({ eventId, subEventId } = parsed);
      } else if (body.eventId && body.subEventId) {
        eventId    = String(body.eventId);
        subEventId = String(body.subEventId);
      } else {
        return send(res, 400, { error: 'Provide "url" or "eventId"+"subEventId"' });
      }

      const id = `${eventId}-${subEventId}`;
      console.log(`\nFetching event ${id} (${name})…`);

      req.socket.setTimeout(300_000);
      const { results, total } = await fetchAllResults(eventId, subEventId);

      fs.writeFileSync(path.join(DATA_DIR, `${id}.json`), JSON.stringify(results));

      const events  = readEvents();
      const entry   = { id, eventId, subEventId, name, distanceKm: Number(distance), fetchedAt: new Date().toISOString(), totalResults: total };
      const idx     = events.findIndex(e => e.id === id);
      if (idx >= 0) events[idx] = entry; else events.push(entry);
      writeEvents(events);

      console.log(`Stored ${total} results for "${name}"`);
      send(res, 200, entry);
      return;
    }

    // GET /api/events/:id/results → return stored results JSON
    const resultsMatch = pathname.match(/^\/api\/events\/([^/]+)\/results$/);
    if (method === 'GET' && resultsMatch) {
      const file = path.join(DATA_DIR, `${resultsMatch[1]}.json`);
      if (!fs.existsSync(file)) return send(res, 404, { error: 'Event not found' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      fs.createReadStream(file).pipe(res);
      return;
    }

    // DELETE /api/events/:id → remove event
    const deleteMatch = pathname.match(/^\/api\/events\/([^/]+)$/);
    if (method === 'DELETE' && deleteMatch) {
      const id   = deleteMatch[1];
      const file = path.join(DATA_DIR, `${id}.json`);
      writeEvents(readEvents().filter(e => e.id !== id));
      if (fs.existsSync(file)) fs.unlinkSync(file);
      send(res, 200, { ok: true });
      return;
    }

    send(res, 404, { error: 'Not found' });

  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
