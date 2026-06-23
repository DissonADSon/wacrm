// ============================================================
// GET  /api/whatsapp/numbers  — lista os números WhatsApp da conta + o limite.
// POST /api/whatsapp/numbers  — adiciona um número ADICIONAL via Evolution
//                               (Baileys/não-oficial). Admin+. Respeita o
//                               gate `accounts.whatsapp_numbers_limit`
//                               (2º número só se o cliente contratar).
//
// O número WABA principal continua sendo gerido por /api/whatsapp/config.
// ============================================================
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/whatsapp/encryption'
import { canManageMembers, isAccountRole } from '@/lib/auth/roles'

function supabaseAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function getCtx() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.account_id) return null
  return {
    supabase,
    userId: user.id,
    accountId: profile.account_id as string,
    role: profile.account_role as string | null,
  }
}

export async function GET() {
  const ctx = await getCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: numbers } = await ctx.supabase
    .from('whatsapp_config')
    .select('id, label, provider, phone_number_id, evolution_instance, status, is_default, created_at')
    .eq('account_id', ctx.accountId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  const { data: account } = await ctx.supabase
    .from('accounts')
    .select('whatsapp_numbers_limit')
    .eq('id', ctx.accountId)
    .maybeSingle()

  const limit = account?.whatsapp_numbers_limit ?? 1
  const used = numbers?.length ?? 0
  return NextResponse.json({ numbers: numbers ?? [], limit, used, canAdd: used < limit })
}

export async function POST(request: Request) {
  const ctx = await getCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isAccountRole(ctx.role) || !canManageMembers(ctx.role)) {
    return NextResponse.json(
      { error: 'Apenas administradores podem adicionar números.' },
      { status: 403 },
    )
  }

  const body = await request.json().catch(() => null)
  const label: string | undefined = body?.label?.trim() || undefined
  const apiBase: string | undefined = body?.api_base?.trim()
  const instance: string | undefined = body?.evolution_instance?.trim()
  const apikey: string | undefined = body?.apikey?.trim()

  if (!apiBase || !instance || !apikey) {
    return NextResponse.json(
      { error: 'Informe a base (api_base), a instância e a apikey do Evolution.' },
      { status: 400 },
    )
  }

  // Gate comercial: 2º número só se o limite da conta permitir.
  const { count } = await ctx.supabase
    .from('whatsapp_config')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', ctx.accountId)
  const { data: account } = await ctx.supabase
    .from('accounts')
    .select('whatsapp_numbers_limit')
    .eq('id', ctx.accountId)
    .maybeSingle()
  const limit = account?.whatsapp_numbers_limit ?? 1
  if ((count ?? 0) >= limit) {
    return NextResponse.json(
      {
        error: `Limite de ${limit} número(s) atingido. Contrate um número adicional para conectar mais.`,
        reason: 'limit_reached',
      },
      { status: 403 },
    )
  }

  // evolution_instance é único globalmente (migration 025).
  const { data: claimed } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('id')
    .eq('evolution_instance', instance)
    .maybeSingle()
  if (claimed) {
    return NextResponse.json(
      { error: 'Esta instância Evolution já está conectada a uma conta.' },
      { status: 409 },
    )
  }

  const { data: created, error } = await ctx.supabase
    .from('whatsapp_config')
    .insert({
      account_id: ctx.accountId,
      user_id: ctx.userId,
      provider: 'evolution',
      // phone_number_id é NOT NULL + UNIQUE global; para Evolution usamos
      // um id sintético baseado na instância (não há phone_number_id da Meta).
      phone_number_id: `evo:${instance}`,
      evolution_instance: instance,
      api_base: apiBase,
      access_token: encrypt(apikey),
      label: label ?? null,
      status: 'connected',
      is_default: false,
    })
    .select('id, label, provider, evolution_instance, status, is_default')
    .single()

  if (error) {
    console.error('[numbers POST] erro ao inserir:', error)
    return NextResponse.json({ error: 'Falha ao salvar o número.' }, { status: 500 })
  }

  return NextResponse.json({ number: created }, { status: 201 })
}
