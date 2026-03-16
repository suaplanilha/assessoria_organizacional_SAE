/**
 * ============================================================
 * SAE — Sistema Apollo Enterprise
 * Backend: Google Apps Script (V8 Engine)
 * Banco de Dados: Google Sheets (NoSQL Multi-tenant)
 * ============================================================
 *
 * INSTRUÇÕES DE DEPLOY:
 * 1. Acesse: script.google.com → Novo Projeto
 * 2. Cole este código no editor
 * 3. Execute setupSpreadsheet() uma vez para criar as abas
 * 4. Implante como Web App:
 *    - Executar como: Usuário acessando o app
 *    - Acesso: Qualquer pessoa (ou somente eu, para MVP)
 * 5. Copie a URL do Web App e use na variável WEBAPP_URL do frontend
 *
 * COMUNICAÇÃO FRONTEND → BACKEND:
 * SEMPRE usar google.script.run (NUNCA fetch/XHR por causa do CORS)
 *
 * Exemplo no frontend:
 *   google.script.run
 *     .withSuccessHandler(callback)
 *     .withFailureHandler(errorCallback)
 *     .salvarCliente(dadosCliente);
 * ============================================================
 */

// ============================================================
// CONFIGURAÇÃO GLOBAL
// ============================================================

const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
const SECRET_SALT    = PropertiesService.getScriptProperties().getProperty('SECRET_SALT') || 'sae_apollo_2026_salt';


const SCHEMA_VERSION = '2.0.0';

const SHEET_SCHEMAS = {
  tb_empresas: [
    'tenant_id', 'nome', 'plano', 'status', 'max_usuarios', 'max_clientes', 'created_at', 'updated_at'
  ],
  tb_permissoes: [
    'perfil', 'recurso', 'permitido', 'created_at'
  ],
  consultores: [
    'uuid', 'tenant_id', 'perfil', 'nome', 'email', 'email_hash', 'senha_hash', 'plano_saas',
    'data_adesao', 'ativo', 'configuracoes_json',
    'reset_token_hash', 'reset_expira_iso', 'reset_solicitado_em'
  ],
  clientes: [
    'uuid', 'tenant_id', 'consultor_id', 'empresa_nome', 'segmento',
    'responsavel', 'email_contato', 'telefone', 'status',
    'mensalidade', 'data_inicio', 'maturidade', 'obs', 'created_at'
  ],
  diagnosticos: [
    'uuid', 'tenant_id', 'cliente_id', 'consultor_id', 'tipo_matriz',
    'respostas_json', 'score', 'dimensoes_json', 'observacoes',
    'created_at', 'status'
  ],
  tarefas_5w2h: [
    'uuid', 'tenant_id', 'cliente_id', 'consultor_id', 'descricao', 'responsavel',
    'prazo_iso', 'onde', 'porque', 'como', 'custo', 'indicador',
    'status', 'tipo', 'evidencia', 'created_at', 'updated_at'
  ],
  financeiro: [
    'uuid', 'tenant_id', 'cliente_id', 'consultor_id', 'valor_mensalidade',
    'data_vencimento', 'data_pagamento', 'pago', 'metodo_pagamento', 'obs', 'created_at'
  ],
  sessoes: [
    'token', 'tenant_id', 'consultor_id', 'perfil', 'email_hash', 'created_at', 'expires_at', 'ativo'
  ]
};

const RBAC_PERMISSOES_PADRAO = {
  owner: ['*'],
  admin: ['*'],
  manager: [
    'auth.verificar',
    'clientes.*',
    'diagnosticos.*',
    'tarefas.*',
    'financeiro.*',
    'dashboard.kpis',
    'relatorios.gerar',
    'portal.link'
  ],
  analyst: [
    'auth.verificar',
    'clientes.listar',
    'diagnosticos.*',
    'tarefas.*',
    'financeiro.listar',
    'dashboard.kpis',
    'relatorios.gerar',
    'portal.link'
  ],
  viewer: [
    'auth.verificar',
    'clientes.listar',
    'diagnosticos.listar',
    'tarefas.listar',
    'financeiro.listar',
    'dashboard.kpis',
    'relatorios.gerar',
    'portal.link'
  ]
};

function logEstruturado(evento, payload = {}, nivel = 'INFO') {
  const base = {
    ts: new Date().toISOString(),
    nivel,
    evento,
    schemaVersion: SCHEMA_VERSION
  };
  Logger.log(JSON.stringify(Object.assign(base, payload)));
}

function sucesso(dados = {}, extras = {}) {
  return Object.assign({ sucesso: true, erro: null, dados }, extras);
}

function falha(erro, extras = {}) {
  return Object.assign({ sucesso: false, erro, dados: null }, extras);
}

function toBooleanSafe(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';
}

function toNumberSafe(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toISODateSafe(v, fallback = null) {
  if (!v) return fallback;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

function getSheetOrFail(nomeAba) {
  const sheet = getSpreadsheet().getSheetByName(nomeAba);
  if (!sheet) {
    return {
      sheet: null,
      error: falha(`Aba obrigatória não encontrada: ${nomeAba}`, {
        acao_sugerida: 'Execute setupSpreadsheet() para criar/ajustar as abas necessárias.'
      })
    };
  }
  return { sheet, error: null };
}

function validarSchemaAbas() {
  const ss = getSpreadsheet();
  const resultado = { versao: SCHEMA_VERSION, ok: true, detalhes: [] };

  Object.entries(SHEET_SCHEMAS).forEach(([nomeAba, headersEsperados]) => {
    const sheet = ss.getSheetByName(nomeAba);
    if (!sheet) {
      resultado.ok = false;
      resultado.detalhes.push({ aba: nomeAba, status: 'ausente', faltantes: headersEsperados });
      return;
    }

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].filter(Boolean);
    const faltantes = headersEsperados.filter(h => !headers.includes(h));
    if (faltantes.length > 0) {
      resultado.ok = false;
      resultado.detalhes.push({ aba: nomeAba, status: 'incompleta', faltantes });
    }
  });

  return resultado;
}

const CACHE_TTL_KPIS = 60; // segundos
const CACHE_TTL_LISTA = 45; // segundos

function getCache() {
  return CacheService.getScriptCache();
}

function getCacheJSON(key) {
  const raw = getCache().get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function setCacheJSON(key, value, ttlSecs) {
  getCache().put(key, JSON.stringify(value), ttlSecs);
}

function invalidateConsultorCache(consultorId) {
  if (!consultorId) return;
  const props = PropertiesService.getScriptProperties();
  const key = `CACHE_VER_${consultorId}`;
  const ver = Number(props.getProperty(key) || '1');
  props.setProperty(key, String(ver + 1));
}

function getConsultorCacheVersion(consultorId) {
  const props = PropertiesService.getScriptProperties();
  return Number(props.getProperty(`CACHE_VER_${consultorId}`) || '1');
}

function registrarTelemetria(modulo, evento) {
  try {
    const props = PropertiesService.getScriptProperties();
    const chave = `METRIC_${modulo}_${evento}`.replace(/[^A-Z0-9_]/gi, '_').toUpperCase();
    const atual = Number(props.getProperty(chave) || '0');
    props.setProperty(chave, String(atual + 1));
    logEstruturado('telemetry.increment', { modulo, evento, contador: atual + 1 });
  } catch (err) {
    Logger.log('Falha ao registrar telemetria: ' + err.message);
  }
}

function getSheetSnapshot(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [] };

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (lastRow === 1) return { headers, rows: [] };

  const rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return { headers, rows };
}

function parsePaginacao(opts = {}) {
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(opts.pageSize, 10) || 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function normalizeIdSafe(v) {
  return String(v || '').trim();
}

function normalizeStatusTarefa(v) {
  const raw = String(v || '').trim().toLowerCase();
  const mapa = {
    iniciar: 'iniciar',
    inicio: 'iniciar',
    'a_iniciar': 'iniciar',
    'a iniciar': 'iniciar',
    execucao: 'execucao',
    execução: 'execucao',
    em_execucao: 'execucao',
    'em execução': 'execucao',
    validando: 'validando',
    validacao: 'validando',
    validação: 'validando',
    concluido: 'concluido',
    concluído: 'concluido',
    done: 'concluido',
    deleted: 'deleted',
    excluido: 'deleted',
    excluído: 'deleted'
  };
  return mapa[raw] || 'iniciar';
}

/**
 * Retorna o Spreadsheet ativo (ou cria um novo se não configurado)
 */
function getSpreadsheet() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  // Fallback: usa o spreadsheet vinculado ao script
  return SpreadsheetApp.getActiveSpreadsheet();
}

// ============================================================
// PONTO DE ENTRADA — WEB APP
// ============================================================

/**
 * GET — Serve o HTML do frontend
 */
function doGet(e) {
  const req = e || { parameter: {} };
  const page = req.parameter.page || 'app';

  if (page === 'portal') {
    // Portal do cliente via token
    return servirPortalCliente(req.parameter.token, req.parameter.consultor);
  }

  const template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('SAE — Sistema Apollo Enterprise')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * POST — Endpoint alternativo (não necessário com google.script.run)
 */
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  return ContentService.createTextOutput(
    JSON.stringify({ status: 'ok', data: processarPost(data) })
  ).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// SETUP — CRIAÇÃO DAS ABAS (rodar UMA VEZ)
// ============================================================

/**
 * Cria todas as abas do banco de dados com os headers corretos.
 * Execute via: Executar → setupSpreadsheet
 */
function setupSpreadsheet() {
  const ss = getSpreadsheet();

  const SHEETS = SHEET_SCHEMAS;

  const existentes = ss.getSheets().map(s => s.getName());

  for (const [nome, headers] of Object.entries(SHEETS)) {
    let sheet;
    if (existentes.includes(nome)) {
      sheet = ss.getSheetByName(nome);
      Logger.log(`Aba "${nome}" já existe — preservando dados.`);
    } else {
      sheet = ss.insertSheet(nome);
      Logger.log(`Aba "${nome}" criada.`);
    }

    // Verifica se headers já foram escritos
    const firstRow = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
    if (!firstRow[0]) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      // Formata header
      sheet.getRange(1, 1, 1, headers.length)
        .setBackground('#1e293b')
        .setFontColor('#94a3b8')
        .setFontWeight('bold')
        .setFontSize(10);
      sheet.setFrozenRows(1);
    } else {
      // Migração de schema: adiciona colunas faltantes ao final
      const existentesHeader = firstRow.filter(Boolean);
      const faltantes = headers.filter(h => !existentesHeader.includes(h));
      if (faltantes.length) {
        const inicio = existentesHeader.length + 1;
        sheet.getRange(1, inicio, 1, faltantes.length).setValues([faltantes]);
        Logger.log('Aba "' + nome + '" recebeu colunas faltantes: ' + faltantes.join(', '));
      }
    }
  }

  const permissoesInfo = getSheetOrFail('tb_permissoes');
  if (!permissoesInfo.error) {
    const permSheet = permissoesInfo.sheet;
    const snap = getSheetSnapshot(permSheet);
    if (snap.rows.length === 0) {
      const agora = new Date().toISOString();
      Object.entries(RBAC_PERMISSOES_PADRAO).forEach(function(entry) {
        const perfil = entry[0];
        entry[1].forEach(function(recurso) {
          permSheet.appendRow([perfil, recurso, true, agora]);
        });
      });
    }
  }

  // Salva o ID da planilha nas propriedades
  PropertiesService.getScriptProperties()
    .setProperty('SPREADSHEET_ID', ss.getId());
  PropertiesService.getScriptProperties().setProperty('DB_SCHEMA_VERSION', SCHEMA_VERSION);

  Logger.log('Setup concluído! Spreadsheet ID: ' + ss.getId());
  return sucesso({ status: 'ok', message: 'Setup completo', spreadsheetId: ss.getId(), schemaVersion: SCHEMA_VERSION });
}

// ============================================================
// AUTENTICAÇÃO — SHA-256 Multi-tenant
// ============================================================

/**
 * Gera hash SHA-256 do email (segurança básica)
 * @param {string} email
 * @returns {string} hash hexadecimal
 */
function hashEmail(email) {
  const raw = (email.toLowerCase().trim() + SECRET_SALT);
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    raw,
    Utilities.Charset.UTF_8
  );
  return digest.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}


