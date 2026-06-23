-- ============================================================
-- 024_account_brand_name.sql
--
-- White-label: nome da marca por conta. Cada conta (cliente) pode
-- exibir sua propria marca na UI do CRM (ex.: "ADSon Solucoes",
-- "CRM Cliente X") em vez de uma marca unica fixada no build.
--
-- NULL = usa o default da instancia (NEXT_PUBLIC_APP_NAME / "ADSon CRM"),
-- resolvido em src/lib/brand.ts. Aditiva e compatível: contas
-- existentes ficam com brand_name NULL e continuam mostrando o default.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS brand_name TEXT;

COMMENT ON COLUMN accounts.brand_name IS
  'Marca exibida na UI desta conta (white-label). NULL = default da instancia.';
