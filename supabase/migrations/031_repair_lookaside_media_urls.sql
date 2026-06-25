-- ============================================================
-- 031 — Reparo: media_url lookaside (Meta) → proxy interno
--
-- REGRESSÃO (M5, deploy 24/06 17:27): ao adicionar `message.X.url ||` no
-- parseMessageContent, passamos a gravar a URL `lookaside.fbsbx.com` que o
-- EvoHub injeta no payload Cloud API. Essa URL EXPIRA e exige Bearer (401 no
-- front → bolha de imagem vazia). Resultado: "todos os clientes que enviaram
-- imagens, não abre a imagem" (Johari, relato Michelle 25/06).
--
-- O hotfix (commit a3824bf) já impede NOVAS gravações lookaside. Esta
-- migration repara os registros ANTIGOS: reescreve media_url para o proxy
-- /api/whatsapp/media/<mid>, que rebusca a URL fresca e autenticada sob
-- demanda. O <mid> sai do query param ?mid=NNNN da URL lookaside (é o mesmo
-- media_id que o proxy passa ao getMediaUrl — formato 100% numérico,
-- confirmado nos 8 registros afetados).
--
-- IDEMPOTENTE: o WHERE só casa URLs lookaside; após o reparo elas já são
-- proxy, então rodar de novo é no-op. Não toca em mídia do Evolution
-- (que aponta para /storage/v1/object/public/).
-- ============================================================

UPDATE messages
SET media_url = '/api/whatsapp/media/' || substring(media_url FROM 'mid=([0-9]+)')
WHERE media_url LIKE '%lookaside.fbsbx.com%'
  AND substring(media_url FROM 'mid=([0-9]+)') IS NOT NULL;
