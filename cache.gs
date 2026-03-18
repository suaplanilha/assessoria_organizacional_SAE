/**
 * cache.gs
 * Helpers de cache de consulta com TTL curto.
 */

const CACHE_TTL_QUERY_SHORT = 120; // 60-180s recomendado

function getQueryCacheTTL(customTtl) {
  return Math.max(60, Math.min(180, toNumberSafe(customTtl, CACHE_TTL_QUERY_SHORT)));
}

function toHexDigest(bytes) {
  return (bytes || []).map(function(b) {
    const v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function stableStringifyForCache(value) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringifyForCache).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(function(k) { return JSON.stringify(k) + ':' + stableStringifyForCache(value[k]); }).join(',') + '}';
  }
  return JSON.stringify(value);
}

function buildSafeCacheKey(prefix, payload) {
  const safePrefix = String(prefix || 'cache').replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 80);
  const stable = stableStringifyForCache(payload || {});
  const material = stable.length > 4000 ? stable.slice(0, 4000) : stable;
  const digestBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, material, Utilities.Charset.UTF_8);
  const digest = toHexDigest(digestBytes).slice(0, 48);
  return safePrefix + ':' + digest;
}

function getCachedQuery(prefixOrKey, payloadOrNull) {
  const key = payloadOrNull === undefined ? String(prefixOrKey || '') : buildSafeCacheKey(prefixOrKey, payloadOrNull);
  return getCacheJSON(key);
}

function setCachedQuery(prefixOrKey, payloadOrValue, valueOrTtl, ttlMaybe) {
  if (ttlMaybe === undefined) {
    // assinatura antiga: (key, value, ttl)
    return setCacheJSON(String(prefixOrKey || ''), payloadOrValue, getQueryCacheTTL(valueOrTtl));
  }
  // assinatura nova: (prefix, payload, value, ttl)
  const key = buildSafeCacheKey(prefixOrKey, payloadOrValue);
  return setCacheJSON(key, valueOrTtl, getQueryCacheTTL(ttlMaybe));
}
