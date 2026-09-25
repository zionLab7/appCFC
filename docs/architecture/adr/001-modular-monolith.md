# ADR-001 — Monólito modular

Status: aceito para fundação. Contexto: operação de três unidades e domínios fortemente transacionais. Decisão: processo backend único, módulos separados por interfaces; worker externo para integração instável. Consequências: transações simples e menor carga operacional; precisa disciplina para impedir acesso cruzado direto. Extrair módulo só quando volume/isolamento justificar.
