/**
 * security.gs
 * Helpers de segurança para tokens assinados do portal.
 */

function getPortalTokenSecret() {
  const prop = PropertiesService.getScriptProperties().getProperty('PORTAL_TOKEN_SECRET');
  return String(prop || SECRET_SALT || '').trim();
}

function base64UrlEncodeString(str) {
  return Utilities.base64EncodeWebSafe(str, Utilities.Charset.UTF_8).replace(/=+$/g, '');
}

function base64UrlDecodeString(encoded) {
  const normalized = String(encoded || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = normalized + (pad ? '='.repeat(4 - pad) : '');
  return Utilities.newBlob(Utilities.base64Decode(padded)).getDataAsString();
}

function signPortalPayload(payloadEncoded, secret) {
  const signatureBytes = Utilities.computeHmacSha256Signature(payloadEncoded, secret);
  return Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/g, '');
}

function generatePortalToken(params) {
  const tenantId = normalizeIdSafe(params && params.tenantId);
  const clienteId = normalizeIdSafe(params && params.clienteId);
  const ttlSeconds = Math.max(60, toNumberSafe(params && params.ttlSeconds, 3600));
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.max(now + 60, toNumberSafe(params && params.exp, now + ttlSeconds));

  if (!tenantId || !clienteId) {
    throw new Error('tenantId e clienteId são obrigatórios para token de portal.');
  }

  const secret = getPortalTokenSecret();
  if (!secret) throw new Error('PORTAL_TOKEN_SECRET ausente.');

  const payload = {
    tid: tenantId,
    cid: clienteId,
    iat: now,
    exp: exp,
    v: 1
  };

  const payloadEncoded = base64UrlEncodeString(JSON.stringify(payload));
  const signature = signPortalPayload(payloadEncoded, secret);
  return payloadEncoded + '.' + signature;
}

function verifyPortalToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) {
    return falhaCodigo('portal_token_invalid', 'Token do portal inválido.');
  }

  const payloadEncoded = parts[0];
  const signature = parts[1];
  const secret = getPortalTokenSecret();
  if (!secret) return falhaCodigo('portal_secret_missing', 'Segredo de token do portal não configurado.');

  const expectedSignature = signPortalPayload(payloadEncoded, secret);
  if (expectedSignature !== signature) {
    return falhaCodigo('portal_token_signature_invalid', 'Assinatura do token do portal inválida.');
  }

  try {
    const payload = JSON.parse(base64UrlDecodeString(payloadEncoded));
    const now = Math.floor(Date.now() / 1000);
    const exp = toNumberSafe(payload && payload.exp, 0);
    const tenantId = normalizeIdSafe(payload && payload.tid);
    const clienteId = normalizeIdSafe(payload && payload.cid);

    if (!tenantId || !clienteId || exp <= 0) {
      return falhaCodigo('portal_token_invalid', 'Payload do token do portal inválido.');
    }
    if (exp < now) {
      return falhaCodigo('portal_token_expired', 'Token do portal expirado.');
    }

    return sucesso({ tenant_id: tenantId, cliente_id: clienteId, exp: exp, iat: toNumberSafe(payload.iat, 0), version: toNumberSafe(payload.v, 1) });
  } catch (err) {
    return falhaCodigo('portal_token_invalid', 'Não foi possível decodificar token do portal.');
  }
}


function safeErrorResponse(codigo, erroPublico, contexto = {}) {
  return falhaCodigo(String(codigo || 'internal_error'), String(erroPublico || 'Erro interno.'), { contexto: contexto || {} });
}

const TEXT_ALLOWLIST_RULES = {
  empresa_nome: /^[\p{L}\p{N}\s\-\.,&()\/]{1,120}$/u,
  segmento: /^[\p{L}\p{N}\s\-\.,&()\/]{1,80}$/u,
  responsavel: /^[\p{L}\p{N}\s\-\.',]{1,100}$/u,
  descricao: /^[\p{L}\p{N}\s\-\.,;:!?@#%&()\/]{1,500}$/u,
  onde: /^[\p{L}\p{N}\s\-\.,;:!?@#%&()\/]{0,160}$/u,
  porque: /^[\p{L}\p{N}\s\-\.,;:!?@#%&()\/]{0,500}$/u,
  como: /^[\p{L}\p{N}\s\-\.,;:!?@#%&()\/]{0,500}$/u,
  indicador: /^[\p{L}\p{N}\s\-\.,;:!?@#%&()\/%]{0,200}$/u,
  obs: /^[\p{L}\p{N}\s\-\.,;:!?@#%&()\/%]{0,500}$/u,
  observacoes: /^[\p{L}\p{N}\s\-\.,;:!?@#%&()\/%]{0,500}$/u,
  evidencia: /^[\p{L}\p{N}\s\-\.,;:!?@#%&()\/%]{0,500}$/u
};

function sanitizeTextField(value, maxLen) {
  const raw = String(value === null || value === undefined ? '' : value);
  const semControle = raw.replace(/[\x00-\x1F\x7F]/g, ' ');
  const compactado = semControle.replace(/\s+/g, ' ').trim();
  if (!maxLen || maxLen <= 0) return compactado;
  return compactado.length > maxLen ? compactado.slice(0, maxLen) : compactado;
}

function validateTextAllowlist(field, value) {
  const key = String(field || '').trim();
  if (!key) return null;
  const rule = TEXT_ALLOWLIST_RULES[key];
  if (!rule) return null;

  const v = sanitizeTextField(value, 500);
  if (!v && v !== '') return safeErrorResponse('validation_error', 'Valor textual inválido.', { campo: key });
  if (v === '') return null;
  if (!rule.test(v)) {
    return safeErrorResponse('validation_error', 'Conteúdo inválido para o campo informado.', { campo: key });
  }
  return null;
}

function sanitizeAndValidateFields(dados = {}, fields = []) {
  const out = Object.assign({}, dados || {});
  for (let i = 0; i < fields.length; i++) {
    const campo = fields[i];
    if (out[campo] === undefined || out[campo] === null) continue;
    out[campo] = sanitizeTextField(out[campo], 500);
    const err = validateTextAllowlist(campo, out[campo]);
    if (err) return { erro: err };
  }
  return { dados: out };
}
