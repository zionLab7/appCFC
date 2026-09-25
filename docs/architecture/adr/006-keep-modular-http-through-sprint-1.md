# ADR-006 — Manter HTTP modular nesta fatia de desenvolvimento

Status: aceito em 25/09/2026; complementa ADR-005.

Após executar PostgreSQL, Keycloak, migrations e testes integrados reais, mantivemos o servidor HTTP TypeScript pequeno para entregar e verificar a transação catálogo → matrícula → processo. Os módulos `catalog`, `enrollments`, `processes`, `auth` e `students` concentram as regras; PostgreSQL guarda as invariantes de concorrência e imutabilidade. O contrato OpenAPI documenta as rotas. Esta é uma escolha reversível para o ambiente de desenvolvimento: a API não usa estado de framework nos módulos de domínio.

NestJS continua como avaliação antes de staging multiusuário. A migração exigirá teste de paridade dos endpoints, identidade, idempotência, erros e correlação. Não declarar Sprint 0 concluída por esta decisão: lint, observabilidade, rate limit, outbox dispatcher, staging, backup/restore e análise de segredos ainda são pendências.
