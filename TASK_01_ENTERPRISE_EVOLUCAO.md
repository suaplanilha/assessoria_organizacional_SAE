# TASK_01 — Evolução do SAE Pro para SAE Enterprise

## 1) Objetivo de negócio
Transformar o produto atual (single-consultor com isolamento por `consultor_id`) em um SaaS Enterprise com:
- multi-tenant por organização/empresa contratante,
- múltiplos usuários por tenant com papéis e permissões,
- governança (auditoria, segurança, conformidade),
- operação escalável (observabilidade, billing, SLAs),
- continuidade de compatibilidade com base atual (migração sem quebra).

---

## 2) Estado atual (baseline técnico)
### Pontos já maduros
- API gateway único (`api(params)`) com contratos padronizados e telemetria básica.
- Sessão/autenticação com token persistido em Sheets (`sessoes`).
- Cache + paginação em listagens principais.
- Fluxo de tarefas/diagnóstico/financeiro integrado ao frontend.
- Versionamento de schema e rotina de validação/migração.

### Limitações para Enterprise
- Isolamento de dados baseado majoritariamente em `consultor_id` (não em `tenant_id`/`empresa_id`).
- Falta de RBAC completo (perfis, permissões granulares e escopo por recurso).
- Ausência de trilha de auditoria corporativa por ação sensível.
- Billing/plano ainda simplificado (sem ciclo, limites fortes e bloqueios dinâmicos por feature).
- Observabilidade ainda sem correlação ponta-a-ponta e alertas operacionais.

---

## 3) Modelo-alvo Enterprise (arquitetura funcional)
## 3.1 Domínio e entidades (camada Core)
Criar/fortalecer entidades com vínculo explícito a `tenant_id`:
- `tb_empresas` (tenant): plano, status, limites, SLA, ciclo de cobrança.
- `tb_usuarios`: vínculo `tenant_id`, `perfil`, `status`, MFA flags.
- `tb_papeis` e `tb_permissoes`: matriz RBAC.
- `tb_sessoes`: sessão por usuário + tenant + dispositivo.
- `tb_licencas`: ciclo financeiro e compliance de contrato.

## 3.2 Escopo de dados
Todos os módulos funcionais devem carregar `tenant_id` obrigatório:
- clientes,
- tarefas_5w2h,
- diagnósticos,
- financeiro,
- relatórios/logs.

## 3.3 Segurança e governança
- RBAC por ação (`modulo.acao`) no gateway.
- Auditoria imutável para ações críticas (criar/editar/excluir/exportar).
- Política de sessão enterprise (expiração curta + refresh + revogação).
- Hardening de rotas administrativas (setup/saneamento) com permissão restrita.

---

## 4) GAP Analysis (o que falta corrigir/implementar)
## 4.1 Dados e schema
1. Introduzir `tenant_id` nas tabelas funcionais atuais.
2. Estratégia de backfill:
   - mapear `consultor_id -> tenant_id` inicial,
   - preencher registros legados,
   - bloquear gravação sem `tenant_id`.
3. Evoluir `SCHEMA_VERSION` para 2.x com migração progressiva.

## 4.2 API
1. Incluir `tenant_id` no contexto autenticado (derivado do token, nunca do payload cliente).
2. Validar autorização por papel/permissão antes de executar `modulo.acao`.
3. Criar rotas enterprise administrativas:
   - `admin.tenant.criar|atualizar|suspender`,
   - `admin.usuarios.listar|convidar|desativar`,
   - `admin.rbac.definir`,
   - `billing.assinatura.*`,
   - `auditoria.listar`.
4. Padronizar erros enterprise:
   - `forbidden`, `tenant_inativo`, `limite_plano_excedido`, `licenca_expirada`.

## 4.3 Frontend
1. Área de administração enterprise (tenant, usuários, permissões, plano).
2. Guardas de rota por permissão.
3. Mensagens de bloqueio por limite/plano (sem falha silenciosa).
4. Feature flags por plano (`Pro` vs `Enterprise`) para liberar módulos avançados.

## 4.4 Operação
1. Observabilidade:
   - correlação por `request_id`, `tenant_id`, `usuario_id`,
   - logs de negócio + erro + auditoria.
2. Confiabilidade:
   - circuit-breaker/retry por chamadas críticas internas,
   - monitoramento de cota GAS/Drive/Sheets.
3. Segurança:
   - trilha de acesso, tentativas de login, bloqueio por abuso,
   - plano de backup/restauração.

---

## 5) Novas features Enterprise (priorizadas)
### P0 (obrigatório para lançar)
- Multi-tenant real (`tenant_id`) end-to-end.
- RBAC mínimo (Owner/Admin/Manager/Analyst/Viewer).
- Gestão de usuários do tenant (convite, ativação, desativação).
- Auditoria de ações críticas.
- Limites por plano e bloqueios com feedback claro.

### P1 (pós-lançamento imediato)
- Workspaces/departamentos internos do tenant.
- Aprovação de mudanças (ex.: tarefas concluídas exigindo aprovação de gestor).
- SSO/OAuth corporativo (Google/Microsoft).
- Exportações avançadas e agendamentos de relatório.

### P2 (escala e diferenciação)
- Marketplace de templates de diagnóstico.
- Automação com webhooks e integrações ERP/CRM.
- SLA dashboard (uptime, latência, incidentes).

---

## 6) Riscos previsíveis e mitigação
1. **Risco: vazamento cross-tenant por filtro incompleto**  
   Mitigação: gateway enforce de `tenant_id` em todas as operações + testes negativos.

