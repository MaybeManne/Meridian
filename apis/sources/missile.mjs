// Missile & Air Defense Detection System
// Detects potential missile strikes, explosions, and air defense activations
// via USGS seismic anomaly detection + cross-source OSINT correlation
//
// Method: Shallow seismic events (depth < 15km) in conflict zones are flagged
// as potential explosions. Cross-correlated with FIRMS thermal, ACLED conflict,
// and Telegram OSINT at synthesis time for multi-source confirmation.

import { safeFetch } from '../utils/fetch.mjs';

const USGS_BASE = 'https://earthquake.usgs.gov/fdsnws/event/1/query';

// Conflict zones where seismic anomalies may indicate military activity
const CONFLICT_ZONES = [
  { name: 'Ukraine', minLat: 44, maxLat: 52, minLon: 22, maxLon: 40 },
  { name: 'Syria', minLat: 32, maxLat: 38, minLon: 35, maxLon: 42 },
  { name: 'Iraq', minLat: 29, maxLat: 37, minLon: 39, maxLon: 49 },
  { name: 'Yemen/Red Sea', minLat: 12, maxLat: 20, minLon: 38, maxLon: 50 },
  { name: 'Israel/Gaza', minLat: 29, maxLat: 34, minLon: 34, maxLon: 36 },
  { name: 'Korean Peninsula', minLat: 33, maxLat: 43, minLon: 124, maxLon: 131 },
  { name: 'Iran', minLat: 25, maxLat: 40, minLon: 44, maxLon: 63 },
  { name: 'Pakistan/India Border', minLat: 28, maxLat: 35, minLon: 68, maxLon: 78 },
  { name: 'Taiwan Strait', minLat: 22, maxLat: 26, minLon: 117, maxLon: 122 },
  { name: 'Libya', minLat: 25, maxLat: 33, minLon: 9, maxLon: 25 },
  { name: 'Sudan', minLat: 8, maxLat: 22, minLon: 22, maxLon: 38 },
  { name: 'Myanmar', minLat: 9, maxLat: 28, minLon: 92, maxLon: 102 },
];

// Known missile test sites — seismic activity here is highly relevant
const TEST_SITES = [
  { name: 'Kapustin Yar', lat: 48.6, lon: 46.3, country: 'Russia', radius: 100 },
  { name: 'Plesetsk', lat: 62.9, lon: 40.7, country: 'Russia', radius: 80 },
  { name: 'Sohae', lat: 39.66, lon: 124.7, country: 'North Korea', radius: 50 },
  { name: 'Tonghae', lat: 40.85, lon: 129.66, country: 'North Korea', radius: 50 },
  { name: 'Punggye-ri', lat: 41.28, lon: 129.08, country: 'North Korea', radius: 30 },
  { name: 'Semnan', lat: 35.2, lon: 53.9, country: 'Iran', radius: 80 },
  { name: 'Palmachim', lat: 31.9, lon: 34.7, country: 'Israel', radius: 30 },
  { name: 'Jiuquan', lat: 40.96, lon: 100.3, country: 'China', radius: 80 },
  { name: 'Xichang', lat: 28.25, lon: 102.03, country: 'China', radius: 50 },
  { name: 'Sriharikota', lat: 13.72, lon: 80.23, country: 'India', radius: 30 },
  { name: 'Vandenberg', lat: 34.74, lon: -120.57, country: 'USA', radius: 30 },
  { name: 'Kwajalein', lat: 9.4, lon: 167.5, country: 'USA', radius: 50 },
];

// Keywords for Telegram/OSINT cross-correlation (exported for inject.mjs)
export const MISSILE_KEYWORDS = [
  'missile', 'rocket', 'intercept', 'air defense', 'air raid', 'air alert',
  'ATACMS', 'Patriot', 'Iron Dome', 'S-300', 'S-400', 'THAAD', 'Shahed',
  'Iskander', 'Kalibr', 'Kinzhal', 'cruise missile', 'ballistic',
  'Houthi', 'drone attack', 'UAV strike', 'Geran', 'HIMARS',
  'Arrow', "David's Sling", 'Buk', 'Pantsir', 'Tor-M2',
  'shelling', 'barrage', 'salvo', 'incoming', 'launch detected',
  'air alarm', 'explosion reported', 'impact confirmed', 'debris falling',
  'anti-aircraft', 'SAM', 'MANPADS', 'Stinger', 'Starstreak',
  'hypersonic', 'Zircon', 'DF-21', 'Tomahawk', 'Storm Shadow', 'SCALP',
];

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findConflictZone(lat, lon) {
  return CONFLICT_ZONES.find(z =>
    lat >= z.minLat && lat <= z.maxLat && lon >= z.minLon && lon <= z.maxLon
  );
}

function findNearTestSite(lat, lon) {
  for (const site of TEST_SITES) {
    const dist = haversineKm(lat, lon, site.lat, site.lon);
    if (dist <= site.radius) return { ...site, distance: Math.round(dist) };
  }
  return null;
}

