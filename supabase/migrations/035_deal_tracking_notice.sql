-- ============================================================
-- 035_deal_tracking_notice.sql
--
-- Aviso de rastreio ao cliente: uma linha por (card, código). A rotina
-- do servidor manda o código no WhatsApp do contato do card quando o
-- código aparece no campo "Código de rastreio" e grava aqui o resultado.
-- O front só lê, para mostrar no card se o aviso saiu. A falha que a
-- Meta manda depois pelo webhook é gravada no handleStatusUpdate.
--
-- Idempotente. Tabela nova: não afeta a versão anterior do app.
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_tracking_notice (
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- enviando | enviado | falhou | incerto (WhatsApp chamado sem confirmação) | legado (já existia)
  status TEXT NOT NULL,
  canal TEXT,
  message_id TEXT,
  erro TEXT,
  tentativas INT NOT NULL DEFAULT 0,
  tentado_em TIMESTAMPTZ,
  -- Marcado ANTES de chamar o WhatsApp: se a rodada morrer depois disso,
  -- não dá pra saber se a mensagem saiu, e o aviso não é reenviado.
  chamado_em TIMESTAMPTZ,
  enviado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (deal_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_deal_tracking_notice_account ON deal_tracking_notice(account_id);
CREATE INDEX IF NOT EXISTS idx_deal_tracking_notice_message ON deal_tracking_notice(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_tracking_notice_retentar ON deal_tracking_notice(status) WHERE status IN ('enviando', 'falhou');

ALTER TABLE deal_tracking_notice ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_tracking_notice_select ON deal_tracking_notice;
CREATE POLICY deal_tracking_notice_select ON deal_tracking_notice FOR SELECT
  USING (is_account_member(account_id));

-- Interruptor por conta: o aviso só roda onde alguém ligou (padrão desligado).
CREATE TABLE IF NOT EXISTS deal_tracking_notice_config (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  ativo BOOLEAN NOT NULL DEFAULT FALSE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE deal_tracking_notice_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_tracking_notice_config_select ON deal_tracking_notice_config;
CREATE POLICY deal_tracking_notice_config_select ON deal_tracking_notice_config FOR SELECT
  USING (is_account_member(account_id));

-- Johari pediu o aviso (chamado JOH-20261110-1530-AVR). Em outro ambiente é no-op.
INSERT INTO deal_tracking_notice_config (account_id, ativo)
SELECT id, TRUE FROM accounts WHERE id = '7aa2b826-d7c9-4760-8b06-54817778d775'
ON CONFLICT (account_id) DO NOTHING;

-- Códigos que já estavam nos cards não disparam aviso retroativo.
-- Mesma normalização de normalizarCodigo() (src/lib/correios/rastro.ts):
-- o \s do JS também remove NBSP, BOM e os espaços Unicode, o do Postgres não.
INSERT INTO deal_tracking_notice (deal_id, codigo, account_id, status)
SELECT DISTINCT v.deal_id, n.codigo, d.account_id, 'legado'
FROM deal_custom_values v
JOIN deal_custom_fields f ON f.id = v.deal_custom_field_id AND f.field_name ILIKE '%rastre%'
JOIN deals d ON d.id = v.deal_id
CROSS JOIN LATERAL (
  SELECT upper(regexp_replace(coalesce(v.value, ''),
    '[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+', '', 'g')) AS codigo
) n
WHERE n.codigo ~ '^[A-Z]{2}[0-9]{9}[A-Z]{2}$'
ON CONFLICT DO NOTHING;