function hashTexto(valor) {
  const raw = String(valor || '') + SECRET_SALT;
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    raw,
    Utilities.Charset.UTF_8
  );
  return digest.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function getWebAppUrlSafe() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (err) {
    return '';
  }
}

/**
 * Gera UUID v4
 */
function gerarUUID() {
  return Utilities.getUuid();
}

/**
 * Autentica o consultor via email + senha
 * Retorna token de sessão ou null se inválido
 *
 * No frontend:
 *   google.script.run
 *     .withSuccessHandler(onLoginSuccess)
 *     .autenticarConsultor({ email: '...', senha: '...' })
 */
function autenticarConsultor(dados) {
  try {
    const { email, senha } = dados;
    if (!email || !senha) {
      logEstruturado('auth.login.validation_failed', { emailInformado: !!email }, 'WARN');
      return falha('Campos obrigatórios');
    }

    const emailHash = hashEmail(email);
    const senhaHash = hashEmail(senha); // senha também hasheada

    const sheetInfo = getSheetOrFail('consultores');
    if (sheetInfo.error) return sheetInfo.error;
    const sheet = sheetInfo.sheet;
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const idxHash = headers.indexOf('email_hash');
    const idxUUID = headers.indexOf('uuid');
    const idxNome = headers.indexOf('nome');
    const idxPlano = headers.indexOf('plano_saas');
    const idxAtivo = headers.indexOf('ativo');
    const idxSenha = headers.indexOf('senha_hash');

    if (idxSenha < 0) return falha('Schema desatualizado em consultores. Execute setupSpreadsheet().');

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      // Compara email_hash
      if (row[idxHash] === emailHash && row[idxSenha] === senhaHash && toBooleanSafe(row[idxAtivo])) {
        const idxTenant = headers.indexOf('tenant_id');
        const idxPerfil = headers.indexOf('perfil');
        const consultor = {
          uuid: row[idxUUID],
          tenant_id: idxTenant >= 0 ? normalizeIdSafe(row[idxTenant]) : '',
          perfil: idxPerfil >= 0 ? String(row[idxPerfil] || 'owner').toLowerCase() : 'owner',
          nome: row[idxNome],
          email: email,
          plano: row[idxPlano],
        };
        if (!consultor.tenant_id) {
          consultor.tenant_id = garantirTenantParaConsultor(consultor.uuid, consultor.nome, consultor.plano || 'Pro');
        }
        // Gera token de sessão
        const token = criarSessao(consultor.uuid, emailHash, { tenant_id: consultor.tenant_id, perfil: consultor.perfil });
        return { sucesso: true, consultor, token };
      }
    }

    return falha('Conta não encontrada ou senha inválida. Crie sua conta no cadastro.');

  } catch (err) {
    logEstruturado('auth.login.exception', { mensagem: err.message, stack: String(err.stack || '') }, 'ERROR');
    return falha('Erro interno: ' + err.message);
  }
}

function getConsultorById(consultorId) {
  if (!consultorId) return null;
  const sheetInfo = getSheetOrFail('consultores');
  if (sheetInfo.error) return null;
  const registros = sheetParaObjetos(sheetInfo.sheet, { uuid: consultorId });
  return registros && registros[0] ? registros[0] : null;
}

function garantirTenantParaConsultor(consultorId, nomeTenant, plano) {
  const c = getConsultorById(consultorId);
  const tenantAtual = normalizeIdSafe(c && c.tenant_id);
  if (tenantAtual) return tenantAtual;

  const sheetInfo = getSheetOrFail('tb_empresas');
  if (sheetInfo.error) throw new Error(sheetInfo.error.erro);
  const sheet = sheetInfo.sheet;
  const tenantId = gerarUUID();
  const agora = new Date().toISOString();
  sheet.appendRow([
    tenantId,
    nomeTenant || ('Tenant ' + consultorId),
    plano || 'Pro',
    'active',
    5,
    200,
    agora,
    agora
  ]);

  const consultoresInfo = getSheetOrFail('consultores');
  if (!consultoresInfo.error) {
    const linha = encontrarLinha(consultoresInfo.sheet, consultorId);
    if (linha) {
      const idxTenant = linha.headers.indexOf('tenant_id');
      const idxPerfil = linha.headers.indexOf('perfil');
      if (idxTenant >= 0) consultoresInfo.sheet.getRange(linha.row, idxTenant + 1).setValue(tenantId);
      if (idxPerfil >= 0 && !String(linha.data[idxPerfil] || '').trim()) {
        consultoresInfo.sheet.getRange(linha.row, idxPerfil + 1).setValue('owner');
      }
    }
  }

  return tenantId;
}

function obterContextoSessao(token) {
  if (!token) return null;
  const sheetInfo = getSheetOrFail('sessoes');
  if (sheetInfo.error) return null;
  const snapshot = getSheetSnapshot(sheetInfo.sheet);
  if (snapshot.rows.length === 0) return null;

  const headers = snapshot.headers;
  const idxToken = headers.indexOf('token');
  const idxConsultor = headers.indexOf('consultor_id');
  const idxTenant = headers.indexOf('tenant_id');
  const idxPerfil = headers.indexOf('perfil');
  const idxExpires = headers.indexOf('expires_at');
  const idxAtivo = headers.indexOf('ativo');

  for (let i = 0; i < snapshot.rows.length; i++) {
    const row = snapshot.rows[i];
    if (row[idxToken] !== token) continue;
    if (!toBooleanSafe(row[idxAtivo])) return null;
    const expira = new Date(row[idxExpires]);
    if (Number.isNaN(expira.getTime()) || expira <= new Date()) return null;

    const consultorId = row[idxConsultor];
    let tenantId = idxTenant >= 0 ? normalizeIdSafe(row[idxTenant]) : '';
    let perfil = idxPerfil >= 0 ? String(row[idxPerfil] || '').trim().toLowerCase() : '';
    const consultor = getConsultorById(consultorId);

    if (!tenantId) {
      tenantId = garantirTenantParaConsultor(consultorId, consultor && consultor.nome, consultor && consultor.plano_saas);
      if (idxTenant >= 0) sheetInfo.sheet.getRange(i + 2, idxTenant + 1).setValue(tenantId);
    }
    if (!perfil) {
      perfil = String((consultor && consultor.perfil) || 'owner').toLowerCase();
      if (idxPerfil >= 0) sheetInfo.sheet.getRange(i + 2, idxPerfil + 1).setValue(perfil);
    }

    return { consultor_id: consultorId, tenant_id: tenantId, perfil: perfil || 'owner' };
  }

  return null;
}

function temPermissao(perfil, modulo, acao) {
  const p = String(perfil || 'viewer').toLowerCase();
  const recursos = RBAC_PERMISSOES_PADRAO[p] || [];
  if (recursos.includes('*')) return true;
  const recurso = String(modulo || '') + '.' + String(acao || '');
  if (recursos.includes(recurso)) return true;
  if (recursos.includes(String(modulo || '') + '.*')) return true;
  return false;
}

/**
 * Cadastra consultor explicitamente
 */
