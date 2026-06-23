-- ============================================================
-- 028_deal_custom_fields.sql
--
-- Campos personalizados nos CARDS do pipeline (oportunidades/deals).
-- Ex.: "Código de rastreamento", "Transportadora", "Nº do pedido".
-- Análogo aos campos personalizados de contato, mas por VENDA — assim
-- o código de rastreamento fica registrado no card e pode virar
-- variável na hora de enviar.
--
-- Idempotente.
-- ============================================================

-- Definições (por conta).
CREATE TABLE IF NOT EXISTS deal_custom_fields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deal_custom_fields_account ON deal_custom_fields(account_id);

ALTER TABLE deal_custom_fields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_custom_fields_select ON deal_custom_fields;
DROP POLICY IF EXISTS deal_custom_fields_insert ON deal_custom_fields;
DROP POLICY IF EXISTS deal_custom_fields_update ON deal_custom_fields;
DROP POLICY IF EXISTS deal_custom_fields_delete ON deal_custom_fields;
CREATE POLICY deal_custom_fields_select ON deal_custom_fields FOR SELECT USING (is_account_member(account_id));
CREATE POLICY deal_custom_fields_insert ON deal_custom_fields FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY deal_custom_fields_update ON deal_custom_fields FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY deal_custom_fields_delete ON deal_custom_fields FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Valores (por deal).
CREATE TABLE IF NOT EXISTS deal_custom_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  deal_custom_field_id UUID NOT NULL REFERENCES deal_custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deal_id, deal_custom_field_id)
);
CREATE INDEX IF NOT EXISTS idx_deal_custom_values_deal ON deal_custom_values(deal_id);

ALTER TABLE deal_custom_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_custom_values_all ON deal_custom_values;
CREATE POLICY deal_custom_values_all ON deal_custom_values FOR ALL
  USING (EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_custom_values.deal_id AND is_account_member(d.account_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_custom_values.deal_id AND is_account_member(d.account_id, 'agent')));
