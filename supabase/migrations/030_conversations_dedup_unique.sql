-- ============================================================
-- 030 — Conversas duplicadas: merge + UNIQUE(account_id, contact_id)
--
-- BUG (Johari, JOH-20260624-1432-RGR #1): "abriu várias caixas de diálogo
-- para o mesmo cliente, cada uma com uma parte da resposta". Causa: corrida
-- TOCTOU em findOrCreateConversation (SELECT + INSERT sem unique nem retry).
-- Uma mensagem fragmentada chega como vários eventos quase simultâneos →
-- cada um cria uma conversa.
--
-- Esta migration (1) funde as duplicatas existentes na conversa MAIS ANTIGA
-- (canônica), repontando TODOS os filhos (messages, message_reactions, deals,
-- flow_runs) antes de apagar as duplicatas — sem perder nada; (2) cria a
-- constraint UNIQUE que impede novas duplicatas. O código já foi ajustado
-- para tratar o 23505 (re-resolve a canônica) e usar a mais antiga.
--
-- ⚠️ ORDEM DE APLICAÇÃO: rodar DEPOIS do deploy do código novo (que trata
-- o unique-violation). Se a UNIQUE existir com o código antigo, uma corrida
-- viraria 23505 não-tratado e a mensagem seria descartada.
-- ============================================================
BEGIN;

-- 0. Serializa contra inserts concorrentes do webhook DURANTE o merge. Sem
--    isso, uma entrega concorrente (mensagem fragmentada = vários eventos
--    quase simultâneos, a própria causa do bug) poderia criar uma duplicata
--    nova entre o DELETE (passo 3) e o ADD CONSTRAINT (passo 5), fazendo o
--    ALTER estourar 23505 e dar ROLLBACK de tudo (merge não aplica). O LOCK
--    SHARE ROW EXCLUSIVE conflita com o ROW EXCLUSIVE dos INSERTs e fecha a
--    janela. Liberado no COMMIT (migration é rápida).
LOCK TABLE conversations IN SHARE ROW EXCLUSIVE MODE;

-- 1. Mapa duplicata → canônica (a mais antiga por account_id+contact_id).
CREATE TEMP TABLE conv_merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY account_id, contact_id
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id
  FROM conversations
)
SELECT id AS dup_id, canonical_id
FROM ranked
WHERE id <> canonical_id;

-- 2. Reponta os filhos das duplicatas para a conversa canônica.
UPDATE messages m
  SET conversation_id = cm.canonical_id
  FROM conv_merge cm WHERE m.conversation_id = cm.dup_id;

UPDATE message_reactions r
  SET conversation_id = cm.canonical_id
  FROM conv_merge cm WHERE r.conversation_id = cm.dup_id;

UPDATE deals d
  SET conversation_id = cm.canonical_id
  FROM conv_merge cm WHERE d.conversation_id = cm.dup_id;

UPDATE flow_runs fr
  SET conversation_id = cm.canonical_id
  FROM conv_merge cm WHERE fr.conversation_id = cm.dup_id;

-- 3. Remove as conversas duplicadas (agora sem filhos).
DELETE FROM conversations c USING conv_merge cm WHERE c.id = cm.dup_id;

-- 4. Recalcula a última mensagem das canônicas afetadas (a inbox pós-merge
--    fica com o resumo/ordem corretos).
UPDATE conversations c
  SET last_message_at = lm.created_at,
      last_message_text = lm.content_text
  FROM (
    SELECT DISTINCT ON (conversation_id)
      conversation_id, created_at, content_text
    FROM messages
    ORDER BY conversation_id, created_at DESC
  ) lm
  WHERE c.id = lm.conversation_id
    AND c.id IN (SELECT DISTINCT canonical_id FROM conv_merge);

-- 5. Constraint única: uma conversa por (conta, contato). O webhook já
--    re-resolve a canônica quando o INSERT bate aqui (23505). Idempotente
--    (guard IF NOT EXISTS) p/ re-execução segura após retry parcial.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_account_contact_unique'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_account_contact_unique UNIQUE (account_id, contact_id);
  END IF;
END $$;

COMMIT;
