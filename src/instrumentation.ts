export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const chave = process.env.CORREIOS_CHAVE_ACESSO;
  if (!chave || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;

  // Produção roda 1 réplica sem cron externo; o agendador mora no processo.
  const g = globalThis as { __rastreioAgendado?: boolean };
  if (g.__rastreioAgendado) return;
  g.__rastreioAgendado = true;

  const { supabaseAdmin } = await import("@/lib/automations/admin-client");
  const { sincronizarRastreios } = await import("@/lib/correios/sync");

  let rodando = false;
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await sincronizarRastreios(supabaseAdmin(), chave);
      console.log("[rastreio] sincronizado", JSON.stringify(r));
    } catch (e) {
      console.error("[rastreio] falha", e instanceof Error ? e.message : e);
    } finally {
      rodando = false;
    }
  };

  setTimeout(rodar, 60_000);
  setInterval(rodar, 30 * 60_000);
}
