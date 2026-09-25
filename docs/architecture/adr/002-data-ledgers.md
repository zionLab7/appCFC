# ADR-002 — PostgreSQL e ledgers

Status: aceito. Banco autoritativo PostgreSQL; dinheiro em centavos; créditos em unidades inteiras. Saldo calculado de lançamentos e holds. Reversões criam novos lançamentos. Constraints no banco impedem dupla reserva, com domínio validando regras adicionais. Redis e SQLite não decidem saldo nem disponibilidade final.