2. **Risco: migração quebrar dados legados**  
   Mitigação: dry-run de migração, backup prévio, rollback por versão.

3. **Risco: regressão de performance com novos filtros**  
   Mitigação: cache segmentado por tenant + paginação obrigatória.

4. **Risco: aumento de suporte por mudança de UX**  
   Mitigação: rollout por feature flags + onboarding guiado.

5. **Risco: limites GAS (quota)**  
   Mitigação: observabilidade de quota e plano de desacoplamento gradual para banco dedicado.

---

## 7) Backlog operacional (tarefas emitidas)
## EPIC E1 — Multi-tenant foundation
- [ ] E1-T1: Definir `TENANT_SCHEMA_VERSION = 2.0.0` e migrador.
- [ ] E1-T2: Criar `tb_empresas` (tenant) com limites/plano/status.
- [ ] E1-T3: Adicionar `tenant_id` em clientes/tarefas/diagnosticos/financeiro/sessoes.
- [ ] E1-T4: Backfill legado `consultor_id -> tenant_id` (com relatório de inconsistências).
- [ ] E1-T5: Bloquear gravação sem `tenant_id` em todas as rotas mutantes.

## EPIC E2 — Auth, sessão e RBAC
- [ ] E2-T1: Expandir sessão para `usuario_id`, `tenant_id`, `perfil`.
- [ ] E2-T2: Implementar middleware de autorização por `modulo.acao`.
- [ ] E2-T3: Criar tabela de permissões e seeds de papéis padrão.
- [ ] E2-T4: Criar rotas `admin.usuarios.*` e fluxo de convite.
- [ ] E2-T5: Política de revogação de sessão e expiração enterprise.

## EPIC E3 — API Enterprise e contratos
- [ ] E3-T1: Versionar API (`v1` Pro, `v2` Enterprise).
- [ ] E3-T2: Adicionar códigos de erro de negócio enterprise padronizados.
- [ ] E3-T3: Rotas `admin.tenant.*`, `billing.*`, `auditoria.listar`.
- [ ] E3-T4: Testes de contrato para isolamento cross-tenant e RBAC.

## EPIC E4 — Frontend Enterprise Console
- [ ] E4-T1: Nova área “Administração” (tenant/usuários/permissões).
- [ ] E4-T2: Guardas de navegação por permissão.
- [ ] E4-T3: Banner/estado para limites do plano e tenant suspenso.
- [ ] E4-T4: Feature flags por plano com fallback amigável.

## EPIC E5 — Observabilidade e compliance
- [ ] E5-T1: Correlation ID no gateway + logs estruturados por request.
- [ ] E5-T2: Auditoria de ações críticas com rastreabilidade.
- [ ] E5-T3: Dashboard operacional (erros, latência, quotas).
- [ ] E5-T4: Runbook de incidentes e recuperação.

---

## 8) APIs novas/ajustes necessários (proposta)
### Novas
- `admin.tenant.criar|atualizar|suspender`
- `admin.usuarios.listar|convidar|alterarPerfil|desativar`
- `admin.rbac.permissoes|atualizar`
- `auditoria.listar`
- `billing.assinatura.obter|alterarPlano|status`

### Ajustes nas atuais
- `clientes.*`, `tarefas.*`, `diagnosticos.*`, `financeiro.*`, `dashboard.*`:
  - enforcement de `tenant_id` por sessão,
  - validação de permissões por ação,
  - logs com `tenant_id`.

---

## 9) Critérios de aceite para release Enterprise
1. Zero retorno cross-tenant em testes de listagem e leitura por UUID.
2. Todas as rotas mutantes bloqueiam usuário sem permissão.
3. Auditoria registra criar/editar/excluir/exportar/login/admin.
4. Plano/limites bloqueiam operações além da franquia com erro claro.
5. Dashboard e telas administrativas refletem estado real do tenant.

---

## 10) Plano de execução sugerido (90 dias)
- Sprint 1-2: E1 + E2 (fundação de tenant, sessão e RBAC base).
- Sprint 3: E3 (API enterprise e contratos).
- Sprint 4: E4 (console admin + UX de permissões).
- Sprint 5: E5 (observabilidade/compliance) + hardening final.
- Sprint 6: piloto controlado com 1-2 tenants enterprise.


---

## 11) Status de execução (Sprint 1-2)

### Concluído nesta entrega
- [x] E1-T1: `SCHEMA_VERSION` evoluído para `2.0.0` com novos schemas base Enterprise.
- [x] E1-T2 (base): criação de `tb_empresas` no setup.
- [x] E1-T3 (base): inclusão de `tenant_id` em schemas de consultores, clientes, diagnósticos, tarefas, financeiro e sessões.
- [x] E1-T5 (base): gravações principais passam a preencher `tenant_id` derivado do contexto de sessão.
- [x] E2-T1 (base): sessão expandida para `tenant_id` e `perfil`.
- [x] E2-T2 (base): middleware RBAC no gateway `api(params)` com matriz de permissões por perfil.
- [x] E2-T3 (base): seed de permissões padrão em `tb_permissoes` durante setup.
- [x] E2-T4 (parcial): rotas administrativas iniciais `admin.tenantObter` e `admin.usuariosListar`.

### Pendente para concluir Sprint 1-2 completo
- [ ] E1-T4: backfill controlado legado `consultor_id -> tenant_id` com relatório formal de inconsistências.
- [ ] E2-T4 completo: convite, alteração de perfil e desativação de usuários do tenant.
- [ ] E2-T5: política avançada de revogação de sessão/expiração enterprise.
