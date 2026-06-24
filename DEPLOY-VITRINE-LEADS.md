# TAREFA DE DEPLOY — Captura de leads da vitrine ADSon

> Inserido por outra sessão (integração vitrine `adsonsolucoes.com.br` → CRM). Não é urgente
> nem bloqueia o que você está consertando; é só garantir que **no próximo deploy do `wacrm`**
> as 2 envs abaixo entrem. O código já está commitado (não precisa mexer em código).

## O que já existe no código (commit `f72ce26`)
- Rota nova: `src/app/api/leads/capture/route.ts` — `POST /api/leads/capture`.
- Recebe leads da vitrine via webhook n8n (server-to-server, header `x-vitrine-secret`),
  cria um `contact` na account ADSon (Supabase service-role), dedup por telefone.
  Sem telefone → responde `{ok:false, skipped:'sem telefone'}` (não cria).
- O middleware NÃO bloqueia `/api/leads/*` (só `/api/whatsapp/*` sem `webhook`), então a rota
  já fica pública; o guard é o próprio secret.

## O que o DEPLOY precisa (Portainer ASTMG → stack `wacrm` → Runtime env)
Adicionar **2 runtime envs** (não são build-args):

- `VITRINE_LEAD_SECRET` → **pegar o valor no cofre KeePassXC**: entrada
  `APIs e Servicos/Vitrine Lead Secret` (mesmo secret usado pelo app ADSon e pelo n8n).
  **NÃO hardcodar aqui nem no repo.** Sem essa env a rota responde 503 (captura desligada).
- `VITRINE_CRM_ACCOUNT_ID=308a18c9-2460-4ec1-b641-52dd02f1ac5e` — account_id da conta
  **"Disson"** (ADSon) no Supabase do CRM (não é segredo; é id de tenant). A rota resolve o
  `owner_user_id` em runtime a partir dela.

> ⚠️ O deploy do `wacrm` é **compartilhado com a Johari** (mesma stack/imagem). Respeitar a
> janela combinada ("Johari só à noite"). Estas envs são aditivas — não afetam a Johari.

## Como validar depois do deploy (sem criar lixo em produção)
Quem valida é o Disson, pela tela / com 1 lead real de teste:
1. Submeter o form de contato em `adsonsolucoes.com.br` com um telefone de teste.
2. Conferir que aparece um `contact` novo na account ADSon do CRM.
3. (Se quiser limpar o teste, apagar o contact pela UI.)

## Fluxo completo (contexto)
`vitrine (3 forms)` → `webhook n8n https://fluxos.trafyx.com.br/webhook/adson-vitrine-lead`
→ em paralelo: **app** `app.adson.disson.com.br/api/public/vitrine-lead` (cria `Lead`)
e **este CRM** `crm.adsonsolucoes.com.br/api/leads/capture` (cria `contact`).
Cada ramo tem `onError:continueRegularOutput` no n8n — um falhar não derruba o outro.
