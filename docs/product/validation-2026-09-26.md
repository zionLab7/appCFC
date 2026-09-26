# Validação local — 26/09/2026

Continuação sobre a base v0.4, usando apenas alunos, pacotes e contas fictícias. O repositório GitHub fornecido pelo usuário era público e vazio; a branch local `main` foi publicada nele. `.env`, `node_modules` e `GP_CFC_CONTEXT/` não foram enviados. O `gh` do terminal está com autenticação expirada, mas o Git conseguiu publicar usando a credencial local configurada.

| Verificação | Resultado observado |
|---|---|
| migration 012 e seed | Aplicados no PostgreSQL de desenvolvimento; migration 012 também aplicada em `gpcfc_fresh_test` |
| `npm run typecheck` | Passou |
| `npm test` | 9 testes locais passaram, incluindo sintaxe/IDs da interface e contratos de eventos |
| `npm run test:integration` | 2 testes PostgreSQL passaram no banco `_test`: fila por unidade/papel/responsável, vencimento, paginação inclusive sem prazo, auditoria/outbox, concorrência e rollback |
| `npm run smoke:dev` | Token Keycloak, fluxo HTTP, fila e eventos de tarefa passaram |
| `/app` no navegador | Login, área de tarefas, lista e abertura do processo do aluno confirmados |
| GitHub Actions | Execução [36239760004](https://github.com/zionLab7/appCFC/actions/runs/36239760004) passou no commit `b31bb48469d54564ca3ba90744e058ec072614e5` |

As tarefas geradas por processos anteriores à v0.5 continuam existentes, mas só as tarefas criadas ou fechadas após esta versão possuem eventos próprios `task.created.v1` e `task.closed.v1`. O dispatcher da outbox, staging, p95, assinatura real e demais fluxos do MVP seguem pendentes.

## Continuação v0.6 no mesmo dia

| Verificação | Resultado observado |
|---|---|
| migrations 013–016 e seed | Aplicados ao PostgreSQL de desenvolvimento; migrations aplicadas em `gpcfc_fresh_test`; seed fictício reaplicado para novos grants |
| `npm run typecheck` e `npm test` | Passaram; 9 testes locais |
| integração PostgreSQL `_test` | 2 suítes passaram: grants e recebível na ativação, pagamento parcial, concorrência, estorno/reversão, journal balanceado, reserva simultânea, hold/liberação/consumo, bloqueio e isolamento |
| smoke com token Keycloak | Fluxo HTTP de matrícula, créditos, pagamento, estorno, aula reservada/cancelada/concluída e timeline passou com dados sintéticos |
| `/app` no navegador | Login, matrícula com créditos e financeiro, aba Agenda, lista de aulas/recursos e diálogo de novo recurso observados |

O vencimento de 30 dias, presença confirmada e políticas de cancelamento/estorno são hipóteses **somente de demonstração**. Operações de ativação, pagamento/estorno e aula são recusadas fora de `development`/`test`. Matrículas ativadas em versões anteriores não recebem backfill automático. O CI remoto da v0.6 será registrado depois da publicação.

## Continuação v0.11 — marcação direta e exames práticos

A migration 021 foi aplicada no PostgreSQL de desenvolvimento e em `gpcfc_fresh_test`, seguida de seed fictício. `npm run typecheck`, `npm test` (10 testes locais), `npm run test:integration` (4 suítes PostgreSQL no banco `_test`) e validação YAML do OpenAPI passaram. O teste integrado cobre concorrência de exame, conflito com aula, filtro por dia, idempotência, isolamento de unidade, cancelamento com liberação de recursos, resultado e eventos de outbox.

`npm run smoke:dev` passou com token do Keycloak e dados sintéticos. No navegador, foi possível marcar diretamente uma aula em 05/10/2026 às 10h e um exame prático interno em 06/10/2026 às 10h, ambos visíveis na Agenda; o filtro de 06/10 retornou o exame, e seu cancelamento pela caixa de diálogo atualizou o estado para Cancelado. Nenhum dado real foi usado. A agenda de exame não interage com órgão oficial. Regras de elegibilidade, políticas comerciais e horários reais ainda aguardam validação da equipe GP antes do piloto. Assinatura digital foi retirada do escopo do MVP por decisão do usuário.

## Continuação v0.7 no mesmo dia

A v0.6 [passou no CI remoto](https://github.com/zionLab7/appCFC/actions/runs/36244137353). A migration 017, o seed e a migration 018 foram aplicados no banco de desenvolvimento e em `gpcfc_fresh_test`. O relatório por unidade passou em teste integrado, smoke HTTP com token e inspeção visual da quinta aba. O dispatcher passou em teste integrado de falha, retry, lease concorrente e ID estável; a assinatura HMAC foi verificada contra um receptor HTTP local. `npm run typecheck` e `npm test` passaram após essa mudança. Nenhum webhook externo foi configurado ou chamado.

## Continuação v0.8 no mesmo dia

A v0.7 [passou no CI remoto](https://github.com/zionLab7/appCFC/actions/runs/36244723354). Um `pg_dump` do banco de desenvolvimento **sintético** foi restaurado em `gpcfc_restore_probe_20260926_test`; a cópia tinha 18 migrations, 1 organização, 17 alunos e 184 eventos de outbox. O banco descartável e o dump foram removidos após a conferência. Isto valida restore local, não backup operacional em staging.

As migrations 019–020 foram aplicadas no banco local e no `gpcfc_fresh_test`; seed fictício reaplicado. Elas introduzem permissões de documentos, revisão, versão imutável e vínculo de contrato consistente com a matrícula. A API e a interface fazem solicitação, upload privado S3 compatível, revisão e download com checagem de SHA-256 e auditoria de leitura. Contrato permanece `DRAFT` mesmo se o documento for aceito. `npm run typecheck`, `npm test` (10 testes locais), `npm run test:integration` (4 suítes no `_test`), validação YAML do OpenAPI e `git diff --check` passaram. Um smoke HTTP com token Keycloak enviou PDF fictício de 32 bytes ao S3Mock, listou, baixou byte a byte e revisou para `ACCEPTED`; `/health/ready` respondeu 200. A seção de documentos foi aberta na interface local para o mesmo aluno sintético. Nenhum dado real foi usado.

Pendências para o MVP operacional: provedor e evidência verificável de assinatura, regras reais de pacote/vencimento/cancelamento/estorno com responsável da equipe GP a indicar, varredura de arquivos, staging isolado com restore e segredos próprios, p95 no dataset piloto, MFA e hardening de acesso, aceites nas três unidades e dupla operação com o legado. O provedor de assinatura foi informado como ainda não definido; a fronteira configurável está descrita no ADR-007.

## Continuação v0.9 no mesmo dia

A v0.8 [passou no CI remoto](https://github.com/zionLab7/appCFC/actions/runs/36245649708). A API passou a listar apenas unidades ativas vinculadas ao usuário; a interface usa essa lista em vez de três IDs fixos. A entrada agora é uma visão de prioridades com atalhos, tarefas, aulas e indicadores; blocos sem permissão aparecem como indisponíveis. A lista inicial de alunos mostra 10 por vez. A tela nova foi aberta no navegador com token Keycloak e a troca de unidade foi observada. O teste integrado valida que vínculo removido some da lista de unidades. Ainda não há gestão de papéis/usuários pela UI nem aceite de UX da equipe GP.

A v0.9 [passou no CI remoto](https://github.com/zionLab7/appCFC/actions/runs/36246060311). Após essa publicação, uma referência local de 100 leituras autenticadas por endpoint mediu p95 de 2,65 ms em alunos, 4,56 ms em tarefas e 4,40 ms em relatório; método e limites constam em [performance-baseline-2026-09-26.md](performance-baseline-2026-09-26.md). Isto não conclui o gate de performance do piloto.

## Continuação v0.10 no mesmo dia

O relatório operacional ganhou consolidação por unidades com `report.read` ativo, devolvendo também as parcelas por unidade. O teste integrado confirma uma unidade visível, nega a segunda antes da autorização e soma duas depois do vínculo, incluindo financeiro. A interface oferece acesso explícito ao consolidado na área Relatórios. As medições de latência anteriores não cobrem este novo endpoint.
