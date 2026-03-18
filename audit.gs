/**
 * audit.gs
 * Helpers de rastreabilidade fim-a-fim (request_id) e log estruturado.
 */

function generateClientRequestId(prefix) {
  const p = String(prefix || 'web').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'web';
  return p + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 20);
}

function resolveRequestIds(params = {}) {
  const clientRequestIdRaw = String((params && (params.request_id || params.client_request_id)) || '').trim();
  const clientRequestId = clientRequestIdRaw ? clientRequestIdRaw.slice(0, 80) : '';
  const requestId = gerarRequestId();
  return {
    request_id: requestId,
    client_request_id: clientRequestId || requestId
  };
}

function logApiTrace(stage, payload = {}) {
  const status = String(payload.status || '').toLowerCase() || 'unknown';
  logEstruturado('api.trace.' + String(stage || 'event'), {
    request_id: payload.request_id || '',
    client_request_id: payload.client_request_id || '',
    modulo: payload.modulo || '',
    acao: payload.acao || '',
    tenant_id: payload.tenant_id || '',
    status: status,
    duration_ms: toNumberSafe(payload.duration_ms, 0)
  }, status === 'error' ? 'ERROR' : 'INFO');
}
