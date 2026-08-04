-- Executado uma única vez, na criação do volume do Postgres.
--
-- Existem dois roles por decisão de segurança (§4.1 do PRD, Seção 2 do plano de execução):
--
--   pulse_owner  dono das tabelas, roda migrations. NÃO é usado em runtime.
--   pulse_app    role de runtime. Sem BYPASSRLS, sem CREATEDB, não é dono de nada.
--
-- Isso é o que torna o critério de aceite "a política de RLS impede a leitura mesmo com
-- filtro de aplicação removido" (Apêndice B) verificável. O dono de uma tabela ignora RLS
-- por padrão no Postgres, então rodar a aplicação como pulse_owner tornaria a segunda
-- camada de isolamento decorativa.
--
-- No Railway este arquivo não roda: o Postgres gerenciado já vem provisionado. Os mesmos
-- comandos estão em docs/deploy-railway.md para execução manual uma única vez.

CREATE ROLE pulse_app WITH LOGIN PASSWORD 'pulse_app_password' NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;

-- pulse_app pode usar o schema, mas os privilégios por tabela são concedidos pela
-- migration de RLS, depois que as tabelas existem.
GRANT CONNECT ON DATABASE pulse TO pulse_app;
GRANT USAGE ON SCHEMA public TO pulse_app;

-- Impede que pulse_app crie objetos no schema public (defesa contra escalonamento).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
