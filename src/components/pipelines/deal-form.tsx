"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
import type {
  Contact,
  Conversation,
  Deal,
  DealCustomField,
  DealStatus,
  Pipeline,
  PipelineStage,
  Profile,
} from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  X,
  Trash2,
  MessageSquare,
  DollarSign,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  /** Todos os funis da conta — habilita mover a oportunidade entre funis. */
  pipelines: Pipeline[];
  defaultStageId?: string;
  onSaved: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  pipelines,
  defaultStageId,
  onSaved,
}: DealFormProps) {
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [contactId, setContactId] = useState("");
  const [stageId, setStageId] = useState("");
  // Funil escolhido (pode diferir do funil atual da página → mover entre funis).
  const [pipelineIdSel, setPipelineIdSel] = useState(pipelineId);
  // Etapas do funil escolhido. Reaproveita `stages` para o funil atual;
  // busca as etapas do destino quando o usuário troca de funil.
  const [stageOptions, setStageOptions] = useState<PipelineStage[]>(stages);
  // Verdadeiro enquanto busca as etapas de outro funil — trava o salvar para
  // não gravar etapa de um funil com pipeline_id de outro (card órfão).
  const [stagesLoading, setStagesLoading] = useState(false);
  const [assignedTo, setAssignedTo] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  // Campos personalizados da oportunidade (defs + valores por campo)
  const [customFields, setCustomFields] = useState<DealCustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (deal) {
      setTitle(deal.title);
      setValue(String(deal.value ?? ""));
      setCurrency(deal.currency || defaultCurrency);
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setPipelineIdSel(deal.pipeline_id);
      setAssignedTo(deal.assigned_to ?? "");
      setExpectedCloseDate(deal.expected_close_date ?? "");
      setNotes(deal.notes ?? "");
    } else {
      setTitle("");
      setValue("");
      setCurrency(defaultCurrency);
      setContactId("");
      setStageId(defaultStageId || stages[0]?.id || "");
      setPipelineIdSel(pipelineId);
      setAssignedTo("");
      setExpectedCloseDate("");
      setNotes("");
    }
  }, [open, deal, defaultStageId, stages, pipelineId, defaultCurrency]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Carrega as etapas do funil escolhido. Para o funil atual, reaproveita as
  // etapas já carregadas pela página. Ao trocar para outro funil, busca as
  // etapas do destino e reseta a etapa para a 1ª — CRÍTICO: como não há FK
  // amarrando stage_id ao pipeline_id, gravar pipeline novo com etapa antiga
  // deixaria o card órfão (sumiria do board).
  useEffect(() => {
    if (!open || !pipelineIdSel) return;
    if (pipelineIdSel === pipelineId) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setStageOptions(stages);
      // Revalida a etapa: se a etapa atual não pertence a este funil (caso de
      // trocar de funil e voltar), reseta para a 1ª. Preserva deal.stage_id na
      // abertura, pois ele pertence ao funil atual.
      setStageId((cur) => (stages.some((s) => s.id === cur) ? cur : stages[0]?.id ?? ""));
      setStagesLoading(false);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStagesLoading(true);
    (async () => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineIdSel)
        .order("position");
      if (cancelled) return;
      const opts = (data ?? []) as PipelineStage[];
      setStageOptions(opts);
      setStageId(opts[0]?.id ?? "");
      setStagesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pipelineIdSel, pipelineId, stages, supabase]);

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p] = await Promise.all([
        supabase.from("contacts").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  // Carrega as defs de campos personalizados sempre que o form abrir; e os
  // valores apenas quando estiver editando uma oportunidade existente.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [fieldsRes, valuesRes] = await Promise.all([
        supabase.from("deal_custom_fields").select("*").order("field_name"),
        deal?.id
          ? supabase
              .from("deal_custom_values")
              .select("*")
              .eq("deal_id", deal.id)
          : Promise.resolve({ data: [] as { deal_custom_field_id: string; value: string | null }[] }),
      ]);
      if (cancelled) return;
      setCustomFields((fieldsRes.data ?? []) as DealCustomField[]);
      const map: Record<string, string> = {};
      (valuesRes.data ?? []).forEach((v) => {
        map[v.deal_custom_field_id] = v.value ?? "";
      });
      setCustomValues(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, deal?.id, supabase]);

  // Fetch linked conversation for the selected contact (newest open one).
  // Clearing on no-selection is sync with prop state; the populated
  // case runs setLinkedConversation inside the async fetch callback.
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        // nullsFirst: false — sem isto o limit(1) pegava a conversa vazia
        // (last_message_at NULL) em vez da que tem histórico.
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  // Persiste os valores dos campos personalizados (delete + re-insert).
  // Não aborta o fluxo de salvar: em caso de erro, só avisa via toast.
  async function persistCustomValues(dealId: string) {
    try {
      await supabase
        .from("deal_custom_values")
        .delete()
        .eq("deal_id", dealId);

      const rows = Object.entries(customValues)
        .filter(([, val]) => val.trim())
        .map(([fieldId, val]) => ({
          deal_id: dealId,
          deal_custom_field_id: fieldId,
          value: val.trim(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from("deal_custom_values")
          .insert(rows);
        if (error) throw error;
      }
    } catch {
      toast.warning("Oportunidade salva, mas os campos personalizados não foram salvos");
    }
  }

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error("Título, contato e etapa são obrigatórios");
      return;
    }
    // Anti-órfão: nunca gravar uma etapa que não pertence ao funil escolhido
    // (vale também enquanto as etapas do novo funil ainda carregam).
    if (stagesLoading || !stageOptions.some((s) => s.id === stageId)) {
      toast.error("Aguarde carregar as etapas e selecione uma etapa válida do funil");
      return;
    }
    setSaving(true);

    const payload = {
      title: title.trim(),
      value: parseFloat(value) || 0,
      currency,
      contact_id: contactId,
      pipeline_id: pipelineIdSel,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      notes: notes.trim() || null,
      expected_close_date: expectedCloseDate || null,
    };

    if (deal) {
      const { error } = await supabase
        .from("deals")
        .update(payload)
        .eq("id", deal.id);
      if (error) {
        toast.error("Falha ao salvar a oportunidade");
        setSaving(false);
        return;
      }
      await persistCustomValues(deal.id);
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error("Você não está autenticado");
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error("Seu perfil não está vinculado a uma conta.");
        setSaving(false);
        return;
      }
      const { data: created, error } = await supabase
        .from("deals")
        .insert({ ...payload, user_id: user.id, account_id: accountId, status: "open" })
        .select("id")
        .single();
      if (error) {
        toast.error("Falha ao criar a oportunidade");
        setSaving(false);
        return;
      }
      if (created?.id) {
        await persistCustomValues(created.id);
      }
    }

    setSaving(false);
    toast.success(deal ? "Oportunidade atualizada" : "Oportunidade criada");
    onOpenChange(false);
    onSaved();
  }

  async function handleStatusChange(status: DealStatus) {
    if (!deal) return;
    setStatusAction(status);
    const { error } = await supabase
      .from("deals")
      .update({ status })
      .eq("id", deal.id);
    setStatusAction(null);
    if (error) {
      toast.error("Falha ao atualizar o status da oportunidade");
      return;
    }
    toast.success(
      status === "won" ? "Marcada como ganha" : status === "lost" ? "Marcada como perdida" : "Oportunidade reaberta",
    );
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeleting(false);
    if (error) {
      toast.error("Falha ao excluir a oportunidade");
      return;
    }
    toast.success("Oportunidade excluída");
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? "Editar oportunidade" : "Nova oportunidade"}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Título</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título da oportunidade"
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Contato</Label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Selecione um contato</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>

              {linkedConversation && (
                <Link
                  href={`/inbox?c=${linkedConversation.id}`}
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
                >
                  <MessageSquare className="h-3 w-3" />
                  Ir para a conversa
                </Link>
              )}
            </div>

            <div className="grid grid-cols-[1fr_110px] gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Valor</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="0,00"
                    className="border-border bg-muted pl-7 text-foreground"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Moeda</Label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Data prevista de fechamento</Label>
              <Input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>

            {pipelines.length > 1 && (
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Funil</Label>
                <select
                  value={pipelineIdSel}
                  onChange={(e) => setPipelineIdSel(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {deal && pipelineIdSel !== deal.pipeline_id && (
                  <p className="text-xs text-amber-400">
                    A oportunidade será movida para este funil, na 1ª etapa.
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Etapa</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                {stageOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Responsável</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">Sem responsável</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Notas</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Adicione notas..."
                className="min-h-[100px] border-border bg-muted text-foreground"
              />
            </div>

            {customFields.length > 0 && (
              <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Campos personalizados
                </p>
                {customFields.map((field) => (
                  <div key={field.id} className="grid gap-2">
                    <Label className="text-muted-foreground capitalize">
                      {field.field_name}
                    </Label>
                    <Input
                      value={customValues[field.id] ?? ""}
                      onChange={(e) =>
                        setCustomValues((prev) => ({
                          ...prev,
                          [field.id]: e.target.value,
                        }))
                      }
                      placeholder={`Informe ${field.field_name}...`}
                      className="border-border bg-muted text-foreground"
                    />
                  </div>
                ))}
              </div>
            )}

            {deal && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("won")}
                    disabled={!!statusAction || deal.status === "won"}
                    className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {statusAction === "won" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        Marcar como ganha
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("lost")}
                    disabled={!!statusAction || deal.status === "lost"}
                    className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {statusAction === "lost" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <X className="mr-1 h-4 w-4" />
                        Marcar como perdida
                      </>
                    )}
                  </Button>
                </div>
                {deal.status && deal.status !== "open" && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleStatusChange("open")}
                    disabled={!!statusAction}
                    className="w-full text-muted-foreground hover:text-foreground"
                  >
                    Reabrir oportunidade
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || stagesLoading || !title.trim() || !contactId || !stageId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? "Salvando..." : deal ? "Salvar alterações" : "Criar oportunidade"}
              </Button>
            </div>

            {deal &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">Excluir esta oportunidade?</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? "Excluindo..." : "Confirmar"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  Excluir oportunidade
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
