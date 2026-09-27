# GP CFC — Desenvolvimento v0.12

Continuação do Technical Design & Implementation Pack v0.1, derivada da **Especificação GP CFC v0.1**. Código e modelo são novos; o InforCFC serviu apenas para levantamento de necessidades. Estado: **fundação de desenvolvimento**, não produto pronto nem migração homologada.

## O que funciona neste pacote

- Ambiente local PostgreSQL 16, Redis 7, Keycloak de desenvolvimento e S3Mock para testes de armazenamento via Docker Compose. PostgreSQL usa a porta local `55432` para não conflitar com instalações locais.
- Migrations SQL controladas por versão (controle em `schema_migrations`) e dados fictícios de desenvolvimento.
- API TypeScript com health/meta, cadastro, busca e linha do tempo do aluno, catálogo versionado por unidade, matrícula, workflow, fila de tarefas, créditos, recebível e pagamentos manuais sintéticos com estorno, instrutores/veículos, reserva/cancelamento/conclusão sintética de aula e agenda interna de exames práticos. Mutations usam token OIDC, permissões por unidade, auditoria e idempotência.
- Interface local em `/app` com login Keycloak PKCE, visão inicial de prioridades, áreas de alunos, tarefas, agenda com marcação direta de aulas e exames práticos, catálogo e relatórios por unidade. A Agenda sugere horários com instrutor e veículo livres, permite selecionar um horário e confirma conflitos ao salvar. O detalhe do aluno mostra próximos compromissos, documentos, matrículas, créditos e financeiro de demonstração.
- Documentos por aluno ou matrícula: solicitação, versão privada em storage S3 compatível, SHA-256, revisão e download autorizado. Solicitar `CONTRACT` cria vínculo de contrato em rascunho, sem assinar.
- Dispatcher opcional da outbox para webhook HTTPS com assinatura HMAC, lease, retry exponencial e ID estável; consumidores devem deduplicar por `eventId`.
- Contratos OpenAPI e JSON Schema, exemplos de workflow, modelo de dados, regras e backlog de implementação.
- Testes de domínio e integração PostgreSQL para isolamento, concorrência de matrícula, workflow, pagamento e reserva de aula, snapshot de pacote, rollback, totais de relatório e entrega da outbox.

O repositório Git local usa a branch `main`, associada ao repositório [zionLab7/appCFC](https://github.com/zionLab7/appCFC). O GitHub indicado é público; o dossiê `GP_CFC_CONTEXT/` e o arquivo `.env` ficam fora do versionamento.

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

O Compose não inicia a API automaticamente. O comando `dev:api` executa o backend de desenvolvimento; desktop e mobile seguem como pontos de extensão. O dispatcher em `apps/worker` só inicia com `DATABASE_URL`, `OUTBOX_WEBHOOK_URL` e `OUTBOX_WEBHOOK_SECRET`; não há receptor externo configurado por padrão. Ativação, recebimento/estorno, reserva/cancelamento/conclusão de aula e marcação de exame prático usam dados sintéticos e só estão habilitados em `NODE_ENV=development` ou `test` até a equipe GP validar regras operacionais. A ativação cria um recebível com uma parcela fictícia vencendo em 30 dias e créditos para cada item do pacote; matrículas ativadas antes da v0.6 não são alteradas automaticamente. A agenda de exame é **interna** e não reserva vaga em órgão de trânsito. Nenhum gateway, portal oficial, worker de navegação, sync SQLite, pagamento ou reserva real está ligado à API nesta versão. S3Mock é apenas para desenvolvimento; a API aceita PDF/PNG/JPEG até 5 MB. Configure `S3_BUCKET`, `S3_REGION` e credenciais de storage privado por ambiente antes de um deploy. Assinatura digital fica fora do escopo deste MVP. O contrato pode permanecer em rascunho ou ser tratado pelo processo manual acordado com a GP; aceitar o arquivo de contrato **não** significa assinar. Varredura de malware, retenção e acesso seguro em produção ainda precisam de implementação/homologação.

Os registros dos comandos e resultados efetivamente observados estão em `docs/product/validation-2026-09-25.md`, `docs/product/validation-2026-09-26.md` e `docs/product/validation-2026-09-27.md`.

## Organização

`apps/api` é o bootstrap modular HTTP; `apps/web` contém a primeira interface local. `packages/domain` contém regras puras; `packages/database` contém migrations/seeds; `packages/contracts` contém os contratos. `apps/worker`, `apps/desktop` e `apps/mobile` seguem como fronteiras. `docs` concentra arquitetura, ADRs, modelo ER, UX, backlog e plano de testes. O mapeamento dos 37 entregáveis está em `docs/product/deliverables-index.md`.

## Começando a desenvolver

1. Execute os comandos acima e confirme `/health/ready`.
2. Leia `docs/product/mvp-and-roadmap.md`, `docs/product/sprint-0-and-1.md` e `docs/architecture/02-domains.md`.
3. Continue `ST-01` a `ST-08`, respeitando invariantes do banco e contratos da API. Catálogo, matrícula e workflow têm uma fatia funcional de desenvolvimento; os critérios de produção e piloto permanecem abertos.
4. Para uma migration, crie o próximo arquivo `NNN_nome.sql`; `npm run db:migrate` aplica cada arquivo uma vez, dentro de uma transação.

Os testes de unidade executam com `npm test`. Os testes de integração exigem um banco **exclusivo e descartável** com as migrations: defina `GP_CFC_TEST_DATABASE_URL` e rode `npm run test:integration`. Não use o banco de desenvolvimento ou produção para essa suíte. Não use CPFs, chaves ou URLs de exemplo com dados reais. Não conecte este pacote diretamente aos sistemas legados; a importação será um projeto separado com reconciliação.
