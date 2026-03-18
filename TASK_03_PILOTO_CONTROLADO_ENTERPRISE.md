# TASK_03 — Piloto Controlado Enterprise (Sprint 6)

## Objetivo
Executar piloto controlado com **1-2 tenants enterprise** para validar estabilidade operacional, isolamento multi-tenant e governança de rollout antes de expansão geral.

## Escopo técnico implementado
- Gating de rollout por tenant via Script Properties:
  - `ENTERPRISE_PILOT_ENABLED`
  - `ENTERPRISE_PILOT_TENANTS`
  - `ENTERPRISE_PILOT_MAX_TENANTS` (default: 2)
- Bloqueio de rotas enterprise para tenants fora do piloto:
  - código: `enterprise_pilot_restrito`
- Bloqueio para tenants sem plano enterprise:
  - código: `enterprise_plan_required`
- Exceção operacional mantida:
  - `billing.assinatura.status` permanece acessível para diagnóstico/comercial.

## APIs do piloto
- `admin.piloto.status`
  - retorna se tenant atual está no piloto, vagas restantes e capacidade.
- `admin.piloto.inscrever`
  - inscreve tenant atual quando houver vaga e plano enterprise.
- `admin.piloto.remover`
  - remove tenant atual do piloto.

## Plano operacional (1-2 tenants)
1. Selecionar 1 tenant enterprise canário e 1 tenant backup.
2. Habilitar piloto (`ENTERPRISE_PILOT_ENABLED=true`).
3. Definir capacidade (`ENTERPRISE_PILOT_MAX_TENANTS=2`).
4. Inscrever canário via `admin.piloto.inscrever`.
5. Monitorar por 7 dias:
   - `observabilidade.status` (24h),
   - erros por código,
   - auditoria de mutações e rotas admin/billing.
6. Inscrever segundo tenant se métricas estiverem saudáveis.

## Critérios de avanço do piloto
- Taxa de erro < 2% por 7 dias consecutivos nos tenants do piloto.
- Ausência de incidente SEV1 e zero vazamento cross-tenant confirmado.
- Contratos API (`runApiContractTests()`) sem regressão.

## Rollback
- Desinscrever tenant via `admin.piloto.remover`; ou
- Desativar rollout (`ENTERPRISE_PILOT_ENABLED=false`) para liberar/bloquear conforme estratégia operacional.
