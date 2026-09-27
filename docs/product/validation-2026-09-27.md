# Validação local — 27/09/2026

Continuação v0.12, apenas com dados sintéticos. O código do repositório e a API local foram a referência para esta verificação. PostgreSQL, Keycloak, Redis e S3Mock de desenvolvimento estavam ativos; a API foi iniciada em `/app` e `/health/ready` respondeu `ready`.

| Verificação | Resultado observado |
|---|---|
| `npm run db:migrate` e `npm run db:seed` | Passaram no banco de desenvolvimento, com seed fictício reaplicado |
| `npm run typecheck` e `npm test` | Passaram; seis testes de domínio/contratos/interface e quatro testes de API |
| `npm run test:integration` | Quatro suítes passaram em `gpcfc_fresh_test`, banco descartável terminado em `_test` e migrado até 021 |
| `npm run smoke:dev` | Fluxo HTTP com token Keycloak local passou, incluindo aluno, matrícula, processo, tarefas, créditos, financeiro, agenda e relatório |
| `/app` no navegador | Login local, busca de horários, reserva de aula e exame prático interno no mesmo dia, conflitos refletidos nas sugestões, agenda e próximos compromissos do Aluno 360 conferidos |

A entrada foi revisada depois da v0.12 inicial: agora mostra apenas compromissos futuros ativos de aula e exame, e a busca rápida abriu automaticamente o aluno sintético com resultado único. A navegação compacta mostrou as seis áreas sem corte no navegador estreito.

A consulta `GET /schedule/availability` considera processo ativo, disponibilidade semanal, bloqueios, reservas de recursos e compromissos do aluno. Ela oferece sugestões provisórias; a transação de agendamento continua conferindo os conflitos. O modo de candidatos para exame omite saldos de crédito e funciona sem `credit.read`; teste integrado confirma a separação de permissão. A linha do tempo do aluno inclui eventos de exame sob `exam.read`.

O navegador do usuário continha uma autorização antiga com `redirect_uri=file:///app`, recusada pelo Keycloak. A aba foi levada à URL local `http://127.0.0.1:3000/app`, onde o login PKCE funcionou. Abrir o arquivo HTML por `file:` agora redireciona para essa URL antes do login.

Os agendamentos, pagamentos e ativações ainda são limitados a `development`/`test` até validação das regras operacionais pela equipe GP. O exame é uma agenda interna e não confirma vaga oficial. Assinatura digital não integra o escopo do MVP. Restam testes de usabilidade com a GP, regras de pacote/vencimento/cancelamento/estorno, integração ou confirmação da fonte oficial de exames, staging, restore de staging, p95, acessibilidade e controles de produção antes do piloto.
