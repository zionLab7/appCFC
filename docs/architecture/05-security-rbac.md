# RBAC, auditoria e proteção de dados

| Permissão | Gestor | Secretaria | Comercial | Financeiro | Instrutor | Coordenador | Worker |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| student.read | ✓ | ✓ | limitada | limitada | turma própria | ✓ | por job |
| student.write | ✓ | ✓ | contato | — | — | limitada | — |
| enrollment.write | ✓ | ✓ | proposta | — | — | — | — |
| process.transition | ✓ | ✓ | — | — | aula própria | ✓ | — |
| task.read | ✓ | ✓ | — | — | atribuída | ✓ | — |
| credit.read | ✓ | ✓ | — | ✓ | — | ✓ | — |
| finance.read | ✓ | autorizada | — | ✓ | — | — | — |
| resource.read/write | ✓ | leitura | — | — | leitura | ✓ | — |
| lesson.book | ✓ | ✓ | — | — | — | ✓ | — |
| lesson.read/cancel/complete | ✓ | autorizada | — | — | aula própria | ✓ | — |
| report.read | ✓ | — | — | leitura restrita | — | ✓ | — |
| payment.receive | ✓ | autorizada | — | ✓ | — | — | — |
| payment.refund | ✓ + razão | — | — | ✓ + aprovação | — | — | — |
| automation.execute | ✓ | autorizada | — | — | — | autorizada | job próprio |
| audit.read | ✓ | — | — | limitada | — | — | — |

Matriz é modelo de produto; grant exato configurável por organização, unidade e papel. Verificar permissão em cada comando e limitar listas por unidades ativas do usuário; o mesmo usuário pode ter papéis diferentes na Ponte Rasa, Penha e Mooca. Para ações financeiras sensíveis, MFA e aprovação em separado são requisitos antes de operação.

`task.read` permite ver a identificação do aluno ligada à tarefa. A fila limita resultados à unidade ativa; não gestores veem tarefas atribuídas a si ou ao próprio papel, e gestores podem consultar a fila da unidade. O filtro “minha fila” restringe a tarefas atribuídas diretamente ou ao papel do usuário. A leitura é sem mutação; abertura e fechamento transacionais de tarefas produzem auditoria e eventos junto com a transição de processo.

`audit_event` registra actor, escopo, ação, entidade, correlação, razão e diffs redigidos quando possível. Ledger registra fatos financeiros; auditoria registra autoria. Leituras/exportações de dados sensíveis requerem eventos de segurança separados no Sprint de hardening. Não colocar CPF completo ou documentos em logs. Regras de retenção e solicitações LGPD precisam de definição jurídica antes do deploy real; preservar obrigações legais e rastreabilidade.

**Ameaças prioritárias:** acesso entre tenants via ID adivinhado, funcionário navegando unidade sem permissão, replay de webhook, dupla cobrança, roubo de cache local, credencial de portal vazada. Testes obrigatórios para cada classe, rate limit e assinatura de webhooks, device encryption e logout remoto. A API agora valida assinatura, emissor, audiência e expiração OIDC; `user_identity` vincula subject ao usuário ativo. Ainda faltam MFA, RLS, secret manager, rate limiting e autorização para uso com dados reais.
