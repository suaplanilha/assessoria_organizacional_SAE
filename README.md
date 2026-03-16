# 🐾 SAE — Sistema Apollo Enterprise
### SaaS para Consultores Organizacionais · MVP

---

## 📦 Arquivos do Projeto

| Arquivo | Descrição |
|---------|-----------|
| `index.html` | Frontend completo (Vue 3 CDN + Glassmorphism Dark) |
| `Code.gs` | Backend Google Apps Script (V8 Engine) |
| `README.md` | Este arquivo |

---

## 🚀 Deploy em 5 Passos

### 1. Criar o Google Apps Script

1. Acesse [script.google.com](https://script.google.com)
2. Clique em **Novo Projeto**
3. Renomeie para `SAE - Sistema Apollo Enterprise`

### 2. Configurar o Backend

1. Substitua o conteúdo de `Código.gs` pelo conteúdo de `Code.gs`
2. Crie um novo arquivo HTML: **Arquivo → Novo → HTML** → nome: `index`
3. Cole o conteúdo de `index.html` neste arquivo
4. Salve com `Ctrl+S`

### 3. Setup do Banco de Dados

1. No editor GAS, selecione a função `setupSpreadsheet`
2. Clique em **Executar** (autorize as permissões solicitadas)
3. Isso criará automaticamente as 6 abas no Google Sheets

### 4. Deploy como Web App

1. Clique em **Implantar → Nova implantação**
2. Tipo: **Aplicativo da Web**
3. Configurações:
   - Executar como: `Eu mesmo`
   - Quem tem acesso: `Qualquer pessoa` (para clientes acessarem o portal)
4. Copie a **URL do Web App** gerada

### 5. Acessar o Sistema

- Abra a URL do Web App no browser
- Faça login com qualquer e-mail (auto-cadastro no MVP)
- Explore os módulos!

### ✅ Checklist de Deploy (Fase 4)

- [ ] Executar `setupSpreadsheet()` no editor GAS.
- [ ] Executar `runApiContractTests()` e confirmar `sucesso: true`.
- [ ] Publicar nova versão do Web App.
- [ ] Abrir a URL publicada e validar tela de login.
- [ ] Realizar login e confirmar sessão ativa.
- [ ] Acessar Dashboard e verificar ausência de erros no console.
- [ ] Validar fluxo mínimo ponta-a-ponta: Cliente → Tarefa → Financeiro.

### 🔎 Smoke test rápido (produção)

1. Login com consultor existente (ou auto-cadastro MVP).
2. Criar um cliente novo.
3. Criar uma tarefa 5W2H para este cliente.
4. Registrar mensalidade (pago/pendente).
5. Reabrir app e confirmar sessão válida sem novo login imediato.

### 🎯 Critérios de aceite (próxima iteração)

- Login funcional em Web App publicado.
- Sessão persistindo e validando por 7 dias.
- Dashboard carregando dados reais sem erro JS no console.
- Fluxos críticos (cliente, tarefa, financeiro) funcionando de ponta a ponta.

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                  FRONTEND (index.html)               │
│                                                     │
│  Vue 3 (CDN)  ·  Glassmorphism Dark  ·  Chart.js   │
│                                                     │
│  Módulos: Dashboard · Clientes · Diagnóstico        │
│           Projetos 5W2H · Financeiro · Portal       │
└─────────────────────┬───────────────────────────────┘
                      │
                      │ google.script.run (NUNCA fetch/XHR!)
                      │
┌─────────────────────▼───────────────────────────────┐
│            BACKEND (Google Apps Script)              │
│                                                     │
│  Autenticação SHA-256  ·  Multi-tenant  ·  CRUD     │
│  Portal HTML  ·  Geração PDF  ·  KPIs Dashboard    │
└─────────────────────┬───────────────────────────────┘
                      │
                      │ Sheets API
                      │
┌─────────────────────▼───────────────────────────────┐
│            BANCO DE DADOS (Google Sheets)            │
│                                                     │
│  consultores │ clientes │ diagnosticos              │
│  tarefas_5w2h │ financeiro │ sessoes                │
└─────────────────────────────────────────────────────┘
```

---

## 🗄️ Estrutura das Abas (Google Sheets)

### `consultores`
| uuid | nome | email | email_hash | plano_saas | data_adesao | ativo | configuracoes_json |

### `clientes`
| uuid | consultor_id | empresa_nome | segmento | responsavel | email_contato | telefone | status | mensalidade | data_inicio | maturidade | obs | created_at |

### `diagnosticos`
| uuid | cliente_id | consultor_id | tipo_matriz | respostas_json | score | dimensoes_json | observacoes | created_at | status |

### `tarefas_5w2h`
| uuid | cliente_id | consultor_id | descricao | responsavel | prazo_iso | onde | porque | como | custo | indicador | status | tipo | evidencia | created_at | updated_at |

### `financeiro`
| uuid | cliente_id | consultor_id | valor_mensalidade | data_vencimento | data_pagamento | pago | metodo_pagamento | obs | created_at |

### `sessoes`
| token | consultor_id | email_hash | created_at | expires_at | ativo |

---

## 🔒 Segurança Multi-tenant

- **SHA-256**: e-mails hasheados antes de armazenar no Sheets
- **Isolamento**: toda query filtra por `consultor_id` — dados de um consultor nunca vazam para outro
- **Sessões**: tokens com expiração de 7 dias, invalidáveis manualmente
- **CORS**: zero problemas — toda comunicação via `google.script.run` (nativo GAS)

---

## 📡 API Interna (google.script.run)

```javascript
// Padrão de chamada unificado
google.script.run
  .withSuccessHandler(callback)
  .withFailureHandler(errorHandler)
  .api({
    modulo: 'clientes' | 'tarefas' | 'diagnosticos' | 'financeiro' | 'dashboard',
    acao: 'listar' | 'salvar' | 'excluir' | ...,
    token: sessionToken,  // Token de sessão obtido no login
    dados: { ... }        // Payload específico do módulo
  });
```

### Exemplos rápidos:

```javascript
// Login
google.script.run
  .withSuccessHandler(res => { if(res.sucesso) token = res.token; })
  .autenticarConsultor({ email, senha });

// Dashboard KPIs
google.script.run
  .withSuccessHandler(res => renderKPIs(res.kpis))
  .api({ modulo: 'dashboard', acao: 'kpis', token });

// Listar Clientes
google.script.run
  .withSuccessHandler(res => clientes.value = res.clientes)
  .api({ modulo: 'clientes', acao: 'listar', token });

// Salvar Tarefa 5W2H
google.script.run
  .withSuccessHandler(res => { if(res.sucesso) fecharModal(); })
  .api({ modulo: 'tarefas', acao: 'salvar', token, dados: tarefa5W2H });

// Gerar Relatório PDF
google.script.run
  .withSuccessHandler(res => window.open(res.url))
  .api({ modulo: 'relatorios', acao: 'gerar', token, dados: { cliente_id, tipo: 'executivo' } });
```

---

## 🎨 Design System

- **Fundo**: `#0f172a` (Slate 900)
- **Cards**: `rgba(30,41,59,0.6)` com `backdrop-filter: blur(20px)`
- **Accent**: `#6366f1` (Indigo 500)
- **Accent 2**: `#8b5cf6` (Violet 500)
- **Fontes**: Syne (títulos) · DM Sans (corpo)
- **Mascote**: Apollo 🐾 (Shih Tzu) — loading indicator

---

## 📋 Módulos do MVP

| Módulo | Funcionalidades |
|--------|----------------|
| 📊 Dashboard | KPIs, Radar de Maturidade, Gráfico de evolução |
| 🏢 Clientes | CRUD, filtros, status, mensalidade |
| 🔍 Diagnóstico | 5S, SWOT, Clima Org., Score Automático, Radar |
| 📋 Projetos 5W2H | Kanban (4 colunas), formulário 5W2H completo, evidências |
| 💰 Financeiro | Controle de mensalidades, inadimplência |
| 🌐 Portal Cliente | Link único, preview, progresso do projeto |
| 📄 Relatórios | PDF via HtmlService (4 tipos) |
| ⚙️ Configurações | Perfil, Google Sheets, Segurança |

---

## 🛣️ Roadmap Pós-MVP

- [ ] Notificações por email (GAS MailApp)
- [ ] Integração com Google Calendar para prazos
- [ ] Dashboard de comparativo entre clientes
- [ ] Formulário de diagnóstico para o cliente responder via portal
- [ ] App mobile (PWA)
- [ ] Integrações via Zapier/Make
- [ ] Módulo de NPS e Pesquisa de Satisfação
- [ ] Assinatura digital de contratos (DocuSign API)

---

## ⚠️ Regras Críticas GAS

> **NUNCA use `fetch()` no frontend para acessar o backend!**
> O GAS tem restrições de CORS. Use **exclusivamente** `google.script.run`.

```javascript
// ❌ ERRADO — Vai falhar com CORS
fetch('https://script.google.com/macros/s/AK.../exec', {...})

// ✅ CORRETO — Comunicação nativa GAS
google.script.run
  .withSuccessHandler(callback)
  .minhaFuncao(params)
```

---

*SAE — Sistema Apollo Enterprise · Desenvolvido com Google Apps Script + Vue 3*
*Mascote oficial: Apollo 🐾 (Shih Tzu)*


---

## 🏢 Roadmap Enterprise

A evolução do SAE Pro para Enterprise foi mapeada com:
- arquitetura alvo multi-tenant,
- plano de migração de schema,
- backlog por épicos (E1..E5),
- proposta de novas APIs administrativas,
- riscos e critérios de aceite de release.

Consulte: `TASK_01_ENTERPRISE_EVOLUCAO.md`.

Status atual: Sprint 1-2 (E1 + E2 base) executado parcialmente com fundação de tenant, sessão expandida e RBAC inicial no gateway.