function cadastrarConsultor(dados) {
  const { nome, email, senha } = dados || {};
  if (!nome || !email || !senha) return falha('Nome, e-mail e senha são obrigatórios');

  const emailHash = hashEmail(email);
  const senhaHash = hashEmail(senha);
  const sheetInfo = getSheetOrFail('consultores');
  if (sheetInfo.error) return sheetInfo.error;
  const sheet = sheetInfo.sheet;
  const snapshot = getSheetSnapshot(sheet);
  const headers = snapshot.headers;
  const idxHash = headers.indexOf('email_hash');

  if (idxHash < 0) return falha('Schema desatualizado em consultores. Execute setupSpreadsheet().');

  const jaExiste = snapshot.rows.some(r => r[idxHash] === emailHash);
  if (jaExiste) return falha('Já existe conta cadastrada para este e-mail');

  const uuid = gerarUUID();

  const tenantId = gerarUUID();
  const agora = new Date().toISOString();

  sheet.appendRow([
    uuid,
    tenantId,
    'owner',
    nome,
    email,
    emailHash,
    senhaHash,
    'Pro',
    agora,
    true,
    JSON.stringify({ tema: 'dark', notificacoes: true }),
    '',
    '',
    ''
  ]);

  const empresasInfo = getSheetOrFail('tb_empresas');
  if (!empresasInfo.error) {
    empresasInfo.sheet.appendRow([
      tenantId,
      nome + ' Org',
      'Pro',
      'active',
      5,
      200,
      agora,
      agora
    ]);
  }

  const token = criarSessao(uuid, emailHash, { tenant_id: tenantId, perfil: 'owner' });
  return {
    sucesso: true,
    consultor: { uuid, tenant_id: tenantId, perfil: 'owner', nome: nome, email: email, plano: 'Pro' },
    token,
    mensagem: 'Conta criada com sucesso'
  };
}


function solicitarResetSenha(dados) {
  try {
    const email = String((dados && dados.email) || '').trim();
    if (!email) return falha('Informe o e-mail para recuperação.');

    const sheetInfo = getSheetOrFail('consultores');
    if (sheetInfo.error) return sheetInfo.error;
    const sheet = sheetInfo.sheet;
    const snapshot = getSheetSnapshot(sheet);
    const headers = snapshot.headers;
    const idxEmail = headers.indexOf('email');
    const idxEmailHash = headers.indexOf('email_hash');
    const idxAtivo = headers.indexOf('ativo');
    const idxTokenHash = headers.indexOf('reset_token_hash');
    const idxExpira = headers.indexOf('reset_expira_iso');
    const idxSolicitado = headers.indexOf('reset_solicitado_em');

    if ([idxEmail, idxEmailHash, idxAtivo, idxTokenHash, idxExpira, idxSolicitado].some(i => i < 0)) {
      return falha('Schema desatualizado em consultores. Execute setupSpreadsheet().');
    }

    const emailHash = hashEmail(email);
    const rowIdx = snapshot.rows.findIndex(r => r[idxEmailHash] === emailHash && toBooleanSafe(r[idxAtivo]));

    // Sempre retorna sucesso para evitar enumeração de contas.
    if (rowIdx < 0) {
      logEstruturado('auth.reset.request.unknown_email', { email_hash: emailHash.slice(0, 8) + '...' }, 'WARN');
      return sucesso({ mensagem: 'Se o e-mail existir, enviaremos as instruções de recuperação.' });
    }

    const sheetRow = rowIdx + 2;
    const token = Utilities.base64EncodeWebSafe(gerarUUID() + ':' + new Date().getTime());
    const tokenHash = hashTexto(token);
    const expira = new Date(Date.now() + (60 * 60 * 1000)); // 1 hora

    sheet.getRange(sheetRow, idxTokenHash + 1).setValue(tokenHash);
    sheet.getRange(sheetRow, idxExpira + 1).setValue(expira.toISOString());
    sheet.getRange(sheetRow, idxSolicitado + 1).setValue(new Date().toISOString());

    const emailDestino = String(snapshot.rows[rowIdx][idxEmail] || email).trim();
    const appUrl = getWebAppUrlSafe();
    const linkReset = appUrl ? `${appUrl}?mode=reset&token=${encodeURIComponent(token)}` : '';

    const assunto = 'SAE Apollo — Recuperação de senha';
    const corpo = [
      `Olá,`,
      '',
      'Recebemos uma solicitação para redefinir sua senha no SAE.',
      `Código de recuperação: ${token}`,
      linkReset ? `Link direto: ${linkReset}` : 'Abra o SAE e selecione "Esqueci minha senha" para usar o código.',
      '',
      'Este código expira em 1 hora.',
      'Se você não solicitou a recuperação, ignore este e-mail.'
    ].join('\n');

    MailApp.sendEmail(emailDestino, assunto, corpo);
    logEstruturado('auth.reset.request.sent', { email_hash: emailHash.slice(0, 8) + '...' });
    return sucesso({ mensagem: 'Se o e-mail existir, enviaremos as instruções de recuperação.' });
  } catch (err) {
    logEstruturado('auth.reset.request.exception', { mensagem: err.message }, 'ERROR');
    return falha('Não foi possível processar a recuperação de senha.');
  }
}

function redefinirSenha(dados) {
  try {
    const token = String((dados && dados.token) || '').trim();
    const novaSenha = String((dados && dados.novaSenha) || '').trim();

    if (!token || !novaSenha) return falha('Token e nova senha são obrigatórios.');
    if (novaSenha.length < 6) return falha('A nova senha deve ter no mínimo 6 caracteres.');

    const sheetInfo = getSheetOrFail('consultores');
    if (sheetInfo.error) return sheetInfo.error;
    const sheet = sheetInfo.sheet;
    const snapshot = getSheetSnapshot(sheet);
    const headers = snapshot.headers;

    const idxSenha = headers.indexOf('senha_hash');
    const idxTokenHash = headers.indexOf('reset_token_hash');
    const idxExpira = headers.indexOf('reset_expira_iso');
    if ([idxSenha, idxTokenHash, idxExpira].some(i => i < 0)) {
      return falha('Schema desatualizado em consultores. Execute setupSpreadsheet().');
    }

    const tokenHash = hashTexto(token);
    const rowIdx = snapshot.rows.findIndex(r => r[idxTokenHash] === tokenHash);
    if (rowIdx < 0) return falha('Código de recuperação inválido.');

    const row = snapshot.rows[rowIdx];
    const expira = new Date(row[idxExpira]);
    if (Number.isNaN(expira.getTime()) || expira.getTime() < Date.now()) {
      return falha('Código de recuperação expirado. Solicite novamente.');
    }

    const sheetRow = rowIdx + 2;
    sheet.getRange(sheetRow, idxSenha + 1).setValue(hashEmail(novaSenha));
    sheet.getRange(sheetRow, idxTokenHash + 1).setValue('');
    sheet.getRange(sheetRow, idxExpira + 1).setValue('');

    logEstruturado('auth.reset.password.updated', { row: sheetRow });
    return sucesso({ mensagem: 'Senha redefinida com sucesso.' });
  } catch (err) {
    logEstruturado('auth.reset.password.exception', { mensagem: err.message }, 'ERROR');
    return falha('Não foi possível redefinir a senha.');
  }
}

/**
 * Cria sessão (token) para o consultor
 */
function criarSessao(consultorId, emailHash, contexto = {}) {
  const sheetInfo = getSheetOrFail('sessoes');
  if (sheetInfo.error) throw new Error(sheetInfo.error.erro);
  const sheet = sheetInfo.sheet;
  const token = Utilities.base64Encode(
    gerarUUID() + ':' + consultorId + ':' + new Date().getTime()
  );
  const expira = new Date();
  expira.setDate(expira.getDate() + 7); // 7 dias

  const agoraIso = new Date().toISOString();
  const tenantId = normalizeIdSafe(contexto.tenant_id) || (getConsultorById(consultorId) && normalizeIdSafe(getConsultorById(consultorId).tenant_id)) || '';
  const perfil = String(contexto.perfil || (getConsultorById(consultorId) && getConsultorById(consultorId).perfil) || 'owner').toLowerCase();

  sheet.appendRow([
    token, tenantId, consultorId, perfil, emailHash,
    agoraIso, expira.toISOString(), true
  ]);

  return token;
}

/**
 * Verifica se token de sessão é válido
 * Retorna consultorId ou null
 */
function verificarSessao(token) {
  const contexto = obterContextoSessao(token);
  return contexto ? contexto.consultor_id : null;
}

// ============================================================
// UTILITÁRIO: Leitura genérica de sheet → array de objetos
// ============================================================

/**
 * Converte uma aba em array de objetos (headers como chaves)
 * @param {Sheet} sheet
 * @param {Object} filtros - ex: { consultor_id: 'uuid-...' }
 */
function sheetParaObjetos(sheet, filtros = {}) {
  const snapshot = getSheetSnapshot(sheet);
  if (snapshot.rows.length === 0) return [];

  const headers = snapshot.headers;
  const rows = snapshot.rows;

  return rows
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    })
    .filter(obj => {
      // Filtra por critérios (multi-tenant)
      for (const [k, v] of Object.entries(filtros)) {
        if (obj[k] !== v) return false;
      }
      return obj.uuid; // ignora linhas vazias
    });
}

/**
 * Encontra a linha pelo UUID
 */
function encontrarLinha(sheet, uuid) {
  const snapshot = getSheetSnapshot(sheet);
  const headers = snapshot.headers;
  const idxUUID = headers.indexOf('uuid');
  if (idxUUID < 0) return null;

  for (let i = 0; i < snapshot.rows.length; i++) {
    if (snapshot.rows[i][idxUUID] === uuid) return { row: i + 2, headers, data: snapshot.rows[i] };
  }
  return null;
}

// ============================================================
// MÓDULO: CLIENTES
// ============================================================

/**
 * Busca todos os clientes do consultor
 * Multi-tenant: filtra por consultor_id
 */
