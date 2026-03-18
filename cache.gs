/**
 * cache.gs
 * Helpers de cache de consulta com TTL curto.
 */

const CACHE_TTL_QUERY_SHORT = 120; // 60-180s recomendado

function getQueryCacheTTL(customTtl) {
  return Math.max(60, Math.min(180, toNumberSafe(customTtl, CACHE_TTL_QUERY_SHORT)));
}

function getCachedQuery(key) {
  return getCacheJSON(key);
}

function setCachedQuery(key, value, ttl) {
  setCacheJSON(key, value, getQueryCacheTTL(ttl));
}
