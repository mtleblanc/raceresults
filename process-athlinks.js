#!/usr/bin/env node
// Normalizes a raw Athlinks fetch into the format used by the results server.
// Usage: node process-athlinks.js <rid> "<Event Name>" <distanceKm>
//
// Reads:  data/raw-athlinks-<rid>.json
// Writes: data/athlinks-<rid>.json   (normalized participant records)
//         data/events.json           (adds/updates event entry)

const fs   = require('fs');
const path = require('path');

const [,, RID, EVENT_NAME, DISTANCE_KM] = process.argv;
if (!RID || !EVENT_NAME || !DISTANCE_KM) {
  console.error('Usage: node process-athlinks.js <rid> "<Event Name>" <distanceKm>');
  process.exit(1);
}

const DATA_DIR    = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const rawFile     = path.join(DATA_DIR, `raw-athlinks-${RID}.json`);
const outFile     = path.join(DATA_DIR, `athlinks-${RID}.json`);

if (!fs.existsSync(rawFile)) {
  console.error(`Raw data not found: ${rawFile}`);
  console.error(`Run: node fetch-athlinks.js ${RID}`);
  process.exit(1);
}

// ── parse category label → { gender, division } ───────────────────────────
// pc values look like: 'm25-29', 'f30-34', 'm18-24', 'nocat', etc.
function parseCategory(pc) {
  if (!pc || pc === 'nocat') return null;
  const m = pc.match(/^([mf])(\d.+)$/i);
  if (!m) return null;
  const gender   = m[1].toLowerCase() === 'm' ? 'Male' : 'Female';
  const ageRange = m[2].toUpperCase(); // e.g. "25-29"
  const prefix   = gender === 'Male' ? 'M' : 'F';
  return { gender, division: `${prefix}${ageRange}` };
}

// ── format milliseconds as H:MM:SS or M:SS ────────────────────────────────
function msToTimeStr(ms) {
  const totalSecs = Math.round(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// ── process ────────────────────────────────────────────────────────────────
const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
const participants = raw.participantData;

let skipped = 0;
const normalized = [];

for (const p of participants) {
  // Skip DNS/DNF/DSQ — they have no valid chip time
  if (p.ps) { skipped++; continue; }

  const chipMs = p.latest?.cd;
  if (!chipMs || chipMs <= 0) { skipped++; continue; }

  const cat = parseCategory(p.pc);
  if (!cat) { skipped++; continue; } // nocat or unparseable

  normalized.push({
    name:       `${p.pnf ?? ''} ${p.pnl ?? ''}`.trim(),
    bib:        p.bib,
    chipTime:   msToTimeStr(chipMs),
    genderSexId: cat.gender,
    division:   cat.division,
    country:    p.lo3,
  });
}

fs.writeFileSync(outFile, JSON.stringify(normalized));
console.log(`Wrote ${normalized.length} normalized records (skipped ${skipped}) to ${outFile}`);

// ── update events.json ────────────────────────────────────────────────────
const id     = `athlinks-${RID}`;
const events = fs.existsSync(EVENTS_FILE) ? JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')) : [];
const entry  = {
  id,
  eventId:      `athlinks-${RID}`,
  subEventId:   RID,
  name:         EVENT_NAME,
  distanceKm:   Number(DISTANCE_KM),
  fetchedAt:    raw.fetchedAt,
  totalResults: normalized.length,
};
const idx = events.findIndex(e => e.id === id);
if (idx >= 0) events[idx] = entry; else events.push(entry);
fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
console.log(`Updated events.json — event id: ${id}`);
