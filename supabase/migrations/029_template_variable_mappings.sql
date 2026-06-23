-- ============================================================
-- 029_template_variable_mappings.sql
--
-- Mapeamento de cada variável ({{1}}, {{2}}…) de um template a uma FONTE
-- (campo do contato, campo do card/oportunidade, campo personalizado ou
-- valor fixo). Serve de "legenda" (o que cada variável significa) e
-- permite AUTO-PREENCHER os valores no envio individual, puxando do
-- contato e do card da conversa.
--
-- Formato (JSONB): { "1": { "source": "contact_field", "value": "name" },
--                    "2": { "source": "deal_custom",  "value": "<id>" } }
--
-- Idempotente.
-- ============================================================
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS variable_mappings JSONB;
