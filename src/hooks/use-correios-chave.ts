"use client";

import { useCallback, useEffect, useState } from "react";

/** Resposta de GET /api/correios/token-status (nunca traz a chave). */
export interface StatusChaveCorreios {
  configurada: boolean;
  origem: "painel" | "ambiente" | "nenhuma";
  expira_em: string | null;
  dias_para_expirar: number | null;
  precisa_renovacao: boolean;
  expirada: boolean;
  chave_final: string | null;
  nome_identificacao: string | null;
  atualizado_em: string | null;
  testada_em: string | null;
  ilegivel: boolean;
  dias_aviso: number;
  pode_editar: boolean;
}

/** Disparado pela tela da chave depois de salvar, para o aviso sumir na hora. */
export const EVENTO_CHAVE_ATUALIZADA = "correios-chave-atualizada";

const INTERVALO_MS = 5 * 60_000;

/**
 * Status da chave de rastreio. Busca ao montar, a cada 5 min, quando a
 * aba volta ao foco e quando a chave é salva. Falha de rede mantém o
 * último status (o aviso não pisca).
 */
export function useCorreiosChave(ativo = true) {
  const [status, setStatus] = useState<StatusChaveCorreios | null>(null);
  const [carregando, setCarregando] = useState(true);

  const atualizar = useCallback(async () => {
    try {
      const res = await fetch("/api/correios/token-status", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as StatusChaveCorreios);
    } catch {
      // mantém o último status
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!ativo) return;
    void atualizar();
    const timer = setInterval(atualizar, INTERVALO_MS);
    const aoFocar = () => {
      if (document.visibilityState === "visible") void atualizar();
    };
    const aoSalvar = (e: Event) => {
      const novo = (e as CustomEvent<StatusChaveCorreios | undefined>).detail;
      if (novo) setStatus(novo);
      else void atualizar();
    };
    document.addEventListener("visibilitychange", aoFocar);
    window.addEventListener(EVENTO_CHAVE_ATUALIZADA, aoSalvar);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", aoFocar);
      window.removeEventListener(EVENTO_CHAVE_ATUALIZADA, aoSalvar);
    };
  }, [ativo, atualizar]);

  return { status, carregando, atualizar };
}

/** "08/05/2027" a partir de "2027-05-08" (sem fuso: é uma data, não um instante). */
export function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Frase curta do prazo: "faltam 12 dias", "vence amanhã", "venceu há 2 dias". */
export function frasePrazo(dias: number | null): string {
  if (dias == null) return "sem data de validade";
  if (dias > 1) return `faltam ${dias} dias`;
  if (dias === 1) return "vence amanhã";
  if (dias === 0) return "vence hoje";
  if (dias === -1) return "venceu ontem";
  return `venceu há ${-dias} dias`;
}
