export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Qualquer erro aqui derruba o boot do Next 16: tudo dentro de try/catch.
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.log("[rastreio] desligado: falta SUPABASE_SERVICE_ROLE_KEY");
      return;
    }

    // Produção roda 1 réplica sem cron externo; o agendador mora no processo.
    const g = globalThis as { __rastreioAgendado?: boolean };
    if (g.__rastreioAgendado) return;
    g.__rastreioAgendado = true;

    let rodando = false;
    const rodar = async () => {
      if (rodando) return;
      rodando = true;
      try {
        // A chave é lida a cada rodada: a que o admin salvar no painel
        // (correios_config) passa a valer sem redeploy.
        const { supabaseAdmin } = await import("@/lib/automations/admin-client");
        const { sincronizarRastreios } = await import("@/lib/correios/sync");
        const { carregarChaves, diasAte } = await import("@/lib/correios/chave");
        const admin = supabaseAdmin();
        const { porConta, ilegiveis, ambiente } = await carregarChaves(admin);

        if (ilegiveis.length) {
          console.error("[rastreio] chave do painel não decifra (ENCRYPTION_KEY mudou?); contas:", ilegiveis.join(","));
        }

        const tarefas: { rotulo: string; chave: string; expiraEm: string; filtro: { incluir?: string[]; excluir?: string[] } }[] = [];
        for (const [conta, c] of porConta) {
          tarefas.push({ rotulo: `conta ${conta}`, chave: c.chave, expiraEm: c.expiraEm, filtro: { incluir: [conta] } });
        }
        if (ambiente) {
          // A chave do ambiente cobre só quem não tem chave própria no painel.
          tarefas.push({
            rotulo: "ambiente",
            chave: ambiente.chave,
            expiraEm: ambiente.expiraEm,
            filtro: { excluir: [...porConta.keys(), ...ilegiveis] },
          });
        }
        if (!tarefas.length) {
          console.log("[rastreio] nenhuma chave configurada (painel ou CORREIOS_CHAVE_ACESSO)");
          return;
        }

        for (const t of tarefas) {
          if (diasAte(t.expiraEm) < 0) {
            console.warn(`[rastreio] ${t.rotulo}: chave venceu em ${t.expiraEm}; pulando até renovarem em Configurações > Rastreio Correios`);
            continue;
          }
          try {
            const r = await sincronizarRastreios(admin, t.chave, t.filtro);
            console.log(`[rastreio] ${t.rotulo} sincronizado`, JSON.stringify(r));
          } catch (e) {
            console.error(`[rastreio] ${t.rotulo} falha`, e instanceof Error ? e.message : e);
          }
        }
      } catch (e) {
        console.error("[rastreio] falha", e instanceof Error ? e.message : e);
      } finally {
        rodando = false;
      }
    };

    setTimeout(rodar, 60_000);
    setInterval(rodar, 30 * 60_000);
  } catch (e) {
    console.error("[rastreio] não agendado", e instanceof Error ? e.message : e);
  }
}
