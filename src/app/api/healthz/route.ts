import { NextResponse } from 'next/server'

// Healthcheck do CONTÊINER — responde "processo vivo" SEM tocar o Supabase.
// O healthcheck do Swarm deve apontar para cá (não para /login, que depende
// do banco): quando o Supabase fica lento/saturado, /login também trava e o
// orquestrador não consegue distinguir "app morto" de "banco lento", deixando
// de reiniciar um container realmente travado. Este endpoint isola isso.
//
// Excluído do middleware (ver matcher em src/middleware.ts) para não passar
// pelo auth.getUser(), que tocaria o Supabase e anularia a independência.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() })
}
