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
