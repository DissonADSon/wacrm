-- ============================================================
-- 027_contacts_city.sql
--
-- Cidade do contato (campo nativo, igual `company`). Exibida na lista
-- de contatos e editável no cadastro. Aditiva e compatível.
--
-- Idempotente.
-- ============================================================
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS city TEXT;
