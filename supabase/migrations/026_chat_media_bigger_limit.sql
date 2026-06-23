-- ============================================================
-- 026_chat_media_bigger_limit.sql
--
-- Sobe o teto do bucket de anexos de 16 MB para 100 MB, pra acomodar
-- DOCUMENTOS grandes (comprovantes, PDFs). Os limites por tipo no app
-- (src/lib/storage/upload-media.ts) seguem respeitando os caps DUROS da
-- Meta: imagem 5 MB, vídeo 16 MB, áudio 16 MB; documento até ~95 MB
-- (a Meta permite 100 MB).
--
-- Idempotente.
-- ============================================================

UPDATE storage.buckets
  SET file_size_limit = 104857600 -- 100 MB
  WHERE id = 'chat-media';
