# Plano — Multi-número por conta (WABA EvoHub + Baileys Evolution)

> Permitir N números WhatsApp por conta. WABA sempre via EvoHub; número
> extra via Evolution direto. Cobrança por número. Base: mapa de 62 pontos
> de impacto. **Ordem segura: código primeiro, migration depois, deploy por último.**

## Migration (escrita: `025_whatsapp_config_multi.sql`) — NÃO aplicada ainda
Dropa `UNIQUE(account_id)`, mantém `UNIQUE(phone_number_id)`, adiciona
`provider/label/api_base/evolution_instance/is_default` + `conversations.whatsapp_config_id`.
Só aplicar **depois** da Fase 1 (senão um 2º número quebra os `.single()` em produção).

## Fase 1 — Fundação no código (não quebra com 1 número)
- [ ] `src/lib/whatsapp/config-resolver.ts` — helper central `resolveConfig({accountId, configId?, phoneNumberId?, conversationId?})` que devolve a config certa (e o default da conta como fallback). Substitui os `.single()` espalhados.
- [ ] `src/lib/whatsapp/meta-api.ts` — receber `apiBase` + `provider` por chamada (hoje `META_API_BASE` é global). Mídia idem.
- [ ] Trocar os **11 `.single()` de saída** pelo helper, preservando o fluxo de 1 número:
      send/route, broadcast/route, react/route, templates/[id]+sync+submit, media/[mediaId],
      lib/automations/meta-send, lib/flows/meta-send (3×), config/route (GET vira lista, POST por phone_number_id).
- [ ] `webhook/route.ts` — gravar `conversation.whatsapp_config_id` no insert (qual número recebeu).
- [ ] `inbox/page.tsx` — banner usa lista de configs (≥1 conectado).
- [ ] Validar: typecheck + build.

## Fase 2 — Migration
- [ ] Aplicar `025` em produção (Management API), depois da Fase 1 testada.

## Fase 3 — Evolution (número não-oficial / Baileys)
- [ ] `src/lib/whatsapp/evolution-api.ts` — envio pela API do Evolution (`POST {api_base}/message/sendText/{instance}` etc.).
- [ ] `src/app/api/whatsapp/evolution-webhook/route.ts` — recebe `messages.upsert` do Evolution, resolve config por `evolution_instance`, normaliza e faz o mesmo insert do webhook atual.
- [ ] Envio ramifica por `provider`: evohub/cloud → meta-api; evolution → evolution-api.

## Fase 4 — UI
- [ ] Settings → WhatsApp: lista de números (adicionar/remover, escolher default, label, provider).
- [ ] Inbox: badge/filtro por número; envio usa o número da conversa.
- [ ] Broadcast: escolher de qual número disparar.

## Fase 5 — Deploy + cobrança
- [ ] Deploy `start-first` (imagem nova + migration aplicada).
- [ ] Cobrança: contar configs por conta (1 unidade por número).

## Riscos
- Os `.single()` são silenciosos: ao existir 2º número, envio/automações/broadcast quebram com PGRST116 **sem erro visível** (só log). Por isso Fase 1 (código) **antes** da migration.
- Banco é compartilhado (Johari ativo) — migration aditiva, mas só aplicar com código pronto.