function listarClientes(token, opts = {}) {
  const consultorId = verificarSessao(token);
  if (!consultorId) return falha('Sessão inválida');
  const contexto = obterContextoSessao(token);

  const pag = parsePaginacao(opts);
  const cacheVer = getConsultorCacheVersion(consultorId);
  const cacheKey = `clientes:${consultorId}:v${cacheVer}:t${(contexto && contexto.tenant_id) || 'legacy'}:p${pag.page}:s${pag.pageSize}:q${opts.query || ''}`;
  const cacheHit = getCacheJSON(cacheKey);
  if (cacheHit) {
    logEstruturado('clientes.listar.result', {
      fonte: 'cache',
      consultor_id: consultorId,
      tenant_id: contexto && contexto.tenant_id,
      page: pag.page,
      pageSize: pag.pageSize,
      total: cacheHit.paginacao && cacheHit.paginacao.total
    });
    return cacheHit;
  }

  const sheetInfo = getSheetOrFail('clientes');
  if (sheetInfo.error) return sheetInfo.error;
  const sheet = sheetInfo.sheet;

  const query = String(opts.query || '').toLowerCase().trim();
  const filtros = { consultor_id: consultorId };
  if (contexto && contexto.tenant_id) filtros.tenant_id = contexto.tenant_id;

  let clientes = sheetParaObjetos(sheet, filtros)
    .filter(c => c.status !== 'deleted');

  if (query) {
    clientes = clientes.filter(c =>
      String(c.empresa_nome || '').toLowerCase().includes(query) ||
      String(c.segmento || '').toLowerCase().includes(query) ||
      String(c.responsavel || '').toLowerCase().includes(query)
    );
  }

  const total = clientes.length;
  const itens = clientes.slice(pag.offset, pag.offset + pag.pageSize);
  const paginacao = {
    page: pag.page,
    pageSize: pag.pageSize,
    total,
    totalPages: Math.ceil(total / pag.pageSize) || 1
  };

  const resposta = { sucesso: true, clientes: itens, paginacao };
  setCacheJSON(cacheKey, resposta, CACHE_TTL_LISTA);
  return resposta;
}

/**
 * Cria ou atualiza um cliente
 */
function salvarCliente(token, dadosCliente) {
  const consultorId = verificarSessao(token);
  if (!consultorId) return falha('Sessão inválida');
  const contexto = obterContextoSessao(token);
  const tenantId = normalizeIdSafe(contexto && contexto.tenant_id) || garantirTenantParaConsultor(consultorId);

  const sheet = getSpreadsheet().getSheetByName('clientes');
  const agora = new Date().toISOString();

  if (dadosCliente.uuid) {
    // UPDATE
    const linha = encontrarLinha(sheet, dadosCliente.uuid);
    if (!linha) return falha('Cliente não encontrado');

    const headers = linha.headers;
    const rowIdx  = linha.row;

    // Atualiza campo por campo
    for (const [k, v] of Object.entries(dadosCliente)) {
      const col = headers.indexOf(k) + 1;
      if (col > 0) sheet.getRange(rowIdx, col).setValue(v);
    }
    invalidateConsultorCache(consultorId);
    return { sucesso: true, uuid: dadosCliente.uuid, acao: 'atualizado' };
  } else {
    // INSERT
    const uuid = gerarUUID();
    sheet.appendRow([
      uuid,
      tenantId,
      consultorId,
      dadosCliente.empresa_nome || '',
      dadosCliente.segmento || '',
      dadosCliente.responsavel || '',
      dadosCliente.email_contato || '',
      dadosCliente.telefone || '',
      dadosCliente.status || 'active',
      dadosCliente.mensalidade || 0,
      dadosCliente.data_inicio || agora,
      dadosCliente.maturidade || 0,
      dadosCliente.obs || '',
      agora
    ]);
    invalidateConsultorCache(consultorId);
    return { sucesso: true, uuid, acao: 'criado' };
  }
}

/**
 * Exclui um cliente (soft delete: altera status para 'deleted')
 */
function excluirCliente(token, clienteUUID) {
  const consultorId = verificarSessao(token);
  if (!consultorId) return falha('Sessão inválida');

  const sheet = getSpreadsheet().getSheetByName('clientes');
  const linha = encontrarLinha(sheet, clienteUUID);
  if (!linha) return falha('Cliente não encontrado');

  // Verifica isolamento multi-tenant
  const headers = linha.headers;
  const idxConsultor = headers.indexOf('consultor_id');
  if (linha.data[idxConsultor] !== consultorId) return falha('Acesso negado');

  const idxStatus = headers.indexOf('status') + 1;
  sheet.getRange(linha.row, idxStatus).setValue('deleted');
  invalidateConsultorCache(consultorId);
  return { sucesso: true };
}

// ============================================================
// MÓDULO: DIAGNÓSTICOS
// ============================================================

/**
 * Lista diagnósticos do consultor (ou de um cliente específico)
 */
function listarDiagnosticos(token, clienteId = null) {
  const consultorId = verificarSessao(token);
  if (!consultorId) return falha('Sessão inválida');

  const contexto = obterContextoSessao(token);
  const sheet = getSpreadsheet().getSheetByName('diagnosticos');
  const filtros = { consultor_id: consultorId };
  if (contexto && contexto.tenant_id) filtros.tenant_id = contexto.tenant_id;
  if (clienteId) filtros.cliente_id = clienteId;

  const diagnosticos = sheetParaObjetos(sheet, filtros).map(d => {
    // Parseia JSON das respostas e dimensões
    try { d.respostas = JSON.parse(d.respostas_json || '{}'); } catch(e) { d.respostas = {}; }
    try { d.dimensoes = JSON.parse(d.dimensoes_json || '[]'); } catch(e) { d.dimensoes = []; }
    return d;
  });

  return { sucesso: true, diagnosticos };
}

function atualizarMaturidadeCliente(consultorId, clienteId, score) {
  if (!clienteId) return;
  const sheetInfo = getSheetOrFail('clientes');
  if (sheetInfo.error) return;
  const sheet = sheetInfo.sheet;
  const linha = encontrarLinha(sheet, clienteId);
  if (!linha) return;
  const headers = linha.headers;
  const idxConsultor = headers.indexOf('consultor_id');
  const idxMaturidade = headers.indexOf('maturidade');
  if (idxMaturidade < 0) return;
  if (idxConsultor >= 0 && String(linha.data[idxConsultor] || '') !== String(consultorId || '')) return;
  sheet.getRange(linha.row, idxMaturidade + 1).setValue(toNumberSafe(score, 0));
}

/**
 * Salva um diagnóstico e calcula o score automaticamente
 */
function salvarDiagnostico(token, dados) {
  const consultorId = verificarSessao(token);
  if (!consultorId) return falha('Sessão inválida');

  const contexto = obterContextoSessao(token);
  const tenantId = normalizeIdSafe(contexto && contexto.tenant_id) || garantirTenantParaConsultor(consultorId);

  dados = dados || {};
  const clienteIdNormalizado = normalizeIdSafe(dados.cliente_id);
  if (!clienteIdNormalizado) return falha('Cliente é obrigatório para salvar diagnóstico.');

  const sheet = getSpreadsheet().getSheetByName('diagnosticos');
  const agora = new Date().toISOString();

  // Calcula score baseado nas respostas
  const { score, dimensoes } = calcularScore(dados.tipo_matriz, dados.respostas || {});

  if (dados.uuid) {
    // UPDATE
    const linha = encontrarLinha(sheet, dados.uuid);
    if (!linha) return falha('Diagnóstico não encontrado');
    const headers = linha.headers;
    sheet.getRange(linha.row, headers.indexOf('respostas_json') + 1).setValue(JSON.stringify(dados.respostas));
    sheet.getRange(linha.row, headers.indexOf('score') + 1).setValue(score);
    sheet.getRange(linha.row, headers.indexOf('dimensoes_json') + 1).setValue(JSON.stringify(dimensoes));
    sheet.getRange(linha.row, headers.indexOf('status') + 1).setValue('concluido');
    atualizarMaturidadeCliente(consultorId, clienteIdNormalizado, score);
    invalidateConsultorCache(consultorId);
    return { sucesso: true, score, dimensoes };
  } else {
    // INSERT
    const uuid = gerarUUID();
    sheet.appendRow([
      uuid,
      tenantId,
      clienteIdNormalizado,
      consultorId,
      dados.tipo_matriz,
      JSON.stringify(dados.respostas || {}),
      score,
      JSON.stringify(dimensoes),
      dados.observacoes || '',
      agora,
      'concluido'
    ]);
    atualizarMaturidadeCliente(consultorId, clienteIdNormalizado, score);
    invalidateConsultorCache(consultorId);
    return { sucesso: true, uuid, score, dimensoes };
  }
}

/**
 * Calcula score de maturidade por tipo de matriz
 */
function calcularScore(tipoMatriz, respostas) {
  const scores = Object.values(respostas).filter(v => typeof v === 'number');
  if (!scores.length) return { score: 0, dimensoes: [] };

  const max = 5; // escala de 1-5
  const score = Math.round(scores.reduce((a, b) => a + b, 0) / (scores.length * max) * 100);

  // Dimensões por tipo de diagnóstico
  const matrizes = {
    '5S': ['Seiri (Utilização)', 'Seiton (Organização)', 'Seiso (Limpeza)', 'Seiketsu (Padronização)', 'Shitsuke (Disciplina)'],
    'SWOT': ['Forças', 'Fraquezas', 'Oportunidades', 'Ameaças'],
    'Clima Organizacional': ['Motivação', 'Comunicação', 'Liderança', 'Cultura', 'Bem-estar'],
    'Processos': ['Mapeamento', 'Padronização', 'Controle', 'Melhoria', 'Automatização'],
    'Liderança': ['Visão', 'Comunicação', 'Delegação', 'Desenvolvimento', 'Resultados'],
  };

  const dimensaoNomes = matrizes[tipoMatriz] || ['D1', 'D2', 'D3', 'D4', 'D5'];
  const valoresArr = Object.values(respostas).filter(v => typeof v === 'number');

  const dimensoes = dimensaoNomes.map((nome, i) => ({
    nome,
    valor: valoresArr[i] ? Math.round(valoresArr[i] / max * 100) : 0
  }));

  return { score, dimensoes };
}

