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
- [x] Admin UI de pendências (B3) — entregue (fila + filtro + aprovar/rejeitar).
- [ ] Testes de homologação e rollout piloto — pendente (runtime GAS/UI).
- [x] Alertas operacionais (D3) — endpoint de alertas operacionais de convites e log `WARN` para picos.

## Status por EPIC/TASK (atualizado)

### EPIC A — Controle de Acesso e Papéis
- [x] A1: matriz RBAC base com `super_admin/admin_tenant/consultor/viewer` no backend.
- [x] A2: guard central de autorização em rotas admin (server-side).
- [x] A3: operações críticas admin validam sessão/role com erro padronizado.

### EPIC B — Aprovação de Novos Clientes/Usuários
- [x] B1: entidades `tb_invites` e `tb_memberships` adicionadas no schema versionado.
- [x] B2: fluxo `pending -> approved/rejected` implementado no backend.
- [x] B3: fila Admin com filtros e ações de aprovação/rejeição no frontend.

### EPIC C — Não regressão
- [x] C1: feature flag `admin_access_v1` aplicada ao novo fluxo.
- [x] C2: fluxo legado mantido (novo fluxo isolado por flag).
- [ ] C3: rollback drill em homologação (desativar `admin_access_v1`) — pendente de evidência.

### EPIC D — Observabilidade e Operação
- [x] D1: logs com rastreio admin no pipeline existente (`request_id/client_request_id`).
- [x] D2: auditoria nas ações de convite/aprovação/rejeição e bootstrap.
- [x] D3: endpoint de alerta para picos de rejeição/pendência + log `WARN`.

## Runbook D0 — Admin inicial fora do sistema
- [x] Endpoint técnico de bootstrap (`setup.bootstrapSuperAdmin`) implementado com proteção:
  - chave `ADMIN_BOOTSTRAP_KEY` **ou** `MAINTENANCE_MODE=true`.
- [ ] Execução assistida em homologação e depois produção — pendente de operação.

## Próxima iteração recomendada
1. Entregar tela Admin de convites (fila + decisão + filtros).
2. Executar suíte operacional em homologação:
   - `runApiContractTests()`
   - `runUnitTestsCritical()`
   - `runOperationalSmokeTests()`
   - `runRegressionSuiteP1()`
3. Rodar drill de rollback por flag (`admin_access_v1=false`).
