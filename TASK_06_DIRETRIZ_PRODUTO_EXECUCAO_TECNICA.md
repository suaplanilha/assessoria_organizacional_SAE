# Diretriz de Produto e Execução Técnica — SAE (Início, Meio e Fim)

## Objetivo deste documento
Transformar o estágio atual do projeto em um plano executável de evolução, com:
- diagnóstico do que já existe;
- correções críticas e fixes imediatos;
- novas funcionalidades priorizadas;
- roadmap por fases com critérios de entrada/saída;
- definição de “quando finalizar” cada etapa.

---

## 1) O que já existe hoje (estado atual)

### 1.1 Arquitetura funcional
- **Frontend SPA** em `index.html` com Vue 3 CDN e módulos já organizados por navegação (dashboard, clientes, diagnóstico, tarefas 5W2H, financeiro, portal, relatórios, configurações).
- **Backend GAS** em `Code.gs` com:
  - roteador interno `api({ modulo, acao, token, dados })`;
  - CRUDs principais (clientes, tarefas, diagnósticos, financeiro);
  - sessão por token em aba `sessoes`;
  - geração de portal e geração de relatório HTML/PDF.
- **Persistência em Google Sheets** com setup automático de abas e cabeçalhos via `setupSpreadsheet()`.

### 1.2 Maturidade por domínio
- **Estrutura de produto**: boa cobertura de módulos para MVP.
- **UX e proposta de valor**: forte (interface rica, navegação clara, visão consultor-centrista).
- **Processo de engenharia**: fraco (sem roadmap formal, sem fases de release, sem DoD/DoR).
- **Qualidade e segurança**: parcialmente implementadas (há multi-tenant e sessão, mas lacunas críticas de autenticação e governança).

---

## 2) Principais problemas encontrados (o que corrigir primeiro)

## P0 — Segurança e integridade (bloqueadores)
1. **Bug crítico de autenticação**
   - A função `autenticarConsultor` calcula `senhaHash`, mas não compara com nenhum campo persistido.
   - Resultado: autenticação efetiva por e-mail/hash + ativo, sem validação real de senha.
2. **Auto-cadastro irrestrito em produção**
   - `autoCadastrarConsultor` é chamado no primeiro login sem uma política de convite/aprovação.
   - Risco de criação não controlada de contas.
3. **Rota de setup acessível no roteador**
   - `api.setup.executar` expõe execução de setup sem proteção robusta por perfil/ambiente.

## P1 — Confiabilidade e consistência
4. **Documentação e exemplos com nomenclatura inconsistente**
   - README mostra uma convenção de chamadas, enquanto exemplos do front exibem nomes alternativos em alertas de “produção”.
5. **Ausência de validações robustas de entrada**
   - Falta padronização de schema por módulo/ação no backend.
6. **Sem estratégia de migração de schema para planilhas antigas**
   - Evoluções de colunas podem quebrar ambientes já implantados.

## P2 — Engenharia e operação
7. **Ausência de testes automatizados**
   - Não há suíte cobrindo autenticação, sessão, roteamento e isolamento multi-tenant.
8. **Sem observabilidade operacional mínima**
   - Logs existem, mas não há padrão para rastreamento de erro, auditoria e métricas de uso.
9. **Sem fluxo de release por fases**
   - Não existe critério explícito de “MVP pronto”, “beta pronto”, “GA pronto”.

---

## 3) Plano de correções (fixes) com prioridade

## Sprint 0 (1 semana) — Estabilização e segurança
**Meta:** remover riscos críticos antes de novas features.

### Entregáveis obrigatórios
- [ ] Adicionar `senha_hash` em `consultores` e validar senha no login.
- [ ] Bloquear auto-cadastro por padrão (feature flag `ALLOW_SELF_SIGNUP=false`).
- [ ] Restringir `setupSpreadsheet` para modo manutenção/admin.
- [ ] Revisar comentários/JSDoc para refletir contrato real das funções.
- [ ] Padronizar nomenclatura de ações de relatório (`gerar` vs `gerarPdf`) em front+docs.

### Critério de saída da Sprint 0
- 0 bugs de segurança conhecidos em autenticação.
- 100% das rotas críticas com validação mínima de payload.
- README alinhado com o comportamento real da API.

## Sprint 1 (1–2 semanas) — Qualidade e previsibilidade
**Meta:** criar base de engenharia para evoluir com confiança.

### Entregáveis obrigatórios
- [ ] Introduzir testes de unidade para `autenticarConsultor`, `verificarSessao`, `api` e filtros multi-tenant.
- [ ] Criar `migrations` idempotentes para headers do Sheets.
- [ ] Implementar camada de validação (`validatePayload`) por módulo/ação.
- [ ] Definir padrão de erro (`{ erro, codigo, contexto }`).

### Critério de saída da Sprint 1
- Cobertura mínima de 70% nos fluxos críticos de backend.
- Nenhuma regressão nas rotas principais após mudanças de schema.

