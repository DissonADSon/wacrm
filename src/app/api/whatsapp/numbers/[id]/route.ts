// DELETE /api/whatsapp/numbers/[id] — remove um número adicional da conta. Admin+.
// Não remove o número default (proteção): troque o default antes, se preciso.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageMembers, isAccountRole } from '@/lib/auth/roles'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.account_id) {
    return NextResponse.json({ error: 'Sem conta vinculada.' }, { status: 403 })
  }
  const role = profile.account_role as string | null
  if (!isAccountRole(role) || !canManageMembers(role)) {
    return NextResponse.json(
      { error: 'Apenas administradores podem remover números.' },
      { status: 403 },
    )
  }

  // Confere que o número é da conta e não é o default.
  const { data: target } = await supabase
    .from('whatsapp_config')
    .select('id, is_default')
    .eq('id', id)
    .eq('account_id', profile.account_id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Número não encontrado.' }, { status: 404 })
  if (target.is_default) {
    return NextResponse.json(
      { error: 'Não é possível remover o número padrão. Defina outro como padrão primeiro.' },
      { status: 409 },
    )
  }

  const { error } = await supabase
    .from('whatsapp_config')
    .delete()
    .eq('id', id)
    .eq('account_id', profile.account_id)
  if (error) {
    console.error('[numbers DELETE] erro:', error)
    return NextResponse.json({ error: 'Falha ao remover o número.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
