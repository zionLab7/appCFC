# Wireframes funcionais e fluxos prioritários

Abra `prototype.html` no navegador para ver cinco telas navegáveis de baixa fidelidade: Central Operacional, Aluno 360, matrícula, agenda e financeiro. Os controles são ilustrativos e não persistem dados.

## Shell operacional

Topo com seletor de unidade, busca global, notificações e perfil. Navegação lateral para Início, Alunos, Matrículas, Agenda, Processos, Financeiro e Relatórios. O centro prioriza tarefas vencidas, alunos bloqueados, aulas próximas e automações com falha.

## Aluno 360

Cabeçalho com matrícula, unidade e próxima ação; abas Resumo, Jornada, Agenda, Financeiro, Documentos, Conversas e Histórico. Cartões mostram etapa, motivo de bloqueio, aulas disponíveis e ações autorizadas. Timeline registra autoria e evidência.

## Matrícula

Etapas: pessoa → serviço/categoria → pacote e versão/preço → condição de pagamento → contrato e documentos → revisão → ativação. Salvar rascunho entre etapas. Mostrar soma dos itens e valor final antes da confirmação. Ativação idempotente cria processo/tarefas e registra autoria.

## Workflow e agenda

Jornada vertical com etapas `READY/BLOCKED/WAITING/COMPLETED`, pré-condições e origem do dado; clique abre ação e histórico. Agenda dia/semana mostra instrutor, veículo, unidade, disponibilidade e motivos de indisponibilidade. Busca exibe sugestões provisórias; confirmação reapresenta possível conflito 409 com horários alternativos, sem dupla reserva.

## Financeiro e automações

Financeiro do aluno: total contratado, parcelas, recebido, saldo, créditos por tipo, histórico e ação receber com comprovante. Estorno exige motivo e permissão. Central de automações: provedor, operação, tentativa, estado, próximo retry, erro normalizado e handoff humano; nunca revelar credenciais.

**Fluxos prioritários para prototipar:** (1) buscar aluno → Aluno 360 → resolver pendência, (2) criar matrícula → ativar processo, (3) localizar janela → reservar aula → confirmar crédito, (4) receber parcela → emitir comprovante, (5) falha regulatória → tarefa humana → retomar. Estado vazio, carregamento, erro, offline e falta de permissão devem ser desenhados em cada tela.
