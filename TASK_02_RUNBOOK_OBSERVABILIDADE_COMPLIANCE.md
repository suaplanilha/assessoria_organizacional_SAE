# TASK_02 — Runbook de Observabilidade, Compliance e Recuperação (Sprint 5)

## Objetivo
Definir procedimento operacional padrão para monitoramento, resposta a incidentes, auditoria e recuperação do SAE Enterprise.

## 1. Monitoramento diário (operacional)
1. Verificar `observabilidade.status` (janela 24h) por tenant crítico.
2. Acompanhar:
   - volume total de eventos de auditoria,
   - taxa de erro (`taxa_erro_pct`),
   - métricas `METRIC_*` em Script Properties.
3. Conferir execução do WebApp no painel de Apps Script (erros/latência).

## 2. SLO/SLA internos recomendados
- Disponibilidade alvo (SLO): 99.5% mensal.
- Taxa de erro alvo API: < 2% em janela de 24h.
- Tempo de resposta alvo (p95): < 2s para listagens.

## 3. Classificação de incidentes
- **SEV1**: indisponibilidade total/login quebrado/corrupção de dados.
- **SEV2**: módulo crítico degradado (clientes, tarefas, financeiro).
- **SEV3**: falha parcial com workaround.
- **SEV4**: problema cosmético/documentação.

## 4. Fluxo de resposta a incidentes
1. Abrir incidente com `request_id`, tenant, horário e impacto.
2. Coletar evidências:
   - logs estruturados `api.request`, `api.response`, `api.exception`,
   - eventos em `tb_auditoria`,
   - contadores `METRIC_*`.
3. Contenção:
   - desabilitar rota problemática via feature flag (quando aplicável),
   - manter tenant em `active`/`suspended` conforme risco.
4. Correção e validação:
   - aplicar patch,
   - executar `runApiContractTests()`,
   - executar `runOperationalSmokeTests()`,
   - executar smoke test do tenant afetado.
5. Pós-mortem (até 48h): causa raiz, ação corretiva e preventiva.

## 5. Compliance e trilha de auditoria
- Toda ação mutante/admin/billing deve gerar linha em `tb_auditoria`.
- Campos mínimos: `request_id`, `tenant_id`, `consultor_id`, `perfil`, `modulo`, `acao`, `sucesso`, `codigo`, `mensagem`, `payload_json`, `created_at`.
- Retenção recomendada: 12 meses (ou política contratual do tenant).

## 6. Backup e recuperação
### Backup operacional
1. Snapshot diário da planilha principal (Google Sheets version history + cópia agendada).
2. Export semanal em CSV/ZIP por aba crítica (`consultores`, `clientes`, `tarefas_5w2h`, `financeiro`, `tb_auditoria`).

### Recuperação
1. Restaurar snapshot anterior da planilha.
2. Executar `setupSpreadsheet()` para validar/migrar colunas ausentes.
3. Validar `setup.validarSchema`.
4. Executar `runApiContractTests()`.
5. Executar `runOperationalSmokeTests()`.
6. Reabrir operação por tenant e monitorar `observabilidade.status` por 24h.

## 8. QA contínuo (regressão)
### Rotina recomendada por release
1. `runApiContractTests()`
2. `runOperationalSmokeTests()`
3. Verificação manual mínima no frontend:
   - login/cadastro,
   - listar/salvar em clientes,
   - criar/mover tarefa no kanban,
   - salvar diagnóstico,
   - registrar pagamento,
   - gerar link de portal,
   - gerar relatório.

### Critério de bloqueio de release
- Se qualquer um dos dois testes (`runApiContractTests` ou `runOperationalSmokeTests`) retornar `sucesso: false`, o deploy não deve ser promovido.

## 7. Checklist de hardening final
- [x] `request_id` nas respostas do gateway e logs.
- [x] Códigos de erro padronizados (`codigo`).
- [x] Bloqueio de operações para tenant inativo (`tenant_inativo`).
- [x] Endpoint de observabilidade por tenant.
- [x] Auditoria para operações críticas.
- [ ] Alerta automático externo (e-mail/chatops) para SEV1/SEV2.
