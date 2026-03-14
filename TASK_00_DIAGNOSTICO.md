# TASK #00 — Diagnóstico Técnico do WebApp GAS (SAE)

## 1) Leitura da arquitetura atual

### Estrutura do projeto (estado atual)
- `Code.gs`: backend único em Google Apps Script (rotas, autenticação, CRUDs, relatórios e agregações de dashboard).
- `index.html`: frontend SPA monolítico (Vue 3 CDN + Chart.js CDN + CSS embutido).
- `.clasp.json`: configuração de deploy para Apps Script via clasp.
- `README.md`: documentação de setup/deploy e visão arquitetural.

### Arquitetura observada
- **Entry point WebApp**: `doGet(e)` decide entre app principal e portal cliente por query param `page`.
- **Persistência**: Google Sheets com 6 abas (`consultores`, `clientes`, `diagnosticos`, `tarefas_5w2h`, `financeiro`, `sessoes`).
- **Integração front/back**: via `google.script.run` e função unificada `api(params)`.
- **Modelo de tenancy**: filtro por `consultor_id` nas leituras/escritas.

## 2) Erros e riscos encontrados (varredura)

### Bugs funcionais diretos
1. **`doGet(e)` sem proteção para `e` indefinido**
   - Em execuções sem evento (testes manuais, cenários de pré-visualização), `e.parameter` pode quebrar.
   - Impacto: erro de renderização inicial do app.

2. **Rota `auth.login` em `api(params)` não repassa `dados`**
   - O roteamento apontava para `autenticarConsultor` sem wrapper; `fn()` era chamado sem argumentos.
   - Impacto: `api({ modulo:'auth', acao:'login', dados:{...} })` falha por parâmetros ausentes.

3. **Validação booleana rígida em sessão (`=== true`)**
   - Em Sheets, valores booleanos podem retornar como `TRUE`/`FALSE` (string) dependendo do fluxo.
   - Impacto: sessões válidas podem ser rejeitadas intermitentemente.

### Riscos de engenharia/manutenção
4. **Frontend ainda em modo mock para autenticação e CRUD principal**
   - `index.html` usa `setTimeout` e dados mock em vez do backend real em produção.
   - Impacto: desalinhamento entre UX e estado real do banco.

5. **Arquivo frontend único muito grande**
   - CSS + markup + lógica JS no mesmo arquivo dificulta teste, revisão e redução de regressões.

## 3) Motivo provável de “index carrega, mas login não renderiza para usuário”

Pelos artefatos e pela lógica do projeto, os cenários mais prováveis são:

1. **Falha no bootstrap da WebApp por erro em `doGet(e)`** em contexto sem objeto `e` completo.
2. **Quebra de autenticação ao usar `api.auth.login`** (dados não repassados), gerando fluxo de tela inválido.
3. **Sessão considerada inválida por leitura booleana inconsistente** (`true` vs `'TRUE'`).

> Nota: o HTML contém o bloco de login com `v-if="!authenticated"`; ele depende de inicialização coerente do estado e de execução sem erros de boot.

## 4) Plano controlado de correção e evolução (Front, Back, Performance, UI/UX)

## Fase 0 — Estabilização imediata (hotfix)
- [ ] Proteger `doGet` para aceitar ausência de evento.
- [ ] Corrigir `api.auth.login` para encaminhar `dados` para `autenticarConsultor`.
- [ ] Normalizar leitura de booleano de sessão (`true` e `'TRUE'`).
- [ ] Adicionar log estruturado para erros de autenticação/sessão.

## Fase 1 — Confiabilidade backend
- [ ] Criar camada utilitária para validação de tipos (datas, booleanos, números) vindos do Sheets.
- [ ] Padronizar respostas `{ sucesso, erro, dados }` em todos os módulos.
- [ ] Incluir guarda de abas inexistentes com mensagens acionáveis.
- [ ] Definir política de versionamento de schema (migrações de colunas).

## Fase 2 — Frontend e UX
- [ ] Conectar login e carregamento inicial ao backend real (`google.script.run`) com tratamento de erro amigável.
- [ ] Separar o frontend por componentes/páginas (partials HTML + include server-side) para reduzir complexidade.
- [ ] Implementar estados explícitos: `booting`, `unauthenticated`, `authenticated`, `error`.
- [ ] Melhorar UX de erro com mensagens orientadas a ação (ex.: “Execute setupSpreadsheet()”).

## Fase 3 — Performance
- [ ] Evitar `getDataRange()` indiscriminado: buscar somente colunas/faixas necessárias.
- [ ] Cache curto (CacheService) para KPIs e listas frequentes.
- [ ] Paginação para listas longas de tarefas/clientes.

## Fase 4 — Qualidade e prevenção de regressões
- [ ] Criar suíte de testes de contrato para `api(params)` (rotas e payloads obrigatórios).
- [ ] Checklist de deploy no README (setup + smoke test de login + sessão).
- [ ] Telemetria mínima (contadores de erro por módulo) em Planilha/Logs.

## 5) Critério de aceite recomendado para próxima iteração
- Login funcional em ambiente WebApp publicado.
- Sessão persistindo e validando corretamente por 7 dias.
- Dashboard carregando dados reais (não mock) sem erro JS no console.
- Fluxos críticos (cliente, tarefa, financeiro) com sucesso de ponta a ponta.


## 6) Execução prática (Fases 0, 1 e 2)

### Fase 0 — Status
- [x] `doGet` protegido para ausência de evento.
- [x] `api.auth.login` encaminhando `dados` corretamente.
- [x] Normalização de booleano de sessão via utilitário `toBooleanSafe`.
- [x] Log estruturado adicionado (`logEstruturado`) para falhas de autenticação/sessão/API.

### Fase 1 — Status
- [x] Camada utilitária criada para tipagem segura (`toBooleanSafe`, `toNumberSafe`, `toISODateSafe`).
- [x] Respostas padronizadas no gateway `api` com `sucesso()`/`falha()`.
- [x] Guarda de abas inexistentes implementada com ação sugerida (`getSheetOrFail`).
- [x] Política de schema versionado definida (`SCHEMA_VERSION`, `SHEET_SCHEMAS`, `validarSchemaAbas`).

### Fase 2 — Status
- [x] Login e bootstrap conectados ao backend real com `google.script.run` (sem mock no fluxo de autenticação).
- [x] Estados explícitos de autenticação implementados: `booting`, `unauthenticated`, `authenticated`, `error`.
- [x] UX de erro melhorada com mensagens acionáveis e CTA para `setupSpreadsheet()` quando necessário.
- [~] Componentização/páginas separadas: iniciado via separação de estados/fluxos; refatoração física em partials ficará para etapa seguinte.

## 7) Execução prática (Fases 3, 4 e 5)

### Fase 3 — Performance
- [x] Leitura de planilhas migrada para `getSheetSnapshot()` com `getRange` delimitado por `lastRow/lastColumn`.
- [x] Cache curto em `CacheService` para KPIs e listas frequentes (`clientes`, `tarefas`, `dashboard.kpis`).
- [x] Paginação implementada para `listarClientes` e `listarTarefas` (`page`, `pageSize`, `paginacao`).

### Fase 4 — Qualidade e prevenção
- [x] Suíte de contrato adicionada via função `runApiContractTests()`.
- [x] Checklist de deploy + smoke test adicionados ao `README.md`.
- [x] Telemetria mínima implementada com contadores em `ScriptProperties` (`registrarTelemetria`).

### Fase 5 — Critério de aceite
- [x] Critérios de aceite documentados no `README.md` para validação operacional da próxima publicação.
