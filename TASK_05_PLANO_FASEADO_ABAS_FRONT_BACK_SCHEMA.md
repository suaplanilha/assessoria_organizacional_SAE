# TASK 05 — Plano Faseado de Correções e Evolução por Aba (Front + Back + Schema)

## 1) Objetivo
Definir um plano controlado, incremental e observável para corrigir inconsistências funcionais e de UX entre frontend (`index.html`), backend GAS (`Code.gs`) e schema (`SHEET_SCHEMAS`), cobrindo as abas:

1. Dashboard de Governança
2. Gestão de Clientes
3. Módulo de Diagnóstico
4. Projetos & Planos de Ação (5W2H)
5. Controle Financeiro
6. Portal do Cliente
7. Central de Relatórios
8. Configurações

Este plano incorpora os aprendizados dos erros observados em produção (timeouts RPC e respostas vazias no front, além de mudança de plano SaaS não persistida).

---

## 2) Diagnóstico consolidado (estado atual)

## 2.1 Arquitetura atual (resumo)
- Front chama backend via `google.script.run` encapsulado em `gasClient` + `apiCall`.
- Back possui gateway único `api({ modulo, acao, token, dados })` com roteamento por módulo/ação, validação de sessão, RBAC, tenant e auditoria.
- Persistência em Google Sheets com schemas canônicos em `SHEET_SCHEMAS`.

## 2.2 Achados técnicos principais

1. **Intermitência de RPC no front (timeout / resposta vazia)**
   - `runRpc` usa timeout fixo e rejeita quando excede o limite.
   - `safeJsonParse` trata string vazia como erro.
   - Após ações de salvar/atualizar tarefa, há cadeias de refresh em paralelo (`Promise.allSettled`) que ampliam concorrência.

2. **Divergência UX vs persistência em Configurações (Plano SaaS)**
   - O `<select>` de plano em Configurações não possui `v-model` nem chamada de persistência.
   - O plano efetivo é derivado de billing/tenant (`tb_empresas.plano`) e não desse campo visual.

3. **Acoplamento excessivo de refresh entre abas**
   - Alguns fluxos fazem refresh amplo quando apenas parte dos dados mudam.
   - Isso aumenta latência percebida e risco de timeout em horário de pico.

4. **Lacunas de contratos por aba**
   - Nem todas as telas têm contrato explícito de fallback para `res.dados` e `res.<campo>` em todas as rotas.
   - Há padronização parcial (`unwrapApiList`), mas ainda heterogênea.

---

## 3) Mapeamento por aba (Front / Back / Schema / Gaps)

## 3.1 Dashboard de Governança
- **Front**: `currentPage==='dashboard'`, `refreshDashboard`.
- **Back**: `dashboard.kpis`.
- **Schema base**: `clientes`, `tarefas_5w2h`, `financeiro`.
- **Gaps**:
  - Requisição de KPI concorre com outros refresh na inicialização.
  - Falta cache curto com invalidação contextual por tenant após mutações.

## 3.2 Gestão de Clientes
- **Front**: lista, filtros, salvar/inativar, navegação para outras abas.
- **Back**: `clientes.listar/salvar/excluir`.
- **Schema**: aba `clientes` (`tenant_id`, `consultor_id`, `status`, etc.).
- **Gaps**:
  - Sincronização pós-salvar depende de refresh completo.
  - Falta política unificada para paginação/filtro estável no front.

## 3.3 Módulo de Diagnóstico
- **Front**: `refreshDiagnosticos`, salvar matriz.
- **Back**: `diagnosticos.listar/salvar`.
- **Schema**: `diagnosticos` (`respostas_json`, `dimensoes_json`, `score`).
- **Gaps**:
  - Contrato de payload não versionado por tipo de matriz.
  - Falta validação explícita de tamanho/estrutura de `respostas_json`.

## 3.4 Projetos & Planos de Ação (5W2H)
- **Front**: `refreshTarefas`, salvar/atualizar/excluir, kanban.
- **Back**: `tarefas.listar/salvar/mover/evidencia`.
- **Schema**: `tarefas_5w2h` (`status`, `updated_at`, etc.).
- **Gaps críticos**:
  - É o ponto com maior incidência de timeout percebido no front.
  - Recarregamentos em cascata pós-movimentação no kanban.
  - Necessidade de estratégia de “optimistic UI + reconcile” mais previsível.

## 3.5 Controle Financeiro
- **Front**: `refreshFinanceiro`, registrar pagamento.
- **Back**: `financeiro.listar/registrar`.
- **Schema**: `financeiro` (`pago`, `data_pagamento`, `metodo_pagamento`).
- **Gaps**:
  - KPI financeiro no dashboard pode ficar temporariamente defasado após registro.
  - Falta trilha clara de reconciliação entre lançamento e KPI agregado.

## 3.6 Portal do Cliente
- **Front**: geração de link e preview.
- **Back**: `portal.link`.
- **Schema envolvido**: `clientes` e dados derivados.
- **Gaps**:
  - Falta expiração/metadata mais explícita de link no front.
  - Mensagens de erro poderiam ser mais orientadas a ação.

## 3.7 Central de Relatórios
- **Front**: geração por tipo (`executivo`, etc.).
- **Back**: `relatorios.gerar`.
- **Schema envolvido**: múltiplas abas (dados agregados).
- **Gaps**:
  - Ausência de fila/estado de processamento para relatórios longos.
  - UX sem progress feedback para requests mais lentas.

## 3.8 Configurações
- **Front**: perfil/tema/setup; campo de plano SaaS visual.
- **Back**: setup/schema e billing/admin no gateway.
- **Schema**: `consultores` e `tb_empresas`.
- **Gaps críticos**:
  - Alteração de plano não persistida (campo desplugado da API).
  - Diferença semântica entre `consultores.plano_saas` (perfil/histórico) e `tb_empresas.plano` (plano efetivo do tenant).

