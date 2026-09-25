# GP CFC — Desenvolvimento v0.4

Continuação do Technical Design & Implementation Pack v0.1, derivada da **Especificação GP CFC v0.1**. Código e modelo são novos; o InforCFC serviu apenas para levantamento de necessidades. Estado: **fundação de desenvolvimento**, não produto pronto nem migração homologada.

## O que funciona neste pacote

- Ambiente local PostgreSQL 16, Redis 7, Keycloak de desenvolvimento e S3Mock para testes de armazenamento via Docker Compose. PostgreSQL usa a porta local `55432` para não conflitar com instalações locais.
- Migrations SQL controladas por versão (controle em `schema_migrations`) e dados fictícios de desenvolvimento.
- API TypeScript com health/meta, cadastro, busca por nome/CPF/telefone e linha do tempo do aluno, catálogo versionado por unidade, matrícula, ativação e transições de processo com token OIDC, permissões por unidade, auditoria e idempotência.
- Interface local em `/app` com login Keycloak PKCE, busca e Aluno 360 inicial, catálogo, matrícula e tarefas do processo.
- Contratos OpenAPI e JSON Schema, exemplos de workflow, modelo de dados, regras e backlog de implementação.
- Testes de domínio e integração PostgreSQL para isolamento, concorrência, snapshot de pacote, rollback e workflow.

O repositório Git local foi inicializado na branch `main`. Nenhum remoto foi associado; o dossiê `GP_CFC_CONTEXT/` e o arquivo `.env` ficam fora do versionamento. Configure um remoto privado escolhido pela GP antes de publicar código.

## Requisitos e comandos

Node.js 24 LTS, npm 11, Docker com Compose. Em um terminal:

```bash
cp .env.example .env
docker compose up -d
npm ci
npm run db:migrate
npm run db:seed
npm run typecheck
npm test
npm run dev:api
```

O lockfile já está incluído. Aguarde o Keycloak concluir a importação do realm de desenvolvimento. Para checar a API: `curl http://localhost:3000/health/ready`. Obtenha um token de desenvolvimento e faça a consulta:

```bash
curl -sS -X POST 'http://localhost:8080/realms/gp-cfc-dev/protocol/openid-connect/token' \
  -d 'grant_type=password&client_id=gp-cfc-dev&username=gestor-demo&password=dev-password-only'
# Copie o campo access_token da resposta para TOKEN e execute:
curl -H "Authorization: Bearer $TOKEN" \
  -H 'X-Organization-Id: 00000000-0000-4000-8000-000000000001' \
  http://localhost:3000/api/v1/students
```

O realm e a senha são **exclusivos para desenvolvimento**. Em implantação, configure `OIDC_ISSUER`, `OIDC_JWKS_URI` e `OIDC_AUDIENCE` para o provedor real por HTTPS, crie os vínculos `user_identity` dos usuários e não importe o seed. `X-Dev-User` não é aceito. O emissor do token precisa ser `http://localhost:8080/realms/gp-cfc-dev`; solicitar token por `127.0.0.1` muda o issuer e é recusado. `POST /api/v1/students` exige `Idempotency-Key` (8–128 caracteres), JSON com `unitId`, `fullName`, telefone e CPF válido opcionais; `GET /api/v1/students` aceita `unitId`, `limit` e `cursor`. Para procurar CPF sem registrá-lo na URL, use `POST /api/v1/students/search` com `query` no JSON. `GET /api/v1/students/{id}/timeline` devolve auditoria paginada.

Abra [a interface local](http://127.0.0.1:3000/app) após iniciar a API. Entre com `gestor-demo` / `dev-password-only` no Keycloak local. Para validar o fluxo HTTP completo com dados novos e fictícios:

```bash
GP_CFC_DEV_USERNAME=gestor-demo GP_CFC_DEV_PASSWORD=dev-password-only npm run smoke:dev
```

Para os testes integrados, crie um banco descartável terminado em `_test`, migre esse banco e passe `GP_CFC_TEST_DATABASE_URL`. Exemplo para o Compose local:

```bash
docker compose exec -T postgres createdb -U gpcfc gpcfc_test
DATABASE_URL=postgres://gpcfc:gpcfc_dev_only@127.0.0.1:55432/gpcfc_test node scripts/migrate.mjs
GP_CFC_TEST_DATABASE_URL=postgres://gpcfc:gpcfc_dev_only@127.0.0.1:55432/gpcfc_test npm run test:integration
```

O Compose não inicia a API automaticamente. O comando `dev:api` executa o backend de desenvolvimento; desktop, mobile e worker seguem como pontos de extensão. A ativação usa `demoActivationConfirmed` e só está habilitada em `NODE_ENV=development` ou `test` até existir contrato assinado e regras operacionais validadas. Nenhum gateway, portal oficial, worker de navegação, sync SQLite, pagamento ou reserva real está ligado à API nesta versão. S3Mock é apenas para desenvolvimento e ainda não há API de documentos.

O registro dos comandos e resultados efetivamente observados está em `docs/product/validation-2026-09-25.md`.

## Organização

`apps/api` é o bootstrap modular HTTP; `apps/web` contém a primeira interface local. `packages/domain` contém regras puras; `packages/database` contém migrations/seeds; `packages/contracts` contém os contratos. `apps/worker`, `apps/desktop` e `apps/mobile` seguem como fronteiras. `docs` concentra arquitetura, ADRs, modelo ER, UX, backlog e plano de testes. O mapeamento dos 37 entregáveis está em `docs/product/deliverables-index.md`.

## Começando a desenvolver

1. Execute os comandos acima e confirme `/health/ready`.
2. Leia `docs/product/mvp-and-roadmap.md`, `docs/product/sprint-0-and-1.md` e `docs/architecture/02-domains.md`.
3. Continue `ST-01` a `ST-08`, respeitando invariantes do banco e contratos da API. Catálogo, matrícula e workflow têm uma fatia funcional de desenvolvimento; os critérios de produção e piloto permanecem abertos.
4. Para uma migration, crie o próximo arquivo `NNN_nome.sql`; `npm run db:migrate` aplica cada arquivo uma vez, dentro de uma transação.

Os testes de unidade executam com `npm test`. Os testes de integração exigem um banco **exclusivo e descartável** com as migrations: defina `GP_CFC_TEST_DATABASE_URL` e rode `npm run test:integration`. Não use o banco de desenvolvimento ou produção para essa suíte. Não use CPFs, chaves ou URLs de exemplo com dados reais. Não conecte este pacote diretamente aos sistemas legados; a importação será um projeto separado com reconciliação.
