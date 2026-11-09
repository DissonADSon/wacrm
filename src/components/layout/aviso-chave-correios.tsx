"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { KeyRound, Truck } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { formatarData, frasePrazo, useCorreiosChave } from "@/hooks/use-correios-chave";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const LINK_TELA_CHAVE = "/settings?tab=correios";

/**
 * Aviso de vencimento da chave de rastreio dos Correios.
 *
 * Faltando 3 dias ou menos (ou vencida), quem pode renovar vê:
 *  - um selo fixo no cabeçalho, em toda tela, até a chave ser trocada;
 *  - um pop-up ao abrir o CRM (uma vez por sessão do navegador), com o
 *    link para a tela onde se cola a chave nova.
 * Some sozinho quando a chave nova é salva.
 */
export function AvisoChaveCorreios() {
  const { canEditSettings, profileLoading } = useAuth();
  const ativo = !profileLoading && canEditSettings;
  const { status } = useCorreiosChave(ativo);
  const pathname = usePathname();
  const router = useRouter();
  // Chave da sessão que a pessoa fechou agora (o sessionStorage cobre recargas).
  const [fechado, setFechado] = useState<string | null>(null);

  const mostrar = ativo && !!status?.pode_editar && !!status.precisa_renovacao;
  const chaveSessao = `aviso-correios:${status?.expira_em ?? "sem-data"}:${status?.ilegivel ? "ilegivel" : "ok"}`;

  // Só roda no navegador: `mostrar` depende do status buscado no cliente.
  function jaVisto(): boolean {
    if (fechado === chaveSessao) return true;
    try {
      return sessionStorage.getItem(chaveSessao) === "1";
    } catch {
      return false; // sessionStorage bloqueado: mostra mesmo assim
    }
  }
  // Já está na tela da chave: o pop-up só atrapalharia.
  const naTelaDaChave =
    mostrar && pathname === "/settings" && new URLSearchParams(window.location.search).get("tab") === "correios";
  const aberto = mostrar && !naTelaDaChave && !jaVisto();

  function fechar() {
    setFechado(chaveSessao);
    try {
      sessionStorage.setItem(chaveSessao, "1");
    } catch {
      // ignora
    }
  }

  if (!mostrar || !status) return null;

  const vencida = status.expirada;
  const titulo = status.ilegivel
    ? "A chave dos Correios precisa ser salva de novo"
    : vencida
      ? "A chave dos Correios venceu"
      : `A chave dos Correios ${frasePrazo(status.dias_para_expirar)}`;
  const selo = status.ilegivel
    ? "Chave dos Correios: salvar de novo"
    : vencida
      ? "Chave dos Correios vencida"
      : `Chave dos Correios: ${frasePrazo(status.dias_para_expirar)}`;

  return (
    <>
      <Link
        href={LINK_TELA_CHAVE}
        title="Trocar a chave de rastreio dos Correios"
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
          vencida || status.ilegivel
            ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
            : "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300",
        )}
      >
        <Truck className="size-3.5" />
        <span className="hidden md:inline">{selo}</span>
        <span className="md:hidden">Correios</span>
      </Link>

      <Dialog open={aberto} onOpenChange={(v) => (v ? undefined : fechar())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300">
              <KeyRound className="size-5" />
            </div>
            <DialogTitle className="text-lg font-semibold">{titulo}</DialogTitle>
            <DialogDescription className="space-y-2 text-sm leading-relaxed">
              {status.ilegivel ? (
                <span className="block">
                  A chave salva não pôde ser lida pelo sistema. Gere uma chave nova no CWS dos Correios e salve
                  na tela de rastreio.
                </span>
              ) : (
                <span className="block">
                  {vencida ? "Venceu em " : "Ela vence em "}
                  <strong className="text-foreground">{formatarData(status.expira_em)}</strong>.{" "}
                  {vencida
                    ? "O rastreio dos pedidos no funil parou de atualizar."
                    : "Depois disso, o rastreio dos pedidos no funil para de atualizar."}
                </span>
              )}
              <span className="block">
                Leva uns 5 minutos: gere uma chave nova no site dos Correios e cole no CRM. O passo a passo está
                na tela.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={fechar}>
              Lembrar depois
            </Button>
            <Button
              onClick={() => {
                fechar();
                router.push(LINK_TELA_CHAVE);
              }}
            >
              Trocar a chave agora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
