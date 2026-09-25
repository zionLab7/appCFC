-- Permission definitions belong to schema setup, not the optional development seed.
INSERT INTO permission(code,description) VALUES
 ('student.read','Consultar aluno'),('student.write','Cadastrar aluno'),
 ('enrollment.write','Criar e ativar matrícula'),('process.transition','Avançar processo'),
 ('lesson.book','Reservar aula'),('payment.receive','Receber pagamento'),
 ('payment.refund','Estornar pagamento'),('automation.execute','Iniciar automação'),
 ('audit.read','Consultar auditoria')
ON CONFLICT DO NOTHING;