## Sprint 2 (2 semanas) — Fluxo ponta a ponta consultoria
**Meta:** garantir jornada completa consultor -> cliente -> entrega.

### Entregáveis obrigatórios
- [ ] Pipeline operacional: Cliente -> Diagnóstico -> Plano 5W2H -> Execução -> Financeiro -> Relatório.
- [ ] Estados de projeto claros (descoberta, planejamento, execução, validação, encerrado).
- [ ] Relatórios com dados consistentes por cliente/período.
- [ ] Portal do cliente com visão de progresso e evidências.

### Critério de saída da Sprint 2
- Jornada ponta a ponta executável sem passos manuais fora do sistema.
- Pelo menos 1 relatório executável por tipo com dados reais.

## Sprint 3 (2 semanas) — Produto comercial (SaaS)
**Meta:** preparar operação com múltiplos consultores e cobrança.

### Entregáveis obrigatórios
- [ ] Controle de plano por consultor (limites de clientes/projetos).
- [ ] Base para billing (status de assinatura e bloqueios por inadimplência).
- [ ] Auditoria básica de ações críticas (login, exclusão, setup, alteração financeira).
- [ ] Onboarding guiado para novo consultor.

### Critério de saída da Sprint 3
- Regras de plano aplicadas no backend.
- Fluxo de onboarding concluído em < 10 min por usuário novo.

---

## 4) Novas features recomendadas (priorizadas)

## Alta prioridade (depois dos fixes P0/P1)
1. **Playbook de consultoria por metodologia**
   - Templates por tipo: 5S, SWOT, clima, processos.
2. **Plano de ação inteligente (5W2H assistido)**
   - Sugestões automáticas a partir do diagnóstico.
3. **Timeline de projeto por cliente**
   - Marcos, responsáveis, prazos, status e riscos.
4. **Portal cliente com permissões granulares**
   - visão executiva x visão operacional.

## Média prioridade
5. **Alertas automáticos** (prazo, inadimplência, tarefa parada).
6. **Comparativo entre clientes** (benchmark interno por segmento).
7. **Biblioteca de evidências** com anexos e versionamento.

## Baixa prioridade (pós-GA)
8. **Integrações externas** (Calendar, Zapier/Make, CRM).
9. **PWA mobile** para acompanhamento em campo.
10. **NPS e satisfação de projeto** no encerramento.

---

## 5) Processo de desenvolvimento recomendado (governança)

## Cadência
- **Planejamento quinzenal** com backlog priorizado por impacto x risco.
- **Review semanal** com status de sprint e bloqueios.
- **Release quinzenal** com changelog e checklist de deploy GAS.

## Definições formais
- **DoR (Definition of Ready):** requisito claro, payload definido, critério de aceite testável.
- **DoD (Definition of Done):** código + teste + documentação + validação manual mínima.

## Qualidade mínima por PR
- [ ] Teste de fluxo principal da feature.
- [ ] Verificação de impacto multi-tenant.
- [ ] Atualização de README/contrato de API quando necessário.
- [ ] Checklist de segurança (auth, autorização, exposição de rota administrativa).

---

## 6) Começo, meio e fim (marcos objetivos)

## Começo — “Fundação segura”
- Segurança de login corrigida.
- Rotas administrativas protegidas.
- Testes essenciais no backend.

## Meio — “Operação consistente”
- Jornada ponta a ponta sem lacunas.
- Dados confiáveis para relatórios e portal.
- Processo de release repetível.

## Fim (desta etapa do produto) — “MVP comercial pronto”
- Uso real por consultores sem intervenção técnica frequente.
- Métricas operacionais estáveis por 30 dias.
- Backlog de evolução focado em escala (não em correções estruturais).

---

## 7) Métricas para saber se estamos no caminho
- **Segurança:** 0 incidentes de acesso indevido; 100% login com senha validada.
- **Qualidade:** taxa de regressão < 5% por release.
- **Produto:** tempo para concluir um projeto piloto completo < 14 dias.
- **Operação:** tempo médio de resolução de bug crítico < 24h.
- **Adoção:** % consultores ativos semanais e retenção mensal.

---

## 8) Próximos passos práticos (30 dias)
1. Semana 1: concluir Sprint 0 (segurança + padronização documental).
2. Semana 2: implementar suíte inicial de testes e validações de payload.
3. Semana 3: fechar jornada ponta a ponta e ajustar gaps de relatório/portal.
4. Semana 4: piloto com 1–2 consultores reais, coletar feedback e priorizar Sprint 3.

---

## Conclusão executiva
O projeto já tem uma base funcional forte para MVP de consultoria organizacional, mas precisa de **governança técnica e correções de fundação** para escalar com segurança. A estratégia ideal é: **corrigir P0/P1 imediatamente**, consolidar qualidade com testes e validações, e só então acelerar features comerciais.
