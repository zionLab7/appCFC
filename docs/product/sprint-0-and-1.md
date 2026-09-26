# Sprint 0 e Sprint 1 — execução

**Estado verificado em 25/09/2026:** migrations 001–011 e seed passaram no PostgreSQL local; Keycloak autenticou a API com token; testes de domínio e integração em bancos `_test` passaram. ST-03/ST-07 (cadastro, busca, detalhe e trilha) e ST-04/ST-05/ST-06 têm fatia funcional de desenvolvimento e tela local; critérios de contrato real, workflow operacional, performance piloto e staging ainda não estão aceitos. ADR-006 registra a decisão reversível de manter HTTP modular nesta fatia.

**Avanço em 26/09/2026:** migration 012, permissão `task.read`, fila paginada com filtros de vencimento e responsável, auditoria/outbox de tarefas e terceira área da interface foram validadas localmente. A branch `main` foi publicada em `zionLab7/appCFC` e o CI remoto da v0.5 passou. A v0.6 acrescentou migrations 013–016 e fatias sintéticas de financeiro, crédito e agenda. Staging e critérios de operação real permanecem abertos.

**Ainda em 26/09/2026:** a v0.6 passou no CI remoto. A v0.7 acrescenta relatório operacional por unidade e dispatcher assinado da outbox com retry e lease. Restam critérios de Sprint 0 como staging, backup/restore, p95, secret management e aceite de operação real; manter as stories abertas até esses gates passarem.

**Continuação v0.8:** restore local sintético em banco `_test` passou, e documentos ganharam armazenamento privado, revisão e download auditado. O contrato é apenas rascunho, pois o provedor de assinatura ainda será escolhido. Staging, restore de staging, p95, regras da equipe GP e controles de produção continuam pendentes.

## Sprint 0 — fundação (5 dias úteis, estimativa inicial)

Objetivo: transformar o scaffold em base segura para equipe e deploy de teste. **Dia 1:** criar repositório remoto/branch protection, instalar dependências e registrar lockfile; conferir Compose/migrations em ambiente do desenvolvedor. **Dia 2:** trocar bootstrap HTTP por NestJS modular, validar variáveis e erro padrão com correlation ID. **Dia 3:** integrar OIDC de desenvolvimento com sessão, organização/unidade, RBAC real, retirar `X-Dev-User` e teste de negação cruzada. **Dia 4:** CI com PostgreSQL real, lint/typecheck/contract/migration tests, análise de secret e outbox simples. **Dia 5:** subir staging isolado, backup+restore de teste, runbook e revisão de performance baseline. Saída: ST-01/ST-02/ST-08 aceitas; nunca habilitar dados reais com a autenticação do protótipo.

## Sprint 1 — fatia vertical aluno→matrícula→processo (10 dias úteis, estimativa inicial)

| Ordem | Story | Entrega concreta | Aceite bloqueante |
|---|---|---|---|
| 1 | ST-03 | `POST /students`, deduplicação, busca e validação | sem CPF válido também possível; idempotência e isolamento |
| 2 | ST-07 | `GET /students/{id}`, lista cursor, Aluno 360 básico | escopo em lista e ID, p95 medido |
| 3 | ST-04 | CRUD de catálogo em draft, publicar versão | versão publicada imutável e contrato consistente |
| 4 | ST-05 | matrícula draft/activate; processo v1 no commit | sem órfão; mesmo request repetido não duplica |
| 5 | ST-06 | transição de etapa, pré-condições, tarefa e outbox | dupla transição concorrente produz um fato |
| 6 | QA | E2E do fluxo e tela funcional web | caminho feliz, bloqueios, vazio, erro, sem permissão |

**Pronto para planejamento:** schema, endpoints, eventos, wireframes, dependências e critérios estão neste pacote. **Bloqueios de negócio a decidir durante Sprint 1:** pacote e regras comerciais reais, tipologia de serviço/categoria em SP, roteiro de contrato e dados legados exportáveis. Usar dados fictícios até validação formal.

## Definition of Done

Regra de domínio, autorização por unidade, auditoria/outbox, migração, OpenAPI, teste de isolamento, teste concorrente quando aplicável, estados de UX, documentação e telemetria. Nenhuma mutation financeira ou de agenda é liberada sem testes PostgreSQL reais de rollback, duplicidade e concorrência. Critérios de performance medidos no hardware e dataset do piloto.
