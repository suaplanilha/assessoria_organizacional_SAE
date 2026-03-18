/**
 * services_relatorios.gs
 * Renderização segura de HTML para portal e relatórios.
 */

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeStatusBadge(status) {
  const s = String(status || '').toLowerCase();
  const permitidos = ['concluido', 'execucao', 'iniciar', 'validando'];
  return permitidos.indexOf(s) >= 0 ? s : 'iniciar';
}

function safeDatePtBr(dateIso) {
  if (!dateIso) return '—';
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function safePercent(value, fallback) {
  const v = toNumberSafe(value, toNumberSafe(fallback, 0));
  return Math.max(0, Math.min(100, Math.round(v)));
}

function gerarHTMLPortalClienteSeguro(dados) {
  const cliente = (dados && dados.cliente) || {};
  const tarefas = Array.isArray(dados && dados.tarefas) ? dados.tarefas : [];
  const financeiro = Array.isArray(dados && dados.financeiro) ? dados.financeiro : [];

  const concluidas = tarefas.filter(function(t) { return normalizeStatusTarefa(t.status) === 'concluido'; }).length;
  const progresso = tarefas.length > 0 ? Math.round((concluidas / tarefas.length) * 100) : 0;
  const evidenciasTotal = tarefas.filter(function(t) { return String(t.evidencia || '').trim().length > 0; }).length;
  const pendenciasFinanceiras = financeiro.filter(function(f) { return !toBooleanSafe(f.pago); }).length;
  const maturidade = safePercent(cliente.maturidade, progresso);

  const tarefasHTML = tarefas.slice(0, 10).map(function(t) {
    const status = normalizeStatusBadge(t.status);
    return '<tr>' +
      '<td>' + escapeHtml(t.descricao) + '</td>' +
      '<td>' + escapeHtml(t.responsavel) + '</td>' +
      '<td>' + escapeHtml(safeDatePtBr(t.prazo_iso)) + '</td>' +
      '<td><span class="badge badge-' + status + '">' + escapeHtml(status) + '</span></td>' +
    '</tr>';
  }).join('');

  return '<!DOCTYPE html>' +
'<html lang="pt-BR">' +
'<head>' +
'<meta charset="UTF-8">' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'<title>Portal — ' + escapeHtml(cliente.empresa_nome) + '</title>' +
'<style>' +
'body { font-family: "Segoe UI", sans-serif; background: #0f172a; color: #f1f5f9; margin: 0; padding: 20px; }' +
'.container { max-width: 800px; margin: 0 auto; }' +
'.header { text-align: center; padding: 40px 20px; background: rgba(99,102,241,0.1); border-radius: 16px; margin-bottom: 24px; }' +
'.company { font-size: 28px; font-weight: 800; }' +
'.card { background: rgba(30,41,59,0.8); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; margin-bottom: 16px; }' +
'.progress-bar { height: 8px; background: rgba(255,255,255,0.06); border-radius: 4px; overflow: hidden; margin-top: 8px; }' +
'.progress-fill { height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 4px; }' +
'.score { font-size: 48px; font-weight: 800; color: #6366f1; text-align: center; }' +
'table { width: 100%; border-collapse: collapse; }' +
'th { padding: 8px; text-align: left; font-size: 11px; color: #64748b; border-bottom: 1px solid rgba(255,255,255,0.06); }' +
'td { padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; color: #94a3b8; }' +
'.badge { padding: 3px 8px; border-radius: 12px; font-size: 10px; font-weight: 700; }' +
'.badge-concluido { background: rgba(16,185,129,0.2); color: #10b981; }' +
'.badge-execucao { background: rgba(99,102,241,0.2); color: #6366f1; }' +
'.badge-iniciar { background: rgba(148,163,184,0.1); color: #64748b; }' +
'.badge-validando { background: rgba(245,158,11,0.2); color: #f59e0b; }' +
'footer { text-align: center; color: #334155; font-size: 11px; margin-top: 40px; }' +
'</style>' +
'</head>' +
'<body><div class="container">' +
'<div class="header"><div style="font-size:36px;margin-bottom:8px;">🏢</div><div class="company">' + escapeHtml(cliente.empresa_nome) + '</div><div style="color:#64748b;margin-top:6px;">Painel de Progresso · Consultoria Organizacional</div></div>' +
'<div class="card"><h3 style="margin:0 0 16px;font-size:16px;">📈 Progresso Geral</h3><div class="score">' + maturidade + '%</div><p style="text-align:center;color:#64748b;margin-top:4px;">Maturidade Organizacional</p><div class="progress-bar"><div class="progress-fill" style="width:' + maturidade + '%"></div></div><div style="display:flex;justify-content:space-between;margin-top:16px;font-size:12px;color:#64748b;"><span>✅ ' + concluidas + ' concluídas</span><span>📋 ' + tarefas.length + ' tarefas total</span><span>📎 ' + evidenciasTotal + ' evidências</span></div></div>' +
'<div class="card"><h3 style="margin:0 0 10px;font-size:16px;">💰 Financeiro</h3><div style="font-size:13px;color:#94a3b8;">Registros no período: ' + financeiro.length + '</div><div style="font-size:13px;color:#94a3b8;">Pendências: ' + pendenciasFinanceiras + '</div></div>' +
'<div class="card"><h3 style="margin:0 0 16px;font-size:16px;">📋 Plano de Ação</h3><table><thead><tr><th>Ação</th><th>Responsável</th><th>Prazo</th><th>Status</th></tr></thead><tbody>' + tarefasHTML + '</tbody></table></div>' +
'<footer>Gerado por SAE — Sistema Apollo Enterprise · ' + escapeHtml(new Date().toLocaleDateString('pt-BR')) + '</footer>' +
'</div></body></html>';
}

function gerarHTMLRelatorioExecutivoSeguro(dados) {
  const cliente = (dados && dados.cliente) || {};
  const tarefas = Array.isArray(dados && dados.tarefas) ? dados.tarefas : [];
  const concluidas = tarefas.filter(function(t) { return normalizeStatusTarefa(t.status) === 'concluido'; }).length;

  const linhas = tarefas.map(function(t) {
    return '<tr><td>' + escapeHtml(t.descricao) + '</td><td>' + escapeHtml(t.responsavel) + '</td><td>' + escapeHtml(t.prazo_iso) + '</td><td>' + escapeHtml(normalizeStatusTarefa(t.status)) + '</td></tr>';
  }).join('');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
  '<title>Relatório Executivo — ' + escapeHtml(cliente.empresa_nome) + '</title>' +
  '<style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px;color:#1e293b;}h1{color:#6366f1;border-bottom:2px solid #6366f1;padding-bottom:12px;}.kpi{display:inline-block;padding:16px 24px;border:1px solid #e2e8f0;border-radius:8px;margin:8px;text-align:center;}.kpi strong{display:block;font-size:28px;color:#6366f1;}table{width:100%;border-collapse:collapse;margin-top:16px;}th,td{padding:10px;border:1px solid #e2e8f0;text-align:left;font-size:13px;}th{background:#f8fafc;}</style>' +
  '</head><body><h1>🐾 SAE — Relatório Executivo</h1><h2>' + escapeHtml(cliente.empresa_nome) + '</h2>' +
  '<p>Segmento: ' + escapeHtml(cliente.segmento) + ' | Consultor: ' + escapeHtml(cliente.consultor_id) + '</p>' +
  '<p>Data: ' + escapeHtml(new Date().toLocaleDateString('pt-BR')) + '</p>' +
  '<h3>KPIs do Projeto</h3><div><div class="kpi"><strong>' + safePercent(cliente.maturidade, 0) + '%</strong>Maturidade</div><div class="kpi"><strong>' + tarefas.length + '</strong>Total de Ações</div><div class="kpi"><strong>' + concluidas + '</strong>Concluídas</div><div class="kpi"><strong>' + (tarefas.length - concluidas) + '</strong>Pendentes</div></div>' +
  '<h3>Plano de Ação</h3><table><tr><th>Ação</th><th>Responsável</th><th>Prazo</th><th>Status</th></tr>' + linhas + '</table>' +
  '<p style="text-align:center;color:#64748b;margin-top:40px;font-size:11px;">SAE — Sistema Apollo Enterprise · Gerado em ' + escapeHtml(new Date().toLocaleString('pt-BR')) + '</p>' +
  '</body></html>';
}

function gerarHTMLRelatorioDiagnosticoSeguro(dados) {
  const cliente = (dados && dados.cliente) || {};
  const diagnosticos = Array.isArray(dados && dados.diagnosticos) ? dados.diagnosticos : [];

  const diagsHTML = diagnosticos.map(function(d) {
    let dims = [];
    try { dims = JSON.parse(d.dimensoes_json || '[]'); } catch (e) { dims = []; }
    const linhas = dims.map(function(x) {
      return '<li>' + escapeHtml(x && x.nome) + ': ' + safePercent(x && x.valor, 0) + '%</li>';
    }).join('');
    return '<h4>' + escapeHtml(d.tipo_matriz) + ' — Score: ' + safePercent(d.score, 0) + '%</h4><ul>' + linhas + '</ul>';
  }).join('');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Diagnóstico — ' + escapeHtml(cliente.empresa_nome) + '</title>' +
    '<style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px;color:#1e293b;}h1{color:#6366f1;}</style></head><body>' +
    '<h1>🔍 Diagnóstico Organizacional</h1><h2>' + escapeHtml(cliente.empresa_nome) + '</h2><p>Data: ' + escapeHtml(new Date().toLocaleDateString('pt-BR')) + '</p>' +
    (diagsHTML || '<p>Nenhum diagnóstico disponível.</p>') +
    '<p style="text-align:center;color:#64748b;margin-top:40px;font-size:11px;">SAE — Sistema Apollo Enterprise</p></body></html>';
}
