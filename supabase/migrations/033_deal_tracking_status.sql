-- ============================================================
-- 033_deal_tracking_status.sql
--
-- Último status de rastreio dos Correios por card (deal), lido do
-- campo personalizado "Código de rastreio". Preenchido só pelo
-- servidor (service role) pela rotina de sincronização; o front lê.
--
-- Idempotente. Tabela nova: não afeta a versão anterior do app.
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_tracking_status (
  deal_id UUID PRIMARY KEY REFERENCES deals(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  descricao TEXT,
  evento_codigo TEXT,
  evento_tipo TEXT,
  cidade TEXT,
  uf TEXT,
  evento_em TIMESTAMPTZ,
  previsao_em TIMESTAMPTZ,
  entregue BOOLEAN NOT NULL DEFAULT FALSE,
  erro TEXT,
  consultado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deal_tracking_status_account ON deal_tracking_status(account_id);

ALTER TABLE deal_tracking_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_tracking_status_select ON deal_tracking_status;
CREATE POLICY deal_tracking_status_select ON deal_tracking_status FOR SELECT
  USING (is_account_member(account_id));