// ============================================================
// MÓDULO: TAREFAS 5W2H
// ============================================================

/**
 * Lista tarefas do consultor
 */
function listarTarefas(token, clienteId = null, opts = {}) {
  const consultorId = verificarSessao(token);
  if (!consultorId) return falha('Sessão inválida');

  const pag = parsePaginacao(opts);
  const cacheVer = getConsultorCacheVersion(consultorId);
  const contexto = obterContextoSessao(token);
  const cacheKey = `tarefas:${consultorId}:v${cacheVer}:t${(contexto && contexto.tenant_id) || 'legacy'}:${clienteId || 'all'}:p${pag.page}:s${pag.pageSize}`;
  const cacheHit = getCacheJSON(cacheKey);
  if (cacheHit) {
    logEstruturado('tarefas.listar.result', {
      fonte: 'cache',
      consultor_id: consultorId,
      cliente_id: normalizeIdSafe(clienteId) || 'all',
      page: pag.page,
      pageSize: pag.pageSize,
      total: cacheHit.paginacao && cacheHit.paginacao.total
    });
    return cacheHit;
  }

  const sheetInfo = getSheetOrFail('tarefas_5w2h');
  if (sheetInfo.error) return sheetInfo.error;
  const sheet = sheetInfo.sheet;
  const filtros = { consultor_id: consultorId };
  if (contexto && contexto.tenant_id) filtros.tenant_id = contexto.tenant_id;
  if (clienteId) filtros.cliente_id = clienteId;

  const lista = sheetParaObjetos(sheet, filtros)
    .map(t => {
      t.cliente_id = normalizeIdSafe(t.cliente_id);
      t.status = normalizeStatusTarefa(t.status);
      return t;
    })
    .filter(t => t.status !== 'deleted');
  const total = lista.length;
  const tarefas = lista.slice(pag.offset, pag.offset + pag.pageSize);
  const paginacao = {
    page: pag.page,
    pageSize: pag.pageSize,
    total,
    totalPages: Math.ceil(total / pag.pageSize) || 1
  };

  const resposta = { sucesso: true, tarefas, paginacao };
  logEstruturado('tarefas.listar.result', {
    fonte: 'sheet',
    consultor_id: consultorId,
    cliente_id: normalizeIdSafe(clienteId) || 'all',
    page: pag.page,
    pageSize: pag.pageSize,
    total,
    retornadas: tarefas.length
  });
  setCacheJSON(cacheKey, resposta, CACHE_TTL_LISTA);
  return resposta;
}

/**
 * Cria ou atualiza tarefa 5W2H
 */
function salvarTarefa(token, dados) {
  const consultorId = verificarSessao(token);
  if (!consultorId) return falha('Sessão inválida');

  const contexto = obterContextoSessao(token);
  const tenantId = normalizeIdSafe(contexto && contexto.tenant_id) || garantirTenantParaConsultor(consultorId);

  dados = dados || {};
  const clienteIdNormalizado = normalizeIdSafe(dados.cliente_id);
  const statusNormalizado = normalizeStatusTarefa(dados.status);

  if (!dados.uuid && !clienteIdNormalizado) {
    return falha('Cliente é obrigatório para criar tarefa. Selecione um cliente no formulário.');
  }
  if (!dados.descricao && !dados.uuid) {
    return falha('Descrição da tarefa é obrigatória.');
  }

  const sheetInfo = getSheetOrFail('tarefas_5w2h');
  if (sheetInfo.error) return sheetInfo.error;
  const sheet = sheetInfo.sheet;
  const agora = new Date().toISOString();

  if (dados.uuid) {
    const linha = encontrarLinha(sheet, dados.uuid);
    if (!linha) return { erro: 'Tarefa não encontrada' };

    // Validação multi-tenant
    if (linha.data[linha.headers.indexOf('consultor_id')] !== consultorId) {
      return { erro: 'Acesso negado' };
    }

    const headers = linha.headers;
    const campos = ['descricao','responsavel','prazo_iso','onde','porque','como','custo','indicador','status','tipo','evidencia'];
    campos.forEach(c => {
      if (dados[c] !== undefined) {
        sheet.getRange(linha.row, headers.indexOf(c) + 1).setValue(c === 'status' ? statusNormalizado : dados[c]);
      }
    });
    sheet.getRange(linha.row, headers.indexOf('updated_at') + 1).setValue(agora);
    invalidateConsultorCache(consultorId);
    return { sucesso: true, uuid: dados.uuid, acao: 'atualizado' };
  } else {
    const uuid = gerarUUID();
    sheet.appendRow([
      uuid,
      tenantId,
      clienteIdNormalizado,
      consultorId,
      dados.descricao || '',
      dados.responsavel || '',
      dados.prazo_iso || '',
      dados.onde || '',
      dados.porque || '',
      dados.como || '',
      dados.custo || '',
      dados.indicador || '',
      statusNormalizado,
      dados.tipo || 'Processo',
      dados.evidencia || '',
      agora,
      agora
    ]);
    invalidateConsultorCache(consultorId);
    return { sucesso: true, uuid, acao: 'criado' };
  }
}


function sanearTarefas5w2h(opcoes = {}) {
  const dryRun = toBooleanSafe(opcoes.dryRun);
  const marcadorSemCliente = 'PENDENTE_VINCULO_CLIENTE';

  const sheetInfo = getSheetOrFail('tarefas_5w2h');
  if (sheetInfo.error) return sheetInfo.error;
  const sheet = sheetInfo.sheet;
  const snapshot = getSheetSnapshot(sheet);
  if (snapshot.rows.length === 0) return sucesso({ total: 0, alteradas: 0, semCliente: 0, statusesNormalizados: 0 });

  const headers = snapshot.headers;
  const idxCliente = headers.indexOf('cliente_id');
  const idxStatus = headers.indexOf('status');
  const idxEvid = headers.indexOf('evidencia');
  const idxUpdated = headers.indexOf('updated_at');
  if ([idxCliente, idxStatus, idxEvid, idxUpdated].some(i => i < 0)) {
    return falha('Schema desatualizado em tarefas_5w2h. Execute setupSpreadsheet().');
  }

  let alteradas = 0;
  let semCliente = 0;
  let statusesNormalizados = 0;
  const agora = new Date().toISOString();

  snapshot.rows.forEach((row, i) => {
    const sheetRow = i + 2;
    const clienteAtual = normalizeIdSafe(row[idxCliente]);
    const statusAtual = String(row[idxStatus] || '');
    const statusNovo = normalizeStatusTarefa(statusAtual);
    let changed = false;

    if (statusNovo !== statusAtual) {
      statusesNormalizados += 1;
      changed = true;
      if (!dryRun) sheet.getRange(sheetRow, idxStatus + 1).setValue(statusNovo);
    }

    if (!clienteAtual) {
      semCliente += 1;
      changed = true;
      if (!dryRun) {
        sheet.getRange(sheetRow, idxCliente + 1).setValue(marcadorSemCliente);
        const evid = String(row[idxEvid] || '').trim();
        const tag = '[PENDENTE_VINCULO_CLIENTE]';
        if (!evid.includes(tag)) {
          sheet.getRange(sheetRow, idxEvid + 1).setValue((evid ? evid + ' ' : '') + tag);
        }
      }
    }

    if (changed) {
      alteradas += 1;
      if (!dryRun) sheet.getRange(sheetRow, idxUpdated + 1).setValue(agora);
    }
  });

  return sucesso({
    total: snapshot.rows.length,
    alteradas,
    semCliente,
    statusesNormalizados,
    marcadorSemCliente,
    dryRun
  });
}

/**
 * Move tarefa no Kanban (atualiza status)
 */
function moverTarefa(token, tarefaUUID, novoStatus) {
  const statusValidos = ['iniciar', 'execucao', 'validando', 'concluido'];
  if (!statusValidos.includes(novoStatus)) return { erro: 'Status inválido' };

  return salvarTarefa(token, { uuid: tarefaUUID, status: novoStatus });
}

/**
 * Adiciona evidência de conclusão
 */
function adicionarEvidencia(token, tarefaUUID, evidencia) {
  return salvarTarefa(token, {
    uuid: tarefaUUID,
    evidencia: evidencia,
    status: 'validando'
  });
}

// ============================================================
// MÓDULO: FINANCEIRO
// ============================================================

/**
 * Lista registros financeiros
 */
function listarFinanceiro(token, clienteId = null) {
  const consultorId = verificarSessao(token);
  if (!consultorId) return falha('Sessão inválida');

  const contexto = obterContextoSessao(token);
  const sheetInfo = getSheetOrFail('financeiro');
  if (sheetInfo.error) return sheetInfo.error;
  const sheet = sheetInfo.sheet;
  const filtros = { consultor_id: consultorId };
  if (contexto && contexto.tenant_id) filtros.tenant_id = contexto.tenant_id;
  if (clienteId) filtros.cliente_id = clienteId;

  const registros = sheetParaObjetos(sheet, filtros);

  // Calcula totais
  const pago = registros.filter(r => r.pago === true || r.pago === 'TRUE');
  const pendente = registros.filter(r => r.pago !== true && r.pago !== 'TRUE');

  const totalPago = pago.reduce((acc, r) => acc + (parseFloat(r.valor_mensalidade) || 0), 0);
  const totalPendente = pendente.reduce((acc, r) => acc + (parseFloat(r.valor_mensalidade) || 0), 0);

  return {
    sucesso: true,
    registros,
    resumo: {
      totalPago: totalPago.toFixed(2),
      totalPendente: totalPendente.toFixed(2),
      totalGeral: (totalPago + totalPendente).toFixed(2),
      qtdClientes: new Set(registros.map(r => r.cliente_id)).size
    }
  };
}

