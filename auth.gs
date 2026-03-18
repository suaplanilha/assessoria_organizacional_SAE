/**
 * auth.gs
 * Regras auxiliares de autenticação/autorização (modularização incremental).
 */

function isAdminPerfil(perfil) {
  const p = String(perfil || '').toLowerCase();
  return p === 'owner' || p === 'admin';
}

function ensureAdminContextForRoute(token, modulo, acao) {
  const contexto = obterContextoSessao(token);
  if (!contexto || !contexto.consultor_id) {
    return falhaCodigo('session_invalid', 'Sessão inválida para rota administrativa.', { modulo, acao });
  }
  if (!isAdminPerfil(contexto.perfil)) {
    return falhaCodigo('forbidden', 'Acesso negado: rota administrativa exige perfil admin/owner.', {
      modulo,
      acao,
      perfil: contexto.perfil || 'viewer'
    });
  }
  return null;
}
