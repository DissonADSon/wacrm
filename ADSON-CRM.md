# ADSon CRM — Registro do Produto

> Documento mestre do **ADSon CRM**: o que é, o que já fizemos, onde está
> instalado, como usamos e o que falta. É a base para abrir novas requisições.
> Mantido em PT-BR. Última atualização: **2026-06-23** · Versão: **1.0.0**.

Fork de produto sobre o template open-source [`ArnasDon/wacrm`](https://github.com/ArnasDon/wacrm)
(MIT). A partir da v1.0.0 é a **ferramenta padrão de CRM/WhatsApp da agência**
para clientes. Código: `/home/disson/projetos/_FERRAMENTAS/crms/wacrm`.

---

## 1. O que é

CRM multi-tenant para atendimento e vendas via WhatsApp: caixa de entrada
compartilhada, contatos, pipelines (Kanban), transmissões, automações no-code,
fluxos visuais e dashboard. Uma única imagem/banco serve vários clientes,
isolados por conta (RLS + `account_id`); a marca muda por cliente (white-label).

### Stack
- **Next.js 16.2.6** (App Router) + **React 19** + **TypeScript** + **Tailwind v4**
- **Supabase** (Postgres + Auth + Storage + RLS) — projeto compartilhado `adson` (ref `syhttznguueunxxmbbtu`, mesmo do content-studio)
- **WhatsApp**: Meta Cloud API v21.0 — em produção via **EvoHub** (proxy não-oficial) e, no roadmap, **Evolution/Baileys** para número extra
- **Deploy**: imagem Docker standalone em **GHCR** (`ghcr.io/dissonadson/wacrm`), rodada em **Portainer ASTMG** (Docker Swarm)
- **Node** ≥ 20

---

## 2. Instalações ativas

> Ambas rodam a **MESMA stack/serviço** (`wacrm_wacrm`, stack id **43**) no
> Portainer ASTMG. Um deploy afeta as duas. Diferenciação por domínio (Traefik)
> + conta (login Supabase). **Johari só deve receber deploy à noite.**

| Instalação | URL | Conta / `account_id` | WhatsApp | Marca exibida |
|---|---|---|---|---|
| **Demo ADSon** | `crm.adsonsolucoes.com.br` | "Disson" · `308a18c9…` | Evolution `disson_5662` (⚠️ quebrado — ver nota) | ADSon Soluções (`brand_name`) |
| **Johari** (1º cliente) | `crm.johari.com.br` | Johari · `7aa2b826-d7c9-4760-8b06-54817778d775` | EvoHub, canal `[JOHARI] WPP (WABA)-6091`, nº **+55 31 9625-6091** | ADSon CRM |

**Johari — detalhes técnicos** (validado ponta a ponta em 21/06, envio+recebimento OK):
- `phone_number_id=1069013629638970`, `waba_id=961600156502099`, `business_id=550394956039760`
- WABA "Johari - Desde 1988"; `whatsapp_config id=cd8f85d1`, status `connected`, token cifrado AES-256-GCM
- Canal EvoHub `id=30403c3a-8e8d-45e1-bf62-2f1be82cd6b0`; webhook EvoHub→wacrm `id=dd88c0d9`

> ⚠️ **Demo ADSon Soluções não envia/recebe (diagnóstico 23/06).** A config
> aponta para a instância Evolution `disson_5662`, mas: (1) a instância está
> em `state: "connecting"` no Evolution (não logada no WhatsApp — banco diz
> "connected", desatualizado); (2) o webhook dela aponta para
> `workflows.trafyx.com.br/webhook/emaranha-forward` (n8n do projeto
> **Emaranhado**), não para `crm.adsonsolucoes.com.br/api/whatsapp/evolution-webhook`;
> (3) a instância é **compartilhada** com o Emaranhado — o webhook do Evolution
> é único por instância, então redirecioná-lo quebraria o Emaranhado.
> **Solução:** criar instância Evolution DEDICADA ao CRM (ex.: `adson_crm`),
> conectar via QR, e configurar o webhook dela para o evolution-webhook do CRM
> (evento `MESSAGES_UPSERT`). Depois apontar a config do CRM para ela.

### Infra / Deploy
- **Portainer ASTMG**: `https://painel.astmg.com.br` (endpoint "ASTMG - Conteudo") → stack `wacrm` (43) → serviço `wacrm_wacrm`
- **Imagem**: `ghcr.io/dissonadson/wacrm:latest` + tag datada (ex: `:20260622`, atual `@sha256:3cd7f2db…418eb74d`)
- **Build-args**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_WHATSAPP_PROVIDER`, `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_VERSION`
- **Runtime env** (além dos build): `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY` (64 hex), `META_APP_SECRET`, `EVOLUTION_HUB_WEBHOOK_SECRET`, `WHATSAPP_API_BASE` (`api.evohub.ai/meta`), `AUTOMATION_CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`
- **Estratégia de rollout**: start-first + healthcheck (`wget /login`, `start_period 30s`) + rollback automático. Rollout ~32s, downtime ~0.
- **Rollback**: ref de imagem em `~/backups/wacrm/rollback-image-ref.txt`; `docker service update --image <tag_anterior> --force wacrm_wacrm`
- Passo a passo detalhado em `_CLIENTES/Johari/deploy-rebuild.md`

### Credenciais (cofre KeePassXC — nunca hardcode)
- `Infra/Portainer ASTMG Access Token`
- `Infra/GitHub PAT ghcr (write packages)` (user `DissonADSon`)
- `Projetos Internos/wacrm/*` — `META_APP_SECRET`, EvoHub webhook secret (HMAC), `ENCRYPTION_KEY`, conta teste
- `Clientes/Johari/CRM wacrm - admin (owner)` (`admin@johari.com.br`) · `Clientes/Johari/EvoHub canal WhatsApp (token)`
- `APIs e Servicos/EvoHub` (`evh_pk_…`) · `APIs e Servicos/Evolution API Trafyx` (`whatsevo.trafyx.com.br`)

---

## 3. Melhorias entregues (v1.0.0)

Pacote acumulado nos 3 commits da branch `feat/adson-crm-22jun` (sobre `main`),
47 arquivos, migrations 024–029. Detalhe por feature → onde está no código:

| Feature | Estado | Onde no código | Migration |
|---|---|---|---|
| **Rebrand ADSon CRM** | ✅ | `src/lib/brand.ts` (`APP_NAME`) | — |
| **White-label por conta** | ✅ | `accounts.brand_name`, `use-auth.tsx`, `sidebar.tsx` | 024 |
| **Versão na UI** | ✅ | `brand.ts` (`APP_VERSION`) + `sidebar.tsx` | — |
| **Tradução PT-BR completa** | ✅ | toda a UI; glossário `TRADUCAO-PTBR.md` | — |
| **Modo EvoHub (UI enxuta)** | ✅ | `settings/whatsapp-config.tsx`, `lib/whatsapp/meta-api.ts` | — |
| **Multi-número — fundação + proxy** | ✅ Fase 1/2 | `config-resolver.ts`, `sender.ts`, `evolution-api.ts`, `api/whatsapp/numbers/route.ts`, `settings/additional-numbers.tsx`, `media/[mediaId]/route.ts` | **025 (APLICADA)** |
| **Mídia: lightbox + Ctrl+V + 95 MB** | ✅ | `api/whatsapp/media/`, composer | 023, 026 |
| **Campo Cidade** | ✅ | `contacts/`, import CSV, templates | 027 |
| **Campos custom em oportunidades** | ✅ | `pipelines/deal-form.tsx`, `contacts/custom-fields-manager.tsx` | 028 |
| **Variáveis de template** | ✅ | `lib/whatsapp/template-variables.ts` | 029 |
| **Automação "Criar oportunidade"** | ✅ | `automations/` (PipelineSelect/StageSelect) | — |
| **Dockerfile produção (Swarm)** | ✅ | `Dockerfile` (build-args white-label) | — |

**Migrations aplicadas em prod:** 024, 025, 026, 027, 028, 029 (confirmado via
PostgREST em 23/06 — as colunas `provider/api_base/is_default/evolution_instance`
existem e já há 2 números cadastrados: Johari `evohub` e demo Disson `evolution`).
**Pendente de aplicar:** nenhuma.

---

## 4. Backlog — novas requisições

Itens abertos, base para as próximas frentes. Marcar prioridade ao acionar.

### ✅ Feito em 23/06 (bug em produção — Johari)
- [x] **Automações davam 404 ao abrir/editar/ativar (bug de tenancy).** A rota
  `api/automations/[id]/route.ts` (e `/duplicate`) escopava por `user_id` em vez
  de `account_id` — resquício do modelo pré-017. Resultado: automação criada por
  um membro **aparecia na lista** (account-scoped) mas dava **404** ao abrir para
  outro membro da mesma conta. Caso real: automação "Mensagem [tag Paty]" criada
  pela Michelle (`comercial.johari`) e inacessível à Patrícia (`admin@johari`,
  proprietária). Corrigido GET/PATCH/DELETE + duplicate para escopo por conta.
  typecheck + build OK. **Falta deploy.**
- [x] **RBAC de automações: só admin/owner editam, agent/viewer só veem.** Nova
  capability `canEditAutomations` (admin+) em `lib/auth/roles.ts`, exposta no
  `useCan('edit-automations')` e no `use-auth`. Backend força em POST/PATCH/
  DELETE/duplicate (403 com mensagem PT-BR). UI esconde criar/ativar/editar/
  duplicar/excluir para não-admin (lista + logs + resumo read-only continuam).
  ⏳ Melhoria futura: builder em modo read-only para viewers verem os passos.
- [x] **ADSon Soluções liberado para multi-número** (`whatsapp_numbers_limit`
  1 → 99 na conta `308a18c9`).
- [x] **CAUSA RAIZ do recebimento via Evolution não funcionar: middleware
  bloqueava o webhook com 401.** `src/middleware.ts` liberava rotas com
  `'/webhook'` (barra), mas o path é `/api/whatsapp/evolution-webhook`
  (`-webhook`, sem barra) → caía no 401. O webhook oficial do Johari
  (`/api/whatsapp/webhook`) casava e por isso sempre funcionou. Trocado para
  `includes('webhook')`. ⚠️ **Só vale após deploy** — em produção o
  evolution-webhook ainda devolve 401 até subir. Webhook da instância
  `disson_ia_0798` reapontado do Emaranhado para o CRM (a pedido).
- [x] **Tela de WhatsApp — cadastro WABA direto "só quando não há número".** No
  modo EvoHub, a tela enxuta passou a valer só quando já existe número
  (`EVOHUB_MODE && config`); sem número, mostra o setup Meta/WABA completo para
  quem quer cadastrar sozinho. Depois de conectado, volta ao modo gerenciado.
- [x] **Número adicional não-WABA com preço + solicitação.** Sem cota no plano,
  `additional-numbers.tsx` mostra "Adicionar número extra (sem WABA) — R$ 49,90/
  mês" e o botão "Solicitar número adicional" abre a URL de contratação
  (`NEXT_PUBLIC_CONTRATAR_NUMERO_URL`, default `adsonsolucoes.com.br/contrate`).
  ⏳ Evoluir para webhook de provisionamento (trocar a env, sem tocar no código).

### ✅ Feito em 23/06 (estava no P0)
- [x] **Multi-número Fase 2 — proxy de mídia robusto.** Migration 025 já estava aplicada em prod. Corrigido o último `.single()` quebrável: `media/[mediaId]/route.ts` agora usa `resolveWhatsappConfig` (resolve o número pela conversa que contém o `mediaId`, fallback default) e passa `api_base` por config. `getMediaUrl` aceita `apiBase`. Webhook (Cloud + Evolution) propaga `api_base`. **typecheck + build OK.**
- [x] **Mídia recebida (img/áudio/doc) — investigado: FUNCIONA.** A hipótese de 22/06 ("EvoHub não espelha o endpoint") estava errada. Provado em 23/06: 58 mídias recebidas no banco, 0 com `media_url` nulo; download real de imagem/PDF/áudio via EvoHub retornou HTTP 200. EvoHub espelha `GET /<mediaId>` → `{url,mime_type}`. Logs `[MEDIA-DEBUG]` removidos.

### P0 — pendente
- [ ] **Validar multi-número na MESMA conta.** Hoje cada conta tem 1 número (o `.single()` nunca chegou a quebrar). Antes de vender 2º número numa conta: subir `accounts.whatsapp_numbers_limit`, adicionar 2º número pela UI, testar envio/broadcast/mídia. Código pronto, falta o teste end-to-end real.
- [ ] **Suíte de testes defasada pela tradução PT-BR.** `vitest`: 54 falhas (de 421), todas porque assertions esperam mensagens em inglês e o código responde em PT-BR (ex: `template-validators`, `flows/validate`, `automations/validate`) + `upload-media` esperando 16 MB (mudou p/ 95 MB na 026). **Não é regressão** — é dívida da tradução. Atualizar as assertions.

### P1 — produto padrão para clientes
- [ ] **White-label pré-login** por domínio/env (hoje a marca só troca pós-login).
- [ ] **Cobrança por assento (agentes).** Hoje agentes são ilimitados no shared inbox. Implementar limite de assentos por conta.
- [ ] **Mídia recebida via Evolution direto** (Baileys): o `evolution-webhook` já propaga `api_base`, mas Baileys não entrega mídia no formato `mediaId` da Meta — precisa de tratamento próprio quando um número Evolution receber mídia (Fase 3).
- [ ] **Bloquear "Automações" no menu** por conta via mecanismo `beta_features` (fácil).

### P2 — quando houver dados reais
- [ ] **Auto-preenchimento das variáveis de template** — adiado até Johari ter conversas reais.
- [ ] Avaliar **Supabase project por cliente** acima de ~100 contas (hoje compartilhado).

---

## 5. Procedimento de release (resumo)

1. `npm run typecheck` && `npm run build` (validar local — **regra dura**).
2. Bumpar `package.json` **e** `APP_VERSION` em `src/lib/brand.ts` (manter em sincronia) + nota no `CHANGELOG.md`.
3. `docker build` com build-args → tag `:latest` + `:AAAAMMDD` → `docker push` (GHCR, PAT do cofre).
4. Aplicar migrations novas no Supabase **antes** do redeploy se o código novo depender delas.
5. Redeploy via Portainer (Update stack / re-pull) ou `docker service update --image … --force wacrm_wacrm`. **Johari só à noite.**
6. Verificar URLs (HTTP 200, marca, login, inbox, WhatsApp conectado). Guardar ref de rollback.

> **Não fazer `git push` nem deploy sem o Disson pedir.** Branch atual
> `feat/adson-crm-22jun` ainda **não foi pushada** — ao push, propaga para as
> próximas instalações.

---

## 6. Documentos relacionados

- `CHANGELOG.md` — histórico (seção `[1.0.0]` em PT-BR + histórico upstream em inglês)
- `PLANO-MULTINUMERO.md` — plano faseado do multi-número (62 pontos de impacto)
- `TRADUCAO-PTBR.md` — glossário e regras de tradução
- `_CLIENTES/Johari/{README,crm-wacrm,deploy-rebuild}.md` — docs da instalação Johari
- `_DISSON/LEMRRAR.MD` — diário de ações (seções 21–22/06 sobre wacrm)