// Classify seismic event: explosion vs natural earthquake
function classifyEvent(event) {
  const { depth, mag, place, lat, lon } = event;
  let score = 0;
  const flags = [];

  // Surface-level = almost certainly not tectonic
  if (depth <= 0) { score += 40; flags.push('surface-level'); }
  else if (depth <= 3) { score += 30; flags.push('very shallow (<3km)'); }
  else if (depth <= 10) { score += 15; flags.push('shallow (<10km)'); }

  // Explosion-range magnitude (large munitions/missiles = M2-4.5)
  if (mag >= 2 && mag <= 4.5) { score += 15; flags.push('explosion-range mag'); }

  // Conflict zone bonus
  const zone = findConflictZone(lat, lon);
  if (zone) { score += 25; flags.push(`conflict zone: ${zone.name}`); }

  // Test site proximity
  const testSite = findNearTestSite(lat, lon);
  if (testSite) { score += 30; flags.push(`near ${testSite.name} (${testSite.distance}km)`); }

  // USGS sometimes labels known explosions
  const usgsTagged = place && /explosion|blast|quarry blast/i.test(place);
  if (usgsTagged) {
    score += 20;
    flags.push('USGS tagged explosion');
  }

  // CRITICAL: Events outside conflict zones and test sites are almost always
  // natural earthquakes or mining blasts, not military activity. Only flag them
  // if USGS explicitly labels them as explosions.
  const hasGeoContext = zone || testSite || usgsTagged;
  if (!hasGeoContext) {
    return {
      score: 0,
      classification: 'natural',
      flags: [...flags, 'outside monitored zones'],
      conflictZone: null,
      testSite: null,
    };
  }

  return {
    score: Math.min(score, 100),
    classification: score >= 50 ? 'likely-explosion' : score >= 30 ? 'suspicious' : 'natural',
    flags,
    conflictZone: zone?.name || null,
    testSite: testSite?.name || null,
  };
}

async function fetchSeismicEvents() {
  const startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const url = `${USGS_BASE}?format=geojson&starttime=${startTime}&minmagnitude=2&maxdepth=15&orderby=time&limit=500`;

  try {
    const data = await safeFetch(url, { timeout: 15000 });
    if (!data?.features) return [];

    return data.features.map(f => {
      const [lon, lat, depth] = f.geometry.coordinates;
      return {
        id: f.id,
        time: f.properties.time ? new Date(f.properties.time).toISOString() : null,
        mag: f.properties.mag,
        depth: Math.max(0, depth),
        place: f.properties.place || '',
        lat,
        lon,
        type: f.properties.type || 'earthquake',
      };
    });
  } catch (e) {
    console.log('[Missile] USGS fetch failed:', e.message);
    return [];
  }
}

export async function briefing() {
  return collect();
}

export async function collect() {
  const seismicEvents = await fetchSeismicEvents();

  // Classify all events
  const classified = seismicEvents.map(e => ({ ...e, ...classifyEvent(e) }));

  // Filter to suspicious + likely-explosion
  const anomalies = classified
    .filter(e => e.classification !== 'natural')
    .sort((a, b) => b.score - a.score);

  const likelyExplosions = anomalies.filter(e => e.classification === 'likely-explosion');
  const suspicious = anomalies.filter(e => e.classification === 'suspicious');

  // Group by conflict zone
  const byZone = {};
  for (const e of anomalies) {
    const zone = e.conflictZone || 'Other';
    if (!byZone[zone]) byZone[zone] = { count: 0, events: [] };
    byZone[zone].count++;
    if (byZone[zone].events.length < 5) {
      byZone[zone].events.push({
        time: e.time, mag: e.mag, depth: e.depth, place: e.place,
        lat: e.lat, lon: e.lon, score: e.score,
      });
    }
  }

  // Generate signals
  const signals = [];

  if (likelyExplosions.length > 0) {
    const zones = [...new Set(likelyExplosions.map(e => e.conflictZone).filter(Boolean))];
    signals.push(`${likelyExplosions.length} probable explosion(s) detected via seismic anomaly — ${zones.join(', ') || 'monitored regions'}`);
  }

  const testSiteEvents = anomalies.filter(e => e.testSite);
  if (testSiteEvents.length > 0) {
    const sites = [...new Set(testSiteEvents.map(e => e.testSite))];
    signals.push(`Seismic activity near missile test site(s): ${sites.join(', ')}`);
  }

  const last24h = anomalies.filter(e => e.time && (Date.now() - new Date(e.time).getTime()) < 24 * 60 * 60 * 1000);
  if (last24h.length >= 3) {
    signals.push(`${last24h.length} seismic anomalies in last 24h — possible sustained bombardment`);
  }

  if (anomalies.length === 0) {
    signals.push('No seismic explosion signatures detected in monitored conflict zones');
  }

  return {
    source: 'Missile/AirDef',
    timestamp: new Date().toISOString(),
    totalSeismicEvents: seismicEvents.length,
    totalAnomalies: anomalies.length,
    likelyExplosions: likelyExplosions.slice(0, 20).map(e => ({
      time: e.time, mag: e.mag, depth: e.depth, place: e.place,
      lat: e.lat, lon: e.lon, score: e.score, flags: e.flags,
      conflictZone: e.conflictZone, testSite: e.testSite,
    })),
    suspicious: suspicious.slice(0, 20).map(e => ({
      time: e.time, mag: e.mag, depth: e.depth, place: e.place,
      lat: e.lat, lon: e.lon, score: e.score, flags: e.flags,
      conflictZone: e.conflictZone, testSite: e.testSite,
    })),
    byZone,
    testSiteActivity: testSiteEvents.slice(0, 10).map(e => ({
      time: e.time, mag: e.mag, site: e.testSite, lat: e.lat, lon: e.lon,
    })),
    conflictZones: CONFLICT_ZONES.map(z => z.name),
    testSites: TEST_SITES.map(s => ({ name: s.name, country: s.country, lat: s.lat, lon: s.lon })),
    signals,
  };
}