/**
 * Registra pagamento de mensalidade
 */
function registrarMensalidade(token, dados) {
  const consultorId = verificarSessao(token);
  if (!consultorId) return falha('Sessão inválida');
  const contexto = obterContextoSessao(token);
  const tenantId = normalizeIdSafe(contexto && contexto.tenant_id) || garantirTenantParaConsultor(consultorId);
  const clienteIdNormalizado = normalizeIdSafe(dados && dados.cliente_id);

  const sheet = getSpreadsheet().getSheetByName('financeiro');
  const agora = new Date().toISOString();

  if (dados.uuid) {
    // Marcar como pago
    const linha = encontrarLinha(sheet, dados.uuid);
    if (!linha) return { erro: 'Registro não encontrado' };
    const headers = linha.headers;
    sheet.getRange(linha.row, headers.indexOf('pago') + 1).setValue(true);
    sheet.getRange(linha.row, headers.indexOf('data_pagamento') + 1).setValue(agora);
    if (dados.metodo) {
      sheet.getRange(linha.row, headers.indexOf('metodo_pagamento') + 1).setValue(dados.metodo);
    }
    invalidateConsultorCache(consultorId);
    return { sucesso: true };
  } else {
    // Novo registro
    const uuid = gerarUUID();
    sheet.appendRow([
      uuid,
      tenantId,
      clienteIdNormalizado,
      consultorId,
      dados.valor_mensalidade || 0,
      dados.data_vencimento || agora,
      dados.pago ? agora : '',
      dados.pago || false,
      dados.metodo_pagamento || '',
      dados.obs || '',
      agora
    ]);
    invalidateConsultorCache(consultorId);
    return { sucesso: true, uuid };
  }
}

// ============================================================
// MÓDULO: PORTAL DO CLIENTE
// ============================================================

/**
 * Serve o HTML do portal do cliente
 * Acesso via: ?page=portal&token=BASE64TOKEN&consultor=email
 */
function servirPortalCliente(tokenCliente, consultorEmail) {
  if (!tokenCliente) {
    return HtmlService.createHtmlOutput('<h2>Link inválido</h2>');
  }

  try {
    const clienteId = Utilities.newBlob(
      Utilities.base64Decode(tokenCliente)
    ).getDataAsString();

    const dados = getDadosPortalCliente(clienteId);
    if (!dados) return HtmlService.createHtmlOutput('<h2>Cliente não encontrado</h2>');

    const html = gerarHTMLPortalCliente(dados);
    return HtmlService.createHtmlOutput(html)
      .setTitle('Portal — ' + dados.empresa_nome)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return HtmlService.createHtmlOutput('<h2>Erro: ' + err.message + '</h2>');
  }
}

/**
 * Gera link válido do portal do cliente usando URL real do Web App
 */
function gerarLinkPortalCliente(token, clienteId) {
  const consultorId = verificarSessao(token);
  if (!consultorId) return falha('Sessão inválida');
  if (!clienteId) return falha('Cliente obrigatório');

  const sheetInfo = getSheetOrFail('clientes');
  if (sheetInfo.error) return sheetInfo.error;
  const linha = encontrarLinha(sheetInfo.sheet, clienteId);
  if (!linha) return falha('Cliente não encontrado');

  const idxConsultor = linha.headers.indexOf('consultor_id');
  if (idxConsultor < 0 || linha.data[idxConsultor] !== consultorId) return falha('Acesso negado');

  const idxEmail = linha.headers.indexOf('email_contato');
  const consultorEmail = idxEmail >= 0 ? String(linha.data[idxEmail] || '') : '';
  const tokenCliente = Utilities.base64Encode(clienteId);
  const baseUrl = ScriptApp.getService().getUrl();
  if (!baseUrl) return falha('URL do Web App indisponível. Publique uma versão do aplicativo.');

  const url = baseUrl + '?page=portal&token=' + encodeURIComponent(tokenCliente) + '&consultor=' + encodeURIComponent(consultorEmail);
  return { sucesso: true, url, token_cliente: tokenCliente };
}

/**
 * Busca dados completos de um cliente para o portal
 */
function getDadosPortalCliente(clienteId) {
  const ssClientes = getSpreadsheet().getSheetByName('clientes');
  const clientes = sheetParaObjetos(ssClientes);
  const cliente = clientes.find(c => c.uuid === clienteId);
  if (!cliente) return null;

  const ssTarefas = getSpreadsheet().getSheetByName('tarefas_5w2h');
  const tarefas = sheetParaObjetos(ssTarefas, { cliente_id: clienteId });

  const ssDiag = getSpreadsheet().getSheetByName('diagnosticos');
  const diagnosticos = sheetParaObjetos(ssDiag, { cliente_id: clienteId });

  return { cliente, tarefas, diagnosticos };
}

/**
 * Gera HTML limpo para o portal do cliente
 */
