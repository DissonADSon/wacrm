"use client";

import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, CircleAlert, Clock, MessageCircleCheck, PackageCheck, Truck, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

// Espelha MAX_TENTATIVAS e RECENTE_MS de src/lib/correios/aviso.ts.
const MAX_TENTATIVAS_AVISO = 3;
const RETENTA_ATE_MS = 24 * 60 * 60 * 1000;

function vaiTentarDeNovo(a: NonNullable<Deal["avisos"]>[number]) {
  return a.status === "falhou" && a.tentativas < MAX_TENTATIVAS_AVISO && Date.now() - Date.parse(a.criado_em) < RETENTA_ATE_MS;
}

function avisoAtual(deal: Deal) {
  const lista = (deal.avisos ?? []).filter((a) => a.status !== "legado");
  if (!lista.length) return null;
  // O código mais recente do card é o que vale.
  return lista.reduce((a, b) => (a.criado_em >= b.criado_em ? a : b));
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const contactLabel = deal.contact?.name || deal.contact?.phone || "Sem contato";
  const assigneeLabel = deal.assignee?.full_name || null;
  const aviso = avisoAtual(deal);

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {deal.title}
        </h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            Ganhou
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            Perdeu
          </span>
        )}
      </div>

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-bold text-primary">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.expected_close_date && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>

      {deal.tracking?.descricao && (
        <div
          title={`Rastreio ${deal.tracking.codigo}`}
          className={`mt-2 flex items-start gap-1.5 text-[11px] leading-snug ${
            deal.tracking.entregue ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {deal.tracking.entregue ? (
            <PackageCheck className="mt-px h-3.5 w-3.5 shrink-0" />
          ) : (
            <Truck className="mt-px h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0 break-words">
            {deal.tracking.descricao}
            {deal.tracking.cidade &&
              ` · ${deal.tracking.cidade}${deal.tracking.uf ? `/${deal.tracking.uf}` : ""}`}
          </span>
        </div>
      )}

      {aviso && (
        <div
          title={aviso.erro ?? `Código ${aviso.codigo}${aviso.canal ? ` · ${aviso.canal}` : ""}`}
          className={`mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug ${
            aviso.status === "falhou" && !vaiTentarDeNovo(aviso) ? "text-red-400" : "text-muted-foreground"
          }`}
        >
          {aviso.status === "enviado" ? (
            <MessageCircleCheck className="mt-px h-3.5 w-3.5 shrink-0" />
          ) : aviso.status === "falhou" && !vaiTentarDeNovo(aviso) ? (
            <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          ) : (
            <Clock className="mt-px h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0 break-words">
            {aviso.status === "enviado"
              ? `Rastreio enviado ao cliente${aviso.enviado_em ? ` · ${formatHora(aviso.enviado_em)}` : ""}`
              : vaiTentarDeNovo(aviso)
                ? `Rastreio ao cliente: tentando de novo (${aviso.tentativas + 1} de ${MAX_TENTATIVAS_AVISO})`
                : aviso.status === "falhou"
                  ? `Rastreio não enviado ao cliente: ${aviso.erro ?? "erro desconhecido"}`
                  : "Enviando rastreio ao cliente…"}
          </span>
        </div>
      )}

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </button>
  );
}
