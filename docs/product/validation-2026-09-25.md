# Validação local — 25/09/2026

Ambiente: macOS, Node 26.7.0, npm 11.19.0, Docker 29.1.5, Compose 5.0.1. A pasta `gp-cfc` recebida não contém `.git` nem remoto. A porta 5432 já era usada por outro PostgreSQL local; o Compose do projeto publica seu banco em `127.0.0.1:55432`. Nenhum dado real foi usado.

| Verificação | Resultado observado |
|---|---|
| `docker compose up -d` | PostgreSQL saudável; Redis, Keycloak e S3Mock em execução |
| `npm ci` | Dependências instaladas do lockfile |
| migrations 001–011 | 001–010 aplicadas em `gpcfc` e, do zero, em `gpcfc_fresh_test`; 011 aplicada nos dois bancos |
| seed sintético | Aplicado e reaplicado em desenvolvimento e no banco novo |
| `npm run typecheck` | Passou |
| `npm test` | 8 testes passaram (5 de domínio/contrato, 3 da API) |
| `npm run test:integration` | 2 testes integrados passaram em bancos dedicados terminados em `_test`, com isolamento por unidade/organização, imutabilidade, rollback, idempotência e concorrência |
| `npm run smoke:dev` | Health, token Keycloak, aluno, busca, contato, catálogo, publicação, matrícula, ativação, processo, transição e linha do tempo passaram pela API HTTP |
| `/app` no navegador | Login PKCE, busca por telefone, contato, matrícula, linha do tempo, catálogo, processo v2 e próxima tarefa confirmados; estilo do detalhe corrigido após inspeção visual |
| OpenAPI/eventos | YAML e arquivos JSON analisados sintaticamente; SHA256SUMS regenerado |

Falhas corrigidas durante a validação: cursor de aluno com perda de microssegundos; campos obrigatórios do usuário fictício Keycloak; imagem MinIO indisponível no Compose, substituída por S3Mock de desenvolvimento; definições de permissão que dependiam indevidamente do seed; ausência de guards de integridade entre matrícula/processo/workflow/tarefa. O emissor de tokens deve ser solicitado por `localhost`, conforme `.env.example`.

Continuação: catálogo novo limitado à unidade; matrícula cruzada bloqueada por API e trigger; busca de aluno por nome, CPF e telefone, contato e auditoria paginada testados no PostgreSQL `_test`. A página nova foi verificada por sintaxe, smoke das rotas e interação real no navegador com a conta fictícia.

Git local iniciado em `main`, sem remoto; `.env`, `node_modules` e `GP_CFC_CONTEXT/` ignorados. A interface redesenhada teve navegação Atendimento/Catálogo, busca por telefone, detalhe do aluno e diálogos inspecionados no navegador. `npm test` passou com 9 testes locais, incluindo verificação de sintaxe/IDs da interface; 2 testes integrados passaram em `gpcfc_fresh_test`, assim como `npm run typecheck`.

Limites: não houve execução observada do CI remoto, staging, backup/restore, p95 no hardware piloto, análise de segredos, dispatcher da outbox, integração de documentos/assinatura, agenda, financeiro/créditos operacionais, regras oficiais ou uso com dados reais. A ativação de demonstração só aceita `NODE_ENV=development` ou `test`.