function gerarHTMLPortalCliente(dados) {
  const { cliente, tarefas, diagnosticos } = dados;

  const concluidas = tarefas.filter(t => t.status === 'concluido').length;
  const progresso = tarefas.length > 0 ? Math.round(concluidas / tarefas.length * 100) : 0;

  const tarefasHTML = tarefas.slice(0, 10).map(t => `
    <tr>
      <td>${t.descricao}</td>
      <td>${t.responsavel}</td>
      <td>${t.prazo_iso ? new Date(t.prazo_iso).toLocaleDateString('pt-BR') : '—'}</td>
      <td><span class="badge badge-${t.status}">${t.status}</span></td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Portal — ${cliente.empresa_nome}</title>
<style>
  body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #f1f5f9; margin: 0; padding: 20px; }
  .container { max-width: 800px; margin: 0 auto; }
  .header { text-align: center; padding: 40px 20px; background: rgba(99,102,241,0.1); border-radius: 16px; margin-bottom: 24px; }
  .company { font-size: 28px; font-weight: 800; }
  .card { background: rgba(30,41,59,0.8); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .progress-bar { height: 8px; background: rgba(255,255,255,0.06); border-radius: 4px; overflow: hidden; margin-top: 8px; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 4px; }
  .score { font-size: 48px; font-weight: 800; color: #6366f1; text-align: center; }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 8px; text-align: left; font-size: 11px; color: #64748b; border-bottom: 1px solid rgba(255,255,255,0.06); }
  td { padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; color: #94a3b8; }
  .badge { padding: 3px 8px; border-radius: 12px; font-size: 10px; font-weight: 700; }
  .badge-concluido { background: rgba(16,185,129,0.2); color: #10b981; }
  .badge-execucao { background: rgba(99,102,241,0.2); color: #6366f1; }
  .badge-iniciar { background: rgba(148,163,184,0.1); color: #64748b; }
  .badge-validando { background: rgba(245,158,11,0.2); color: #f59e0b; }
  footer { text-align: center; color: #334155; font-size: 11px; margin-top: 40px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div style="font-size:36px;margin-bottom:8px;">🏢</div>
    <div class="company">${cliente.empresa_nome}</div>
    <div style="color:#64748b;margin-top:6px;">Painel de Progresso · Consultoria Organizacional</div>
  </div>

  <div class="card">
    <h3 style="margin:0 0 16px;font-size:16px;">📈 Progresso Geral</h3>
    <div class="score">${cliente.maturidade || progresso}%</div>
    <p style="text-align:center;color:#64748b;margin-top:4px;">Maturidade Organizacional</p>
    <div class="progress-bar">
      <div class="progress-fill" style="width:${cliente.maturidade || progresso}%"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:16px;font-size:12px;color:#64748b;">
      <span>✅ ${concluidas} concluídas</span>
      <span>📋 ${tarefas.length} tarefas total</span>
      <span>⏳ ${tarefas.length - concluidas} pendentes</span>
    </div>
  </div>

  <div class="card">
    <h3 style="margin:0 0 16px;font-size:16px;">📋 Plano de Ação</h3>
    <table>
      <thead><tr><th>Ação</th><th>Responsável</th><th>Prazo</th><th>Status</th></tr></thead>
      <tbody>${tarefasHTML}</tbody>
    </table>
  </div>

  <footer>
    Gerado por SAE — Sistema Apollo Enterprise · ${new Date().toLocaleDateString('pt-BR')}
  </footer>
</div>
</body>
</html>`;
}

// ============================================================
// MÓDULO: RELATÓRIOS (PDF via HtmlService)
// ============================================================

/**
 * Gera relatório HTML otimizado para PDF
 * No frontend: google.script.run.gerarRelatorio(token, clienteId, tipo)
 * O retorno é uma URL de blob ou o HTML para impressão
 */
function gerarRelatorio(token, clienteId, tipo) {
  const consultorId = verificarSessao(token);
  if (!consultorId) return falha('Sessão inválida');

  const dados = getDadosPortalCliente(clienteId);
  if (!dados) return { erro: 'Cliente não encontrado' };

  // Gera HTML do relatório baseado no tipo
  let htmlRelatorio;
  switch (tipo) {
    case 'executivo':
      htmlRelatorio = gerarHTMLRelatorioExecutivo(dados);
      break;
    case 'progresso':
      htmlRelatorio = gerarHTMLRelatorioProgresso(dados);
      break;
    case 'diagnostico':
      htmlRelatorio = gerarHTMLRelatorioDiagnostico(dados);
      break;
    default:
      htmlRelatorio = gerarHTMLPortalCliente(dados);
  }

  // Cria arquivo PDF real no Google Drive
  try {
    const htmlBlob = Utilities.newBlob(htmlRelatorio, 'text/html', 'relatorio.html');
    const pdfBlob = htmlBlob.getAs('application/pdf');

    const dataNome = new Date().toISOString().slice(0, 10);
    const nomeBase = 'SAE_' + tipo + '_' + String(dados.cliente.empresa_nome || 'cliente').replace(/[\\/:*?"<>|]/g, '_') + '_' + dataNome;
    pdfBlob.setName(nomeBase + '.pdf');

    const folder = getOrCreateFolder('SAE_Relatorios');
    const arquivo = folder.createFile(pdfBlob);

    const downloadUrl = 'https://drive.google.com/uc?export=download&id=' + arquivo.getId();
    const previewUrl = 'https://drive.google.com/file/d/' + arquivo.getId() + '/view';

    return {
      sucesso: true,
      url: downloadUrl,
      preview_url: previewUrl,
      mime: 'application/pdf',
      nomeArquivo: arquivo.getName(),
      file_name: arquivo.getName(),
      base64_pdf: Utilities.base64Encode(pdfBlob.getBytes())
    };
  } catch (err) {
    // Fallback: retorna HTML direto para impressão no browser
    return { sucesso: true, html: htmlRelatorio };
  }
}

function gerarHTMLRelatorioExecutivo(dados) {
  const { cliente, tarefas } = dados;
  const concluidas = tarefas.filter(t => t.status === 'concluido').length;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Relatório Executivo — ${cliente.empresa_nome}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #1e293b; }
  h1 { color: #6366f1; border-bottom: 2px solid #6366f1; padding-bottom: 12px; }
  .kpi { display: inline-block; padding: 16px 24px; border: 1px solid #e2e8f0; border-radius: 8px; margin: 8px; text-align: center; }
  .kpi strong { display: block; font-size: 28px; color: #6366f1; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 10px; border: 1px solid #e2e8f0; text-align: left; font-size: 13px; }
  th { background: #f8fafc; }
</style>
</head>
<body>
<h1>🐾 SAE — Relatório Executivo</h1>
<h2>${cliente.empresa_nome}</h2>
<p>Segmento: ${cliente.segmento} | Consultor: ${cliente.consultor_id}</p>
<p>Data: ${new Date().toLocaleDateString('pt-BR')}</p>

<h3>KPIs do Projeto</h3>
<div>
  <div class="kpi"><strong>${cliente.maturidade || 0}%</strong>Maturidade</div>
  <div class="kpi"><strong>${tarefas.length}</strong>Total de Ações</div>
  <div class="kpi"><strong>${concluidas}</strong>Concluídas</div>
  <div class="kpi"><strong>${tarefas.length - concluidas}</strong>Pendentes</div>
</div>

<h3>Plano de Ação</h3>
<table>
  <tr><th>Ação</th><th>Responsável</th><th>Prazo</th><th>Status</th></tr>
  ${tarefas.map(t => `<tr><td>${t.descricao}</td><td>${t.responsavel}</td><td>${t.prazo_iso}</td><td>${t.status}</td></tr>`).join('')}
</table>

<p style="text-align:center;color:#64748b;margin-top:40px;font-size:11px;">
  SAE — Sistema Apollo Enterprise · Gerado em ${new Date().toLocaleString('pt-BR')}
</p>
</body></html>`;
}

function gerarHTMLRelatorioProgresso(dados) {
  return gerarHTMLRelatorioExecutivo(dados); // Base para MVP
}

function gerarHTMLRelatorioDiagnostico(dados) {
  const { cliente, diagnosticos } = dados;
  const diagsHTML = diagnosticos.map(d => {
    let dims = [];
    try { dims = JSON.parse(d.dimensoes_json || '[]'); } catch(e) {}
    return `
      <h4>${d.tipo_matriz} — Score: ${d.score}%</h4>
      <ul>${dims.map(x => `<li>${x.nome}: ${x.valor}%</li>`).join('')}</ul>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Diagnóstico — ${cliente.empresa_nome}</title>
<style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px;color:#1e293b;}h1{color:#6366f1;}</style>
</head><body>
<h1>🔍 Diagnóstico Organizacional</h1>
<h2>${cliente.empresa_nome}</h2>
<p>Data: ${new Date().toLocaleDateString('pt-BR')}</p>
${diagsHTML || '<p>Nenhum diagnóstico disponível.</p>'}
<p style="text-align:center;color:#64748b;margin-top:40px;font-size:11px;">SAE — Sistema Apollo Enterprise</p>
</body></html>`;
}

/**
 * Helper: obtém ou cria pasta no Google Drive
 */
function getOrCreateFolder(nome) {
  const folders = DriveApp.getFoldersByName(nome);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(nome);
}

// ============================================================
// DASHBOARD — KPIs consolidados
// ============================================================

/**
 * Retorna todos os KPIs do dashboard de governança
 */
function getDashboardKPIs(token) {
  const consultorId = verificarSessao(token);
  if (!consultorId) return falha('Sessão inválida');

  const cacheVer = getConsultorCacheVersion(consultorId);
  const cacheKey = `dashboard:kpis:${consultorId}:v${cacheVer}`;
  const cacheHit = getCacheJSON(cacheKey);
  if (cacheHit) {
    logEstruturado('dashboard.kpis.result', { fonte: 'cache', consultor_id: consultorId });
    return cacheHit;
  }

  const cInfo = getSheetOrFail('clientes');
  const tInfo = getSheetOrFail('tarefas_5w2h');
  const fInfo = getSheetOrFail('financeiro');
  if (cInfo.error) return cInfo.error;
  if (tInfo.error) return tInfo.error;
  if (fInfo.error) return fInfo.error;

  const clientes = sheetParaObjetos(cInfo.sheet, { consultor_id: consultorId })
    .filter(c => c.status !== 'deleted');
  const tarefas  = sheetParaObjetos(tInfo.sheet, { consultor_id: consultorId });
  const financeiro = sheetParaObjetos(fInfo.sheet, { consultor_id: consultorId });

  const clientesAtivos = clientes.filter(c => c.status === 'active').length;
  const tarefasConcluidas = tarefas.filter(t => t.status === 'concluido').length;
  const tarefasAbertas = tarefas.filter(t => t.status !== 'concluido').length;

  const receitaMensal = financeiro
    .filter(f => toBooleanSafe(f.pago))
    .reduce((acc, f) => acc + toNumberSafe(f.valor_mensalidade, 0), 0);

  const maturidadeMedia = clientes.length > 0
    ? Math.round(clientes.reduce((acc, c) => acc + toNumberSafe(c.maturidade, 0), 0) / clientes.length)
    : 0;

  const resposta = {
    sucesso: true,
    kpis: {
      clientesAtivos,
      tarefasConcluidas,
      tarefasAbertas,
      receitaMensal: receitaMensal.toFixed(2),
      maturidadeMedia,
      totalClientes: clientes.length
    }
  };

  setCacheJSON(cacheKey, resposta, CACHE_TTL_KPIS);
  return resposta;
}


function adminObterTenant(token) {
  const contexto = obterContextoSessao(token);
  if (!contexto || !contexto.tenant_id) return falha('Sessão inválida');
  const sheetInfo = getSheetOrFail('tb_empresas');
  if (sheetInfo.error) return sheetInfo.error;
  const empresas = sheetParaObjetos(sheetInfo.sheet, { tenant_id: contexto.tenant_id });
  return sucesso({ tenant: empresas[0] || null });
}

function adminListarUsuarios(token, opts = {}) {
  const contexto = obterContextoSessao(token);
  if (!contexto || !contexto.tenant_id) return falha('Sessão inválida');
  const sheetInfo = getSheetOrFail('consultores');
  if (sheetInfo.error) return sheetInfo.error;

  const query = String(opts.query || '').toLowerCase().trim();
  let usuarios = sheetParaObjetos(sheetInfo.sheet, { tenant_id: contexto.tenant_id })
    .map(function(u) {
      return {
        uuid: u.uuid,
        tenant_id: u.tenant_id,
        nome: u.nome,
        email: u.email,
        perfil: u.perfil || 'viewer',
        plano_saas: u.plano_saas,
        ativo: toBooleanSafe(u.ativo),
        data_adesao: u.data_adesao
      };
    });

  if (query) {
    usuarios = usuarios.filter(function(u) {
      return String(u.nome || '').toLowerCase().includes(query) || String(u.email || '').toLowerCase().includes(query);
    });
  }

  return sucesso({ usuarios: usuarios, total: usuarios.length });
}

// ============================================================
// INTEGRAÇÃO FRONTEND-BACKEND via google.script.run
// ============================================================

/**
 * Função unificada para chamar qualquer módulo do backend
 * Reduz o boilerplate no frontend
 *
 * Uso no frontend:
 *   google.script.run
 *     .withSuccessHandler(cb)
 *     .api({ modulo: 'clientes', acao: 'listar', token: '...' })
 */
function api(params) {
  const { modulo, acao, token, dados } = params || {};

  const roteamento = {
    auth: {
      login: () => autenticarConsultor(dados),
      cadastro: () => cadastrarConsultor(dados),
      solicitarReset: () => solicitarResetSenha(dados),
      redefinirSenha: () => redefinirSenha(dados),
      verificar: () => { const ctx = obterContextoSessao(token); return { sucesso: !!ctx, consultor_id: ctx && ctx.consultor_id, tenant_id: ctx && ctx.tenant_id, perfil: ctx && ctx.perfil }; },
    },
    clientes: {
      listar: () => listarClientes(token, dados || {}),
      salvar: () => salvarCliente(token, dados),
      excluir: () => excluirCliente(token, dados.uuid),
    },
    diagnosticos: {
      listar: () => listarDiagnosticos(token, dados?.cliente_id),
      salvar: () => salvarDiagnostico(token, dados),
    },
    tarefas: {
      listar: () => listarTarefas(token, dados?.cliente_id, dados || {}),
      salvar: () => salvarTarefa(token, dados),
      mover:  () => moverTarefa(token, dados.uuid, dados.status),
      evidencia: () => adicionarEvidencia(token, dados.uuid, dados.evidencia),
    },
    financeiro: {
      listar: () => listarFinanceiro(token, dados?.cliente_id),
      registrar: () => registrarMensalidade(token, dados),
    },
    dashboard: {
      kpis: () => getDashboardKPIs(token),
    },
    relatorios: {
      gerar: () => gerarRelatorio(token, dados.cliente_id, dados.tipo),
    },
    portal: {
      link: () => gerarLinkPortalCliente(token, dados && dados.cliente_id),
    },
    setup: {
      executar: () => setupSpreadsheet(),
      validarSchema: () => sucesso(validarSchemaAbas()),
      sanearTarefas: () => sanearTarefas5w2h(dados || {}),
    },
    admin: {
      tenantObter: () => adminObterTenant(token),
      usuariosListar: () => adminListarUsuarios(token, dados || {})
    }
  };

  try {
    const acoesPublicas = {
      auth: { login: true, cadastro: true, solicitarReset: true, redefinirSenha: true, verificar: true },
      setup: { validarSchema: true, executar: true }
    };

    const publico = !!(acoesPublicas[modulo] && acoesPublicas[modulo][acao]);
    let contexto = null;
    if (!publico) {
      contexto = obterContextoSessao(token);
      if (!contexto || !contexto.consultor_id) return falha('Sessão inválida');
      if (!temPermissao(contexto.perfil, modulo, acao)) {
        return falha('Acesso negado: permissão insuficiente.', { codigo: 'forbidden', perfil: contexto.perfil, modulo, acao });
      }
    }

    const fn = roteamento[modulo]?.[acao];
    if (!fn) {
      registrarTelemetria('api', 'rota_nao_encontrada');
      return falha(`Rota não encontrada: ${modulo}.${acao}`);
    }

    const raw = fn();
    if (raw && raw.sucesso === true) {
      if (raw.dados !== undefined) return raw;
      const payload = Object.assign({}, raw);
      delete payload.sucesso;
      return sucesso(payload, payload);
    }
    if (raw && raw.erro) {
      registrarTelemetria(modulo || 'api', 'erro_negocio');
      return falha(raw.erro, raw);
    }
    return sucesso(raw || {});
  } catch (err) {
    registrarTelemetria(modulo || 'api', 'exception');
    logEstruturado('api.exception', { modulo, acao, mensagem: err.message }, 'ERROR');
    return falha(err.message);
  }
}

// ============================================================
// TESTES DE CONTRATO DA API (Fase 4)
// ============================================================

function runApiContractTests() {
  const resultados = [];

  function expect(cond, nome, detalhe) {
    resultados.push({ nome, ok: !!cond, detalhe: detalhe || '' });
  }

  const unknown = api({ modulo: 'x', acao: 'y' });
  expect(unknown.sucesso === false && !!unknown.erro, 'rota_invalida', JSON.stringify(unknown));

  const authMissing = api({ modulo: 'auth', acao: 'login', dados: {} });
  expect(authMissing.sucesso === false && /Campos obrigatórios/.test(authMissing.erro || ''), 'auth_login_payload_obrigatorio', JSON.stringify(authMissing));

  const authVerificarSemToken = api({ modulo: 'auth', acao: 'verificar', token: '' });
  expect(authVerificarSemToken && authVerificarSemToken.sucesso === false, 'auth_verificar_sem_token_falha', JSON.stringify(authVerificarSemToken));

  const modulos = [
    ['clientes', 'listar'], ['clientes', 'salvar'], ['clientes', 'excluir'],
    ['diagnosticos', 'listar'], ['diagnosticos', 'salvar'],
    ['tarefas', 'listar'], ['tarefas', 'salvar'], ['tarefas', 'mover'],
    ['financeiro', 'listar'], ['financeiro', 'registrar'],
    ['dashboard', 'kpis'], ['relatorios', 'gerar']
  ];

  modulos.forEach(([modulo, acao]) => {
    const res = api({ modulo, acao, token: 'token_invalido', dados: {} });
    expect(typeof res.sucesso === 'boolean', `contrato_${modulo}_${acao}_sucesso_bool`, JSON.stringify(res));
    if (res.sucesso === false) {
      expect(typeof res.erro === 'string' && res.erro.length > 0, `contrato_${modulo}_${acao}_erro_string`, JSON.stringify(res));
    }
  });


  let tokenValido = null;
  let clienteId = null;
  let tarefaId = null;
  const emailTeste = 'contract.tarefas@sae.app';
  const senhaTeste = 'Contrato#2026';

  const cadastro = cadastrarConsultor({ nome: 'Contract Bot', email: emailTeste, senha: senhaTeste });
  if (cadastro && cadastro.sucesso) {
    tokenValido = cadastro.token;
  } else {
    const login = autenticarConsultor({ email: emailTeste, senha: senhaTeste });
    if (login && login.sucesso) tokenValido = login.token;
  }

  if (tokenValido) {
    const cliente = salvarCliente(tokenValido, {
      empresa_nome: 'Cliente Contrato API',
      segmento: 'Teste',
      status: 'active',
      responsavel: 'QA Contract'
    });
    if (cliente && cliente.sucesso) clienteId = cliente.uuid;

    const salvarSemCliente = api({
      modulo: 'tarefas',
      acao: 'salvar',
      token: tokenValido,
      dados: { descricao: 'Teste sem cliente', status: 'iniciar' }
    });
    expect(
      salvarSemCliente && salvarSemCliente.sucesso === false && /Cliente é obrigatório/i.test(salvarSemCliente.erro || ''),
      'tarefas_salvar_sem_cliente_id_falha',
      JSON.stringify(salvarSemCliente)
    );

    if (clienteId) {
      const tarefa = salvarTarefa(tokenValido, {
        cliente_id: clienteId,
        descricao: 'Tarefa contrato listar não vazio',
        responsavel: 'QA',
        status: 'iniciar',
        tipo: 'Processo'
      });
      if (tarefa && tarefa.sucesso) tarefaId = tarefa.uuid;
    }

    const listarValido = api({
      modulo: 'tarefas',
      acao: 'listar',
      token: tokenValido,
      dados: { page: 1, pageSize: 50, cliente_id: clienteId }
    });

    expect(
      listarValido && listarValido.sucesso === true && Array.isArray(listarValido.tarefas) && listarValido.tarefas.length > 0,
      'tarefas_listar_token_valido_retorna_nao_vazio',
      JSON.stringify({ sucesso: listarValido && listarValido.sucesso, total: listarValido && listarValido.tarefas ? listarValido.tarefas.length : 0, clienteId, tarefaId })
    );
  } else {
    expect(false, 'tarefas_listar_token_valido_retorna_nao_vazio', 'Não foi possível criar/login usuário de contrato');
  }

  const schemaCheck = api({ modulo: 'setup', acao: 'validarSchema' });
  expect(schemaCheck && typeof schemaCheck.sucesso === 'boolean', 'setup_validarSchema_contrato', JSON.stringify(schemaCheck));

  const aprovados = resultados.filter(r => r.ok).length;
  const reprovados = resultados.length - aprovados;

  return {
    sucesso: reprovados === 0,
    resumo: { total: resultados.length, aprovados, reprovados },
    resultados
  };
}

// ============================================================
// EXEMPLO DE USO NO FRONTEND (index.html / Vue.js)
// ============================================================
/*

// ========= AUTENTICAÇÃO =========
google.script.run
  .withSuccessHandler(function(res) {
    if (res.sucesso) {
      sessionToken = res.token;
      consultorAtual = res.consultor;
      carregarDashboard();
    } else {
      mostrarErro(res.erro);
    }
  })
  .autenticarConsultor({ email: loginEmail, senha: loginPass });


// ========= LISTAR CLIENTES =========
google.script.run
  .withSuccessHandler(function(res) {
    if (res.sucesso) {
      app.clientes = res.clientes;
    }
  })
  .api({ modulo: 'clientes', acao: 'listar', token: sessionToken });


// ========= SALVAR TAREFA 5W2H =========
google.script.run
  .withSuccessHandler(function(res) {
    if (res.sucesso) {
      app.tarefas.push({ uuid: res.uuid, ...novaTarefa });
      fecharModal();
    }
  })
  .api({
    modulo: 'tarefas',
    acao: 'salvar',
    token: sessionToken,
    dados: {
      cliente_id: clienteSelecionado.uuid,
      descricao: 'Implantar 5S na produção',
      responsavel: 'João Silva',
      prazo_iso: '2026-04-01',
      onde: 'Linha de Produção',
      porque: 'Reduzir desperdícios em 30%',
      como: 'Workshop + kaizen diário',
      custo: '2000',
      indicador: 'Índice 5S > 80%',
      status: 'iniciar',
      tipo: '5S'
    }
  });


// ========= DASHBOARD KPIs =========
google.script.run
  .withSuccessHandler(function(res) {
    if (res.sucesso) {
      app.kpis = res.kpis;
      renderizarGraficos(res.kpis);
    }
  })
  .api({ modulo: 'dashboard', acao: 'kpis', token: sessionToken });


// ========= SETUP INICIAL =========
google.script.run
  .withSuccessHandler(function(res) {
    console.log('Setup completo:', res.spreadsheetId);
  })
  .api({ modulo: 'setup', acao: 'executar', token: sessionToken });

*/
