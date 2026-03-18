/**
 * validation.gs
 * Guardas de validação de rota (modularização incremental).
 */

function isAdministrativeRoute(modulo, acao) {
  const m = String(modulo || '').toLowerCase();
  const a = String(acao || '').toLowerCase();

  if (m === 'admin') return true;
  if (m === 'setup' && ['executar', 'resetestrutural', 'migrarschema'].indexOf(a) >= 0) return true;

  return false;
}
