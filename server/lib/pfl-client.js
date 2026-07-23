const PFL_BASE = 'https://api.pfl.uz/public/v1';

async function pflFetch(endpoint, query = {}) {
  const apiKey = process.env.PFL_API_KEY;
  if (!apiKey) throw new Error('PFL_API_KEY not configured in .env');

  const params = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const url = `${PFL_BASE}${endpoint}${params.toString() ? '?' + params : ''}`;

  const res = await fetch(url, { headers: { 'X-API-Key': apiKey } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PFL API ${res.status} ${endpoint}: ${text}`);
  }
  return res.json();
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
    await new Promise(r => setTimeout(r, 130)); // respect rate limit
  }

  return items;
}

async function fetchTeams() {
  return fetchAllPages('/clubs');
}

async function fetchAllMatches(tournamentId, seasonId) {
  return fetchAllPages('/matches', { tournamentId, seasonId });
}

async function fetchMatch(id) {
  return pflFetch(`/matches/${id}`);
}

async function fetchMatchEvents(id) {
  const data = await pflFetch(`/matches/${id}/events`);
  return Array.isArray(data) ? data : (data.data || []);
}

module.exports = { pflFetch, fetchAllPages, fetchTeams, fetchAllMatches, fetchMatch, fetchMatchEvents };
