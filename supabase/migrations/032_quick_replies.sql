-- ============================================================
-- 032_quick_replies.sql
--
-- "Mensagens rápidas" (respostas prontas) — atalhos de texto livre,
-- COMPARTILHADOS por toda a equipe da conta, para inserir no chat via
-- "/" (saudações, dados de PIX, link do catálogo, etc.).
--
-- Diferente de `message_templates` (templates oficiais da Meta, com
-- aprovação/categorias): aqui é texto livre interno, sem Meta.
-- Escopo por conta (account_id) — todos os membros veem e usam.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS quick_replies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quick_replies_account ON quick_replies(account_id);

ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quick_replies_select ON quick_replies;
DROP POLICY IF EXISTS quick_replies_insert ON quick_replies;
DROP POLICY IF EXISTS quick_replies_update ON quick_replies;
DROP POLICY IF EXISTS quick_replies_delete ON quick_replies;
-- Qualquer membro da conta vê e usa; membros operacionais (agent+) gerenciam.
CREATE POLICY quick_replies_select ON quick_replies FOR SELECT USING (is_account_member(account_id));
CREATE POLICY quick_replies_insert ON quick_replies FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY quick_replies_update ON quick_replies FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY quick_replies_delete ON quick_replies FOR DELETE USING (is_account_member(account_id, 'agent'));
