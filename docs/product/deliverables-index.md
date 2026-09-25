# Índice dos 37 itens pedidos

| Item | Onde consultar | Estado |
|---|---|---|
| 1 arquitetura/ADRs | `docs/architecture/01-system.md`, `adr/` | especificado |
| 2 monorepo | raiz `apps/`, `packages/`, `docs/`, `scripts/` | scaffold |
| 3 ERD completo | `docs/architecture/erd-full.mmd` | 66 tabelas, gerado do DDL |
| 4–5 schema/migrations | `packages/database/migrations/001–006_*.sql` | DDL escrito; aguarda Postgres real |
| 6 seeds | `packages/database/seeds/dev.sql` | fictício, idempotente |
| 7–8 módulos/entidades/agregados/VO/serviços | `docs/architecture/02-domains.md` | especificado; regras puras iniciais |
| 9 OpenAPI | `packages/contracts/openapi.yaml` | contrato alvo; rotas planejadas marcadas |
| 10 eventos | `packages/contracts/events/` | envelope e três payloads iniciais |
| 11 workflow | `docs/architecture/04-engines.md`, `packages/workflows/` | algoritmo e exemplo; implementação parcial pura |
| 12 agenda/locks | migrations 003, docs de motores, `packages/domain/src/scheduling.ts` | constraints e regra pura; serviço pendente |
| 13–14 financeiro e créditos | migrations 003/005, docs de motores, `packages/domain/src/credit.ts` | esquema/regras; endpoints pendentes |
| 15 automação regulatória | migration 004, `apps/worker/README.md`, docs de motores | arquitetura; adapters pendentes |
| 16 RBAC | `docs/architecture/05-security-rbac.md`, migration 001 | matriz e tabelas; OIDC pendente |
| 17 auditoria/event log | migrations 001/004, docs 01/05 | tabelas/outbox; pipeline pendente |
| 18–20 local first/sync/cache | `docs/architecture/06-desktop-sync.md`, 01-system | estratégia; cliente pendente |
| 21–22 Docker/config inicial | `docker-compose.yml`, `.env.example`, `scripts/` | escrito; Docker não disponível aqui |
| 23 convenções | `docs/architecture/01-system.md` | definido |
| 24–25 testes/observabilidade | `docs/architecture/07-testing-and-operations.md`, 01-system, testes | testes de domínio executados; integração pendente |
| 26–27 wireframes/UX | `docs/ux/prototype.html`, `wireframes.md` | 5 telas ilustrativas |
| 28–31 stories/aceite/backlog/dependências | `docs/product/backlog.md` | 21 épicos, 8 stories detalhadas |
| 32–33 roadmap/MVP | `docs/product/mvp-and-roadmap.md` | definido com gates |
| 34–35 Sprint 0 e 1 | `docs/product/sprint-0-and-1.md` | sequência e aceite |
| 36–37 README/comandos | `README.md`, package scripts | pronto para ambiente com Docker/npm |

Estado é deliberadamente granular: um contrato desenhado não significa que sua rota funciona. Para a capacidade já executável veja `docs/product/source-and-status.md`.
