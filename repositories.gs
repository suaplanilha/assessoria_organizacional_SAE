/**
 * repositories.gs
 * Acesso centralizado e otimizado a dados em Sheets.
 */

function stableJsonStringify(value) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return '[' + value.map(stableJsonStringify).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(function(k) { return JSON.stringify(k) + ':' + stableJsonStringify(value[k]); }).join(',') + '}';
  }
  return JSON.stringify(value);
}

function buildSheetQueryCacheKey(sheetName, filtros, opts = {}) {
  const force = toBooleanSafe(opts.force_fresh) ? 'fresh' : 'cache';
  const proj = Array.isArray(opts.project) ? opts.project.slice().sort() : [];
  const payload = {
    sheet: String(sheetName || ''),
    force: force,
    filtros: filtros || {},
    project: proj
  };
  return buildSafeCacheKey('repo:q:v2:' + String(sheetName || ''), payload);
}

function getSheetSnapshotCached(sheet, opts = {}) {
  const ttl = getQueryCacheTTL(opts.ttl);
  const forceFresh = toBooleanSafe(opts.force_fresh);
  const name = sheet && sheet.getName ? sheet.getName() : '';
  const cachePrefix = 'repo:snapshot:v2:' + name;
  const payload = { sheet: name };
  if (!forceFresh) {
    const hit = getCachedQuery(cachePrefix, payload);
    if (hit && hit.headers && hit.rows) return hit;
  }
  const snap = getSheetSnapshot(sheet);
  setCachedQuery(cachePrefix, payload, snap, ttl);
  return snap;
}

function listRowsByFiltersCached(sheet, filtros = {}, opts = {}) {
  const ttl = getQueryCacheTTL(opts.ttl);
  const forceFresh = toBooleanSafe(opts.force_fresh);
  const key = buildSheetQueryCacheKey(sheet.getName(), filtros, opts);

  if (!forceFresh) {
    const hit = getCachedQuery(key);
    if (Array.isArray(hit)) return hit;
  }

  const snapshot = getSheetSnapshotCached(sheet, { ttl: ttl, force_fresh: forceFresh });
  if (!snapshot.rows.length) {
    setCachedQuery(key, [], ttl);
    return [];
  }

  const headers = snapshot.headers;
  const projection = Array.isArray(opts.project) ? opts.project.filter(Boolean) : null;
  const chavePrimaria = String((opts && opts.primaryKey) || '').trim() || (headers.includes('uuid') ? 'uuid' : (headers.includes('tenant_id') ? 'tenant_id' : (headers.includes('token') ? 'token' : headers[0])));

  const rows = snapshot.rows.map(function(row) {
    const obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  }).filter(function(obj) {
    for (const k in filtros) {
      if (obj[k] !== filtros[k]) return false;
    }
    return normalizeIdSafe(obj[chavePrimaria]) || toBooleanSafe(obj.ativo) || String(obj.nome || '').trim();
  }).map(function(obj) {
    if (!projection || !projection.length) return obj;
    const picked = {};
    projection.forEach(function(k) { picked[k] = obj[k]; });
    return picked;
  });

  setCachedQuery(key, rows, ttl);
  return rows;
}

function findSheetRowByFieldIndexed(sheet, field, value) {
  const val = String(value || '');
  if (!val) return null;
  const snapshot = getSheetSnapshotCached(sheet, { ttl: 120, force_fresh: false });
  const headers = snapshot.headers;
  const idx = headers.indexOf(field);
  if (idx < 0) return null;

  for (let i = 0; i < snapshot.rows.length; i++) {
    if (String(snapshot.rows[i][idx] || '') === val) {
      return { row: i + 2, data: snapshot.rows[i], headers: headers };
    }
  }
  return null;
}

function invalidateSessionsByConsultorId(consultorId) {
  const id = normalizeIdSafe(consultorId);
  if (!id) return 0;

  const sheetInfo = getSheetOrFail('sessoes');
  if (sheetInfo.error) return 0;
  const sheet = sheetInfo.sheet;
  const snapshot = getSheetSnapshot(sheet);

  const idxConsultor = snapshot.headers.indexOf('consultor_id');
  const idxAtivo = snapshot.headers.indexOf('ativo');
  if (idxConsultor < 0 || idxAtivo < 0 || snapshot.rows.length === 0) return 0;

  const colAtivo = snapshot.rows.map(function(row) { return [toBooleanSafe(row[idxAtivo])]; });
  let invalidadas = 0;
  for (let i = 0; i < snapshot.rows.length; i++) {
    const row = snapshot.rows[i];
    if (normalizeIdSafe(row[idxConsultor]) === id && toBooleanSafe(row[idxAtivo])) {
      colAtivo[i][0] = false;
      invalidadas += 1;
    }
  }

  if (invalidadas > 0) {
    sheet.getRange(2, idxAtivo + 1, colAtivo.length, 1).setValues(colAtivo);
  }
  return invalidadas;
}
