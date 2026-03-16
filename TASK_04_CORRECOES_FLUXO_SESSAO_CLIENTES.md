# TASK_04 — Correções Críticas de Sessão, Fluxo de Clientes e Robustez Frontend

## Contexto do incidente (baseado no QA)
Após atualização de schema/tabelas, o sistema apresentou regressões funcionais no fluxo autenticado:
- `Error: Sessão inválida` ao navegar em múltiplas abas.
- `SyntaxError: Unexpected end of JSON input` em runtime frontend.
- Timeouts recorrentes no client RPC (`Timeout de comunicação com GAS`).
- Fluxo de criar cliente sem fechamento de modal, sem feedback visual de sucesso e sem refresh da tabela.
- Ausência de ações de editar/inativar cliente na tela de gestão.

Além disso, o levantamento de dados mostrou **drift de schema na aba `sessoes`** com linhas legadas em ordem de colunas diferente da versão atual, gerando interpretação incorreta de campos (`token`, `tenant_id`, `perfil`) durante leitura de sessão.

---

## Diagnóstico técnico consolidado

### D1) Causa-raiz primária: drift estrutural em `sessoes`
A implementação atual espera o header canônico:
`token, tenant_id, consultor_id, perfil, email_hash, created_at, expires_at, ativo`.

No QA, existem registros antigos com layout diferente e sem `token` no início da linha. Com isso:
1. `obterContextoSessao(token)` não encontra token válido ou lê colunas erradas.
2. o gateway retorna `session_invalid`.
3. o frontend em cascata falha ao carregar dados base (`clientes`, `tarefas`, `diagnosticos`, `financeiro`).

### D2) Efeito secundário: falha em cascata no boot/navegação
A carga inicial tenta múltiplas chamadas quase simultâneas. Com sessão instável, aparecem:
- erros de sessão em cada refresh;
- timeout/retry no client GAS;
- telas vazias por ausência de reconciliação robusta no pós-erro.

### D3) UX insuficiente no módulo de clientes
No create de cliente:
- modal não fecha automaticamente em sucesso;
- falta toast de sucesso/erro claro;
- grid não revalida dados imediatamente após persistência;
- ações de editar/inativar não estão expostas/ligadas ao fluxo de tabela.

### D4) Robustez de parsing JSON no frontend
`Unexpected end of JSON input` indica parsing em payload potencialmente vazio/truncado ou não-JSON em algum ponto de restore/cache/interceptor. Falta de guardas pré-parse amplifica quebra de fluxo.

---

## Objetivo da correção
Restabelecer operação estável de sessão e gestão de clientes sem necessidade de refresh manual, com feedback UX explícito e comportamento determinístico no pós-salvamento.

---

## Plano de execução (priorizado)

## Fase 1 — Correção de dados/sessão (P0)
1. Criar rotina administrativa de **normalização da aba `sessoes`**:
   - detectar header real;
   - mapear linhas legadas por posição conhecida;
   - regravar em formato canônico;
   - descartar linhas inválidas/sem token.
2. Incluir verificação no boot (`setup.validarSchema`) para acusar explicitamente header divergente em `sessoes`.
3. Adicionar rotina de limpeza operacional:
   - invalidar sessões antigas inconsistentes;
   - manter apenas sessões dentro de validade e com `tenant_id/perfil` coerentes.

**Entrega esperada**: `obterContextoSessao` volta a resolver contexto válido de forma consistente.

## Fase 2 — Hardening backend de sessão/API (P0)
1. Em `obterContextoSessao`:
   - fallback defensivo para identificar token mesmo em ambientes legados durante janela de migração;
   - logs estruturados de motivo de rejeição (`token ausente`, `expirado`, `ativo=false`, `header inválido`).
2. Em `api()`:
   - manter resposta padronizada com `codigo` + `request_id` para todos os casos de sessão inválida;
   - evitar propagação ambígua de erro para frontend.
3. Revisar timeout/retries do lado backend em rotas pesadas (listar em lote) para reduzir latência percebida.

**Entrega esperada**: erro de sessão vira evento tratável (não silencioso) e observável.

## Fase 3 — Correções frontend de autenticado e clientes (P0)
1. Ajustar boot/login para somente navegar para áreas privadas após validação positiva de sessão.
2. Tratar `session_invalid` com política única:
   - limpar token local;
   - notificar usuário uma vez;
   - redirecionar para login sem spam de erros.
3. Fluxo “Novo Cliente”:
   - ao sucesso: toast de sucesso + fechar modal + reset de formulário + `refreshClientes()`.
   - ao erro: toast com mensagem do backend e manter modal aberto para correção.
4. Garantir refresh da tabela após create/update/inactivate.
5. Expor ações na grid:
   - editar cliente;
   - inativar cliente (soft-delete/status).

**Entrega esperada**: cliente criado aparece imediatamente na tabela com feedback visual claro.

## Fase 4 — Robustez de parsing/interceptors (P1)
1. Blindar parsing JSON com `safeParse` (sem exceção não tratada).
2. Validar shape de resposta antes de acessar campos profundos.
3. Logar erro técnico no console com `request_id` (quando disponível) e mensagem amigável para usuário.

**Entrega esperada**: eliminação de `Unexpected end of JSON input` no fluxo nominal.

## Fase 5 — Performance/estabilidade do carregamento (P1)
1. Sequenciar carga inicial crítica:
   - autenticação/ctx -> clientes -> demais módulos em paralelo controlado.
2. Reduzir fan-out inicial quando sessão estiver instável.
3. Ajustar timeout de RPC e retries com backoff para mitigar falhas transitórias do GAS.

---

## Critérios de aceite (QA)
1. Login conclui sem `Sessão inválida` em console para usuário válido.
2. Navegação entre abas não derruba sessão.
3. Criar cliente:
   - salva com toast de sucesso,
   - fecha modal automaticamente,
   - cliente aparece na tabela sem F5.
4. Editar cliente funcional e refletido na listagem.
5. Inativar cliente funcional (sem exclusão física), visível por status.
6. Sem ocorrência de `Unexpected end of JSON input` no fluxo nominal.
7. Sem erro recorrente de timeout no caminho crítico de login + carga inicial.

---

## Estratégia de validação pós-correção
- Smoke test manual orientado a jornada real (login -> clientes -> criar -> editar -> inativar -> navegar abas).
- Execução de `runApiContractTests()` para garantir não regressão de contrato.
- Verificação de logs estruturados por `request_id` para cada falha simulada.

---

## Riscos e mitigação
- **Risco**: quebrar compatibilidade com sessões legadas.
  - **Mitigação**: migração idempotente + fallback temporário de leitura.
- **Risco**: correção frontend mascarar falhas backend.
  - **Mitigação**: exibir `codigo`/mensagem de erro com telemetria mínima.
- **Risco**: timeouts intermitentes do ambiente GAS.
  - **Mitigação**: redução de fan-out inicial + retries com backoff e circuit-break de sessão inválida.

---

## Priorização sugerida
- **P0 (imediato)**: Fases 1, 2, 3.
- **P1 (sequência)**: Fases 4, 5.


## Status de execução
- [x] P0/Fase 1 executada: normalização da aba `sessoes` e rota de saneamento exposta.
- [x] P0/Fase 2 executada: hardening de sessão no backend (`criarSessao`/`obterContextoSessao`) com auto-reparo e logs.
- [x] P0/Fase 3 executada: fluxo de clientes com editar/inativar, fechamento de modal, toast e refresh pós-salvamento.
- [ ] P1/Fase 4 pendente.
- [ ] P1/Fase 5 pendente.
