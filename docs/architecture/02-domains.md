# Fronteiras, agregados e serviços

| Domínio | Agregado/entidades sob escrita | Interface pública e eventos | Invariantes |
|---|---|---|---|
| Identity & Access | Organization, Unit, User, Role, Membership | authorize(user, unit, permission) | Unidade pertence ao tenant; acesso explícito |
| Student | Person, Contact, Address, Student, Note | create/find/update; student.created | Pessoa única quando documento normalizado; múltiplas matrículas |
| CRM | Lead, Quote | qualify/quote; lead.converted | Orçamento captura preço e versão do pacote |
| Catalog/Enrollment | Product, PackageVersion, Enrollment, Contract | enroll/activate/change; enrollment.activated | Matrícula mantém versão contratada; alterações registradas |
| Workflow | Definition, Version, Step, Process, Task | transition/availableActions; process.step.completed | Versão congelada por processo; pré-condições validadas |
| Scheduling | Resource, Availability, Lesson, Booking, Evaluation | suggest/book/cancel/complete; lesson.booked | Aluno/recurso sem sobreposição; categoria compatível |
| Credit | Wallet, Entry, Reservation | grant/hold/consume/release; credit.consumed | Saldo derivado e não negativo; reversão por lançamento |
| Finance | Receivable, Installment, Payment, Allocation, Journal, Payable | receive/refund/reconcile; payment.received | Alocação limitada; journal balanceado; estorno compensatório |
| Regulatory | AutomationJob, Attempt, ExternalReference | request/normalize/retry; automation.succeeded | Worker não altera processo diretamente |
| Document | Document, Version | request/upload/accept; document.added | Hash, acesso e retenção por finalidade |
| Communication | Thread, Message, Consent | send/receive; message.sent | Canal e opt-out respeitados |
| Audit/Analytics | AuditEvent, Outbox, read models | append/project | Auditoria apendável; projeção reconstruível |

**Value objects:** Money(amountCents,currency), TimeWindow(start,end), Category(A/B/AB/D...), DocumentNumber(kind,value), ContactPoint(channel,value), Permission(scope,action), ExternalResult(provider,operation,status,evidenceRef). Valor monetário nunca usa `float`. Regras por organização/unidade/pacote são versões publicadas, nunca código livre vindo do banco.

**Serviços de aplicação:** `EnrollStudent` (verifica pacote publicado, cria matrícula), `TransitionProcess` (permissão/pré-condição/versão), `BookLesson` (valida recursos e segura crédito), `ReceivePayment` (aloca e lança journal), `RequestAutomation` (enfileira job), `ReconcileBankTransaction` (associa comprovante e pagamento). Comunicação entre domínios via interfaces públicas dentro do monólito e outbox para efeitos assíncronos. Não buscar saldos por campo redundante sem conferir ledger.

**Estados:** Matrícula `DRAFT → PENDING_SIGNATURE → ACTIVE → SUSPENDED/CANCELLED/COMPLETED`; Processo `CREATED → ACTIVE → WAITING/BLOCKED → COMPLETED/CANCELLED`; Aula `RESERVED → CONFIRMED → CHECKED_IN → IN_PROGRESS → COMPLETED`, com saídas explícitas de ausência/cancelamento; pagamento `PENDING → SETTLED → REFUNDED`; job `QUEUED → RUNNING → SUCCEEDED/WAITING_HUMAN/RETRY_SCHEDULED/FAILED_PERMANENT`.
