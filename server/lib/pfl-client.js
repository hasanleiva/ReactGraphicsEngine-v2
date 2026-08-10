const PFL_BASE = 'https://api.pfl.uz/public/v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pflFetch(endpoint, query = {}, retries = 4) {
  const apiKey = process.env.PFL_API_KEY;
  if (!apiKey) throw new Error('PFL_API_KEY not configured in .env');

  const params = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const url = `${PFL_BASE}${endpoint}${params.toString() ? '?' + params : ''}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: { 'X-API-Key': apiKey } });

    if (res.status === 429) {
      if (attempt === retries) {
        const text = await res.text().catch(() => '');
        throw new Error(`PFL API 429 ${endpoint}: ${text}`);
      }
      const delay = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s, 16s
      console.warn(`[pfl-client] 429 on ${endpoint}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await sleep(delay);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`PFL API ${res.status} ${endpoint}: ${text}`);
    }
    return res.json();
  }
}

async function fetchAllPages(endpoint, query = {}) {
  const items = [];
  let page = 1;

  while (true) {
    const data = await pflFetch(endpoint, { ...query, page, limit: 100 });
    const pageItems = data.data || data || [];
    if (!Array.isArray(pageItems) || pageItems.length === 0) break;
    items.push(...pageItems);
    if (!data.meta?.hasNextPage) break;
    page++;
    await sleep(500); // pause between pages to avoid rate limiting
  }

  return items;
}

async function fetchTeams() {
  return fetchAllPages('/clubs');
}

async function fetchAllMatches(tournamentId, seasonId, updatedSince = null) {
  const query = { tournamentId, seasonId, include: 'events' };
  if (updatedSince) query.updatedSince = updatedSince;
  return fetchAllPages('/matches', query);
}

async function fetchMatch(id) {
  return pflFetch(`/matches/${id}`);
}

async function fetchMatchEvents(id) {
  const data = await pflFetch(`/matches/${id}/events`);
  return Array.isArray(data) ? data : (data.data || []);
}

module.exports = { pflFetch, fetchAllPages, fetchTeams, fetchAllMatches, fetchMatch, fetchMatchEvents };
