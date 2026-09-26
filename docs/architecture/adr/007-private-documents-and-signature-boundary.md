# ADR-007 — Documentos privados e fronteira de assinatura

Status: aceito para desenvolvimento em 26/09/2026.

Cada documento pertence a um aluno ou matrícula de uma unidade; a API exige permissão por unidade em solicitação, envio, revisão e download. Cada envio cria uma versão imutável com chave de objeto opaca, tamanho, MIME e SHA-256. O servidor guarda os objetos num bucket S3 compatível privado; o navegador nunca recebe credenciais ou chave do bucket. O download passa pela API, revalida permissão, tamanho e hash, envia `Cache-Control: no-store` e grava evento de auditoria de leitura. S3Mock e credenciais de `.env` são só para desenvolvimento. Em produção o bucket deve ser privado, com TLS, criptografia e política de retenção configurada.

Solicitar documento `CONTRACT` cria `contract` em estado `DRAFT` ligado à matrícula. A revisão documental não marca `SIGNED`, não preenche `signed_at` e não libera ativação operacional. O provedor de assinatura ainda não foi escolhido pela GP Autoescola. Um adapter futuro deverá iniciar o envelope com referência externa, verificar webhook ou consulta autenticada do provedor, guardar evidência assinada e idempotência, e somente então transicionar o contrato. O adapter será configurado por ambiente; nenhum código proprietário do InforCFC é usado. A ativação atual continua sintética e bloqueada fora de desenvolvimento/teste.

Limites antes de dados reais: escolher e homologar provedor de assinatura; varredura antimalware e processamento seguro de PDFs/imagens; retenção e exclusão conforme orientação jurídica; gerenciador de segredos; testes de acesso cruzado, volume e incidente de storage. O envio em JSON/base64 tem limite de 5 MB; um upload por streaming ou URL de curta duração pode substituí-lo sem mudar o modelo de versões.
