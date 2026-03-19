# TASK 07 — Roteiro de teste manual (cache + regressão + observabilidade)

## Objetivo
Validar o hotfix de cache e o comportamento fim-a-fim após o incidente `Argument too large: key`.

## Critérios de aceite
1. Zero ocorrências de `Argument too large: key` em **3 execuções consecutivas** da suíte.
2. `runRegressionSuiteP1()` verde.
3. Frontend sem `Resposta vazia da API` em `refreshTarefas` durante smoke.
4. Logs com `request_id` e contadores de cache para suporte.

---

## Pré-condições
- Projeto Apps Script publicado no ambiente de homologação.
- Usuário admin para executar funções de teste.
- Acesso ao log de execução (Apps Script Executions/Cloud Logging).
- Frontend apontando para a mesma versão do backend em homologação.

---

## Bloco A — Regressão (3x consecutivas)
Executar no editor Apps Script (Run):

1. `runRegressionSuiteP1()`
2. Repetir `runRegressionSuiteP1()`
3. Repetir `runRegressionSuiteP1()`

### Evidências esperadas
- Resultado `sucesso: true` em todas as 3 execuções.
- Ausência de erro contendo `Argument too large: key`.

### Registro sugerido
- Data/hora UTC de cada execução.
- ID da execução.
- Resultado resumido (pass/fail).

---

## Bloco B — Smoke de listagens (frontend)
1. Login com usuário válido.
2. Acessar tela que dispara `refreshTarefas`.
3. Executar 10–20 ciclos de refresh (manual ou por ações típicas da tela):
   - alternar filtros,
   - trocar cliente,
   - atualizar tarefas,
   - forçar reload de listagem.
4. Abrir console do navegador e verificar ausência de:
   - `Resposta vazia da API.`
   - erros não tratados em `refreshTarefas`.

### Evidências esperadas
- Listagem responde sem travar.
- Sem toast/erro técnico de resposta vazia durante o smoke.

---

## Bloco C — Observabilidade e logs
Após blocos A/B, coletar logs com filtros:

- `cache.set.failed`
- `cache.hit`
- `cache.miss`
- `cache.get_failed`
- `cache.parse_failed`
- `request_id`

### Evidências esperadas
- Toda falha operacional relevante com `request_id`.
- Contadores de cache presentes para análise de suporte.
- `cache.set.failed` sem `Argument too large: key` (ou zero ocorrência desse padrão).

---

## Bloco D — Carga leve (T+24h ~ T+48h)
Objetivo: validar rotas quentes sob concorrência moderada.

### Sugestão de execução
- Rodar 20–50 consultas concorrentes nas rotas/listagens mais usadas (ex.: tarefas/listagens por filtro).
- Repetir por 3 rodadas.

### Evidências esperadas
- Sem `Argument too large: key`.
- Sem degradação evidente no frontend.
- Logs com `request_id` e métricas de cache coerentes.

---

## Status de conclusão desta etapa (checagem atual)

### T+8h ~ T+24h
- [x] Revisar `repositories.gs` para remover payload excessivo da geração de chave. (Implementado: uso de `buildSafeCacheKey` com payload canônico.)
- [ ] Reexecutar `runRegressionSuiteP1()` e smoke de listagens. (**Pendente de execução em ambiente Apps Script/UI**)
- [ ] Coletar logs de `cache.set.failed` e `cache.hit/miss`. (**Pendente de coleta operacional**)

### T+24h ~ T+48h
- [ ] Teste de carga leve (N consultas simultâneas nas rotas quentes). (**Pendente**)
- [ ] Confirmar ausência de `Argument too large: key`. (**Pendente de evidência operacional**)
- [ ] Liberar rollout controlado para piloto. (**Pendente de gate de qualidade**)

---

## Gate de liberação para piloto
Liberar somente se todos os critérios de aceite estiverem atendidos e documentados com evidências (execuções, prints/log exports e horário UTC).
