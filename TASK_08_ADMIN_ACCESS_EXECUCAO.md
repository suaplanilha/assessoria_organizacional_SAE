# TASK 08 — Execução inicial do Plano de Acesso Admin (SaaS GAS)

## Escopo iniciado nesta etapa
Implementação da fundação técnica para A1+A2+B1+B2, com foco em não regressão:

- RBAC estendido com perfis canônicos (`super_admin`, `admin_tenant`, `consultor`, `viewer`).
- Entidades de aprovação adicionadas ao schema (`tb_invites`, `tb_memberships`).
- Feature flag de rollout (`admin_access_v1`) para ativar/desativar o novo fluxo sem remover o legado.
- API de convites/aprovação no backend com auditoria e decisão explícita (`pending -> approved/rejected`).

## Entregas desta execução
1. **Dados (B1)**
   - Novas abas versionadas em `SHEET_SCHEMAS`:
     - `tb_invites`
     - `tb_memberships`
2. **RBAC/Guards (A1/A2/A3)**
   - Normalização de papéis administrativos e permissões novas para rotas de convites.
   - Guard server-side para aprovar/rejeitar convites com checagem de sessão/role/tenant.
3. **Fluxo de aprovação (B2)**
   - Solicitação pública de convite: `convites.solicitar` (status inicial `pending`).
   - Listagem administrativa: `admin.convites.listar`.
   - Decisão administrativa:
     - `admin.convites.aprovar`
     - `admin.convites.rejeitar`
   - Aprovação cria/atualiza vínculo de acesso e registra membership.
4. **Controle de rollout (C1/C3)**
   - Feature flag `admin_access_v1` protegendo as rotas novas.

## Status operacional
- [x] Fundação backend iniciada e integrada no gateway API.
- [ ] Admin UI de pendências (B3) — pendente.
- [ ] Testes de homologação e rollout piloto — pendente (runtime GAS/UI).
- [ ] Alertas operacionais (D3) — pendente.

## Próxima iteração recomendada
1. Entregar tela Admin de convites (fila + decisão + filtros).
2. Executar suíte operacional em homologação:
   - `runApiContractTests()`
   - `runUnitTestsCritical()`
   - `runOperationalSmokeTests()`
   - `runRegressionSuiteP1()`
3. Rodar drill de rollback por flag (`admin_access_v1=false`).