---

## 4) Princípios de implementação (erros a evitar)

1. **Evitar tempestade de chamadas RPC**
   - Introduzir serialização leve por domínio (ex.: tarefas) e deduplicação de refresh em voo.

2. **Não depender de um único formato de resposta**
   - Normalizar contratos no front para aceitar `res.dados.<chave>` e `res.<chave>`.

3. **Separar confirmação de escrita vs recarga total**
   - Usar atualização otimista local + reconciliação assíncrona com debounce.

4. **Preservar consistência multi-tenant**
   - Toda mutação sensível manter `tenant_id` e auditoria.

5. **Sinalizar claramente ação que persiste em backend**
   - Qualquer campo editável de plano/perfil deve ter binding e feedback de persistência.

---

## 5) Plano faseado (controlado)

## Fase 0 — Baseline, contratos e observabilidade (rápida)
**Objetivo:** reduzir incerteza e criar métricas comparáveis antes de alterar fluxos.

- Definir baseline de latência por módulo/ação (p50/p95) a partir de logs estruturados.
- Criar checklist de contrato por rota consumida nas 8 abas.
- Definir matriz “ação de usuário → chamadas RPC esperadas”.

**Saída esperada:** documento de baseline + metas de redução de timeout e erro de UX.

## Fase 1 — Estabilização de comunicação Front↔GAS
**Objetivo:** reduzir `Timeout de comunicação com GAS` e `Resposta vazia da API`.

- Implementar controle de concorrência no front para refresh críticos (especialmente tarefas).
- Adotar política de retry/backoff diferenciada por tipo de operação:
  - leitura: retry curto controlado,
  - escrita: sem duplicação cega.
- Evitar refresh redundante em cascata após `salvar/atualizar/mover`.

**Critérios de aceite:**
- Queda mensurável de erros de timeout no console.
- UX sem regressão funcional no fluxo de kanban.

## Fase 2 — Correção funcional de Configurações (Plano SaaS)
**Objetivo:** tornar mudança de plano realmente persistente e rastreável.

- Conectar seletor de plano da aba Configurações à API (`billing.assinatura.alterarPlano`).
- Atualizar estado local (`billingInfo`, `user.plano`, limites) após sucesso.
- Exibir retorno de erro de negócio (ex.: tenant inativo/permissão).
- Documentar regra: plano efetivo = `tb_empresas.plano`.

**Critérios de aceite:**
- Alterar Pro/Enterprise reflete no backend e no front sem relogin.
- Limites de plano atualizados de forma consistente.

## Fase 3 — Hardening por aba (clientes, diagnóstico, financeiro, portal, relatórios)
**Objetivo:** aumentar robustez de contratos e consistência de dados.

- Padronizar consumo de resposta para todas as abas (incluindo fallbacks).
- Aplicar validações de payload nas mutações principais.
- Melhorar mensagens de erro orientadas por contexto da aba.

**Critérios de aceite:**
- Redução de estados silenciosos/inconsistentes nas telas.
- Menor necessidade de refresh manual para convergência visual.

## Fase 4 — Governança e performance de dados
**Objetivo:** suportar escala com menor custo de latência.

- Revisar leitura full-sheet em rotas críticas e introduzir otimizações seguras.
- Definir política de cache por módulo com invalidação pós-mutation.
- Revisar paginação e limites por aba.

**Critérios de aceite:**
- p95 de listagens críticas dentro de meta.
- Redução de operações redundantes por ação de usuário.

## Fase 5 — Fechamento operacional e QA de regressão
**Objetivo:** consolidar estabilidade e preparar ciclo contínuo.

- Executar suíte de smoke por aba (login, listar, salvar, atualizar, excluir/arquivar).
- Validar RBAC/plano nas páginas sensíveis (admin/billing).
- Formalizar runbook de incidentes do front (timeouts, sessão inválida, fallback).

**Critérios de aceite:**
- Fluxos core aprovados sem bloqueios.
- Runbook atualizado e acionável.

---

## 6) Priorização objetiva (ordem sugerida)

1. **P1 imediato:** Fase 1 (estabilização RPC) + Fase 2 (plano SaaS persistente).
2. **P2 curto prazo:** Fase 3 (hardening por aba).
3. **P3 médio prazo:** Fase 4 (performance/caching).
4. **P4 contínuo:** Fase 5 (QA/regressão e operação).

---

## 7) Riscos e mitigação

- **Risco:** correções de timeout mascararem erro de negócio.
  - **Mitigação:** distinguir claramente erro técnico vs erro funcional na UI.
- **Risco:** mudança de plano sem RBAC adequado.
  - **Mitigação:** validar perfil/permissão no backend e exibir erro sem fallback silencioso.
- **Risco:** otimizações de cache servirem dado obsoleto.
  - **Mitigação:** invalidar cache em mutações por módulo/tenant.

---

## 8) Entregáveis recomendados por fase

- Documento técnico de baseline e metas (F0).
- PR de estabilização RPC com métricas de antes/depois (F1).
- PR de correção de plano SaaS ponta-a-ponta (F2).
- PRs menores por aba para hardening (F3).
- PR de performance + paginação/caching (F4).
- Checklist de regressão e runbook operacional atualizado (F5).

---

## 9) Definição de pronto global

A iniciativa é considerada concluída quando:
- Fluxos das 8 abas operam sem erro intermitente recorrente de comunicação.
- Alteração de plano em Configurações persiste e reflete no tenant efetivo.
- Contratos front/back estão padronizados e documentados.
- Métricas operacionais mostram estabilidade sustentada.
