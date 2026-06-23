-- ============================================================
-- 025_whatsapp_config_multi.sql
--
-- Multi-numero por conta: permite N numeros WhatsApp por conta.
-- (migration 017 deixou comentado que isso seria feito dropando o
--  UNIQUE e adicionando um booleano de "primario".)
--
-- ⚠️ ORDEM DE APLICACAO: SO rodar esta migration DEPOIS que o codigo
--    da aplicacao ja resolve a config por NUMERO (config_id /
--    conversation.whatsapp_config_id), nunca por `.eq(account_id).single()`.
--    Enquanto houver 1 numero por conta o codigo antigo ainda funciona;
--    o risco aparece quando um 2o numero e adicionado e algum `.single()`
--    de envio estoura PGRST116. Ver plano de implementacao.
--
-- Idempotente.
-- ============================================================

-- 0. Gate comercial: quantos numeros a conta pode conectar. Default 1
--    (so o numero incluso). O 2o numero e OPCIONAL — quando o cliente
--    contrata, sobe-se o limite (ex.: 2). A UI/rota de adicionar numero
--    valida count(configs) < limite. Base da cobranca por numero.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS whatsapp_numbers_limit INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN accounts.whatsapp_numbers_limit IS
  'Maximo de numeros WhatsApp que a conta pode conectar (gate comercial; default 1).';

-- 1. Remove a trava de 1 numero por conta (UNIQUE account_id, migration 017).
--    MANTEM UNIQUE(phone_number_id) (migration 013) — e o que faz o webhook
--    de entrada rotear por numero. NAO dropar aquela.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

-- 2. Colunas por numero.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'evohub'
    CHECK (provider IN ('evohub', 'cloud', 'evolution')),
  -- nome amigavel exibido na UI (ex.: "Comercial", "Suporte")
  ADD COLUMN IF NOT EXISTS label TEXT,
  -- override da base da API POR numero. NULL = usa a base global do deploy
  -- (WHATSAPP_API_BASE). Usado pra apontar o numero Evolution pra sua instancia.
  ADD COLUMN IF NOT EXISTS api_base TEXT,
  -- nome da instancia no Evolution API (so quando provider='evolution').
  ADD COLUMN IF NOT EXISTS evolution_instance TEXT,
  -- numero padrao da conta (usado quando nao ha numero explicito no contexto).
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- 3. evolution_instance unico (roteamento do webhook Evolution), quando preenchido.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_evolution_instance
  ON whatsapp_config (evolution_instance) WHERE evolution_instance IS NOT NULL;

-- 4. No maximo 1 numero default por conta.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_one_default
  ON whatsapp_config (account_id) WHERE is_default;

-- 5. Migracao de dados: o numero existente de cada conta vira o default.
--    (hoje e 1 por conta, entao todos viram default; com N, o owner escolhe.)
UPDATE whatsapp_config SET is_default = true WHERE is_default = false;

-- 6. conversations: de qual numero e a conversa (qual config recebeu/envia).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
    REFERENCES whatsapp_config(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations (whatsapp_config_id);

-- 7. Popula conversas existentes com o (unico) numero atual da conta.
UPDATE conversations c
  SET whatsapp_config_id = wc.id
  FROM whatsapp_config wc
  WHERE wc.account_id = c.account_id
    AND c.whatsapp_config_id IS NULL;
