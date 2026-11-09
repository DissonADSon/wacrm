-- ============================================================
-- 034_correios_config.sql
--
-- Chave de acesso da API Rastro dos Correios, por conta. O admin
-- cola a chave nova na tela Configurações > Rastreio Correios e o
-- agendador passa a usar sem redeploy. A chave fica cifrada
-- (AES-256-GCM, ENCRYPTION_KEY) e só o servidor (service role)
-- lê e grava esta tabela — o front fala com as rotas
-- /api/correios/token-status e /api/correios/token-update.
--
-- Idempotente. Tabela nova: não afeta a versão anterior do app,
-- que continua lendo CORREIOS_CHAVE_ACESSO do ambiente.
-- ============================================================

CREATE TABLE IF NOT EXISTS correios_config (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  chave_cifrada TEXT NOT NULL,
  chave_final TEXT,
  nome_identificacao TEXT,
  expira_em DATE NOT NULL,
  testada_em TIMESTAMPTZ,
  atualizado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS ligado e sem policy: nenhum cliente (anon/authenticated) lê
-- ou grava direto. Só a service role, que ignora RLS.
ALTER TABLE correios_config ENABLE ROW LEVEL SECURITY;
