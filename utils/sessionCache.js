/**
 * Short-lived in-process cache for authenticated sessions.
 * Cuts repeated JOIN-heavy UserSession lookups under bursty traffic.
 * Per-process only (fine with cluster); TTL keeps logout lag bounded.
 */

const DEFAULT_TTL_MS = Number(process.env.SESSION_CACHE_TTL_MS || 30_000);
const MAX_ENTRIES = Number(process.env.SESSION_CACHE_MAX || 2000);

const cache = new Map();

function prune() {
  if (cache.size <= MAX_ENTRIES) return;
  const overflow = cache.size - MAX_ENTRIES;
  let removed = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function getCachedSession(token) {
  const entry = cache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(token);
    return null;
  }
  return entry.session;
}

function setCachedSession(token, session, ttlMs = DEFAULT_TTL_MS) {
  cache.set(token, {
    session,
    expiresAt: Date.now() + ttlMs,
  });
  prune();
}

function invalidateSession(token) {
  if (token) cache.delete(token);
}

function clearSessionCache() {
  cache.clear();
}

module.exports = {
  getCachedSession,
  setCachedSession,
  invalidateSession,
  clearSessionCache,
};
