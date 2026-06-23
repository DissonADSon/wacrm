"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MessageTemplate, Contact, Conversation } from "@/types";
import {
  resolveTemplateBodyValues,
  describeMapping,
  type ResolveContext,
  type TemplateVariableMappings,
  type TemplateVariableMapping,
} from "@/lib/whatsapp/template-variables";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ChevronRight,
  LayoutTemplate,
  Loader2,
} from "lucide-react";
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";

export interface TemplateSendValues {
  body: string[];
  headerText?: string;
  buttonParams?: Record<number, string>;
}

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, values: TemplateSendValues) => void;
  /** Contato da conversa — usado para auto-preencher variáveis mapeadas. */
  contact?: Contact | null;
  /** Conversa atual — usada para localizar o card/deal aberto e seus campos. */
  conversation?: Conversation | null;
}

function renderBodyPreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    const value = params[idx];
    return value && value.trim().length > 0 ? value : `{{${raw}}}`;
  });
}

interface UrlButtonSlot {
  index: number;
  text: string;
  url: string;
}

/**
 * Templates may need values for: body variables, a text-header
 * variable, and per-URL-button suffixes. Collect them all so the
 * send-message path doesn't 400 on missing parameters.
 */
function collectVariableSlots(template: MessageTemplate): {
  bodyVars: number[];
  headerVarCount: number;
  urlButtonSlots: UrlButtonSlot[];
} {
  const bodyVars = extractVariableIndices(template.body_text);
  const headerVarCount =
    template.header_type === "text" && template.header_content
      ? extractVariableIndices(template.header_content).length
      : 0;
  const urlButtonSlots: UrlButtonSlot[] = [];
  (template.buttons ?? []).forEach((b, i) => {
    if (b.type === "URL" && extractVariableIndices(b.url).length > 0) {
      urlButtonSlots.push({ index: i, text: b.text, url: b.url });
    }
  });
  return { bodyVars, headerVarCount, urlButtonSlots };
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
  contact,
  conversation,
}: TemplatePickerProps) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState<string>("");
  const [buttonParams, setButtonParams] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) {
          setTemplates([]);
          setLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "APPROVED")
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch templates:", error);
        setTemplates([]);
      } else {
        setTemplates((data as MessageTemplate[]) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  function resetSelection() {
    setSelected(null);
    setParams([]);
    setHeaderText("");
    setButtonParams({});
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetSelection();
    onOpenChange(next);
  }

  /**
   * Monta o ResolveContext a partir do contato + card/deal aberto da
   * conversa, buscando os campos personalizados de ambos. Degrada com
   * graça: sem conversa/contato/deal, devolve um contexto parcial e a
   * resolução simplesmente cai pra string vazia (preenche na hora).
   */
  async function buildResolveContext(): Promise<ResolveContext> {
    const ctx: ResolveContext = {};
    if (contact) {
      ctx.contact = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
        city: contact.city,
      };
    }

    const supabase = createClient();

    // Campos personalizados do contato.
    if (contact?.id) {
      const { data: contactValues } = await supabase
        .from("contact_custom_values")
        .select("custom_field_id, value")
        .eq("contact_id", contact.id);
      if (contactValues?.length) {
        const map: Record<string, string> = {};
        for (const row of contactValues) {
          map[row.custom_field_id] = row.value ?? "";
        }
        ctx.contactCustom = map;
      }
    }

    // Card/deal mais recente da conversa + seus campos personalizados.
    if (conversation?.id) {
      const { data: deals } = await supabase
        .from("deals")
        .select("id, title, value")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: false })
        .limit(1);
      const deal = deals?.[0];
      if (deal) {
        ctx.deal = { title: deal.title, value: deal.value };
        const { data: dealValues } = await supabase
          .from("deal_custom_values")
          .select("deal_custom_field_id, value")
          .eq("deal_id", deal.id);
        if (dealValues?.length) {
          const map: Record<string, string> = {};
          for (const row of dealValues) {
            map[row.deal_custom_field_id] = row.value ?? "";
          }
          ctx.dealCustom = map;
        }
      }
    }

    return ctx;
  }

  async function pickTemplate(template: MessageTemplate) {
    const slots = collectVariableSlots(template);
    const noInputsNeeded =
      slots.bodyVars.length === 0 &&
      slots.headerVarCount === 0 &&
      slots.urlButtonSlots.length === 0;
    if (noInputsNeeded) {
      onSelect(template, { body: [] });
      handleOpenChange(false);
      return;
    }
    setSelected(template);
    setHeaderText("");
    setButtonParams({});

    // Sem variáveis de corpo ou sem mapeamento: começa vazio (preenche
    // na hora). Com mapeamento, resolve a partir do contato/card.
    if (slots.bodyVars.length === 0 || !template.variable_mappings) {
      setParams(new Array(slots.bodyVars.length).fill(""));
      return;
    }

    setParams(new Array(slots.bodyVars.length).fill(""));
    try {
      const ctx = await buildResolveContext();
      const resolved = resolveTemplateBodyValues(
        template.variable_mappings as TemplateVariableMappings,
        slots.bodyVars.length,
        ctx,
      );
      // Só aplica se o template selecionado ainda é este (o usuário pode
      // ter voltado/trocado enquanto a busca rodava).
      setSelected((curr) => {
        if (curr?.id === template.id) setParams(resolved);
        return curr;
      });
    } catch (err) {
      console.error("Falha ao auto-preencher variáveis do template:", err);
      // Mantém os campos vazios — o usuário preenche na hora.
    }
  }

  function confirm() {
    if (!selected) return;
    const values: TemplateSendValues = { body: params };
    if (headerText.trim()) values.headerText = headerText.trim();
    if (Object.keys(buttonParams).length > 0) {
      values.buttonParams = Object.fromEntries(
        Object.entries(buttonParams).map(([k, v]) => [Number(k), v.trim()]),
      );
    }
    onSelect(selected, values);
    handleOpenChange(false);
  }

  const slots = useMemo(
    () => (selected ? collectVariableSlots(selected) : null),
    [selected],
  );
  const canConfirm =
    !!selected &&
    !!slots &&
    slots.bodyVars.every((_, i) => (params[i] ?? "").trim().length > 0) &&
    (slots.headerVarCount === 0 || headerText.trim().length > 0) &&
    slots.urlButtonSlots.every(
      (s) => (buttonParams[s.index] ?? "").trim().length > 0,
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <LayoutTemplate className="h-4 w-4 text-primary" />
            {selected ? selected.name : "Enviar template"}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {selected
              ? "Preencha os campos para renderizar este template. A Meta exige que todas as variáveis sejam definidas."
              : "Escolha um template do WhatsApp aprovado para enviar a este contato."}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-md border border-border bg-background/50 p-6 text-center">
                <p className="text-sm text-popover-foreground">Nenhum template aprovado</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Aprove um template no Meta WhatsApp Manager e depois
                  sincronize em Configurações → Templates.
                </p>
              </div>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickTemplate(t)}
                  className="w-full rounded-md border border-border bg-background/50 p-3 text-left transition-colors hover:border-primary/40 hover:bg-popover"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-popover-foreground">
                          {t.name}
                        </p>
                        <Badge className="border border-primary/30 bg-primary/20 text-[10px] text-primary">
                          {t.category}
                        </Badge>
                        {t.language && (
                          <span className="text-[10px] uppercase text-muted-foreground">
                            {t.language}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {t.body_text}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-background/50 p-3">
              <p className="mb-1 text-xs text-muted-foreground">Pré-visualização</p>
              <p className="whitespace-pre-wrap text-sm text-popover-foreground">
                {renderBodyPreview(selected.body_text, params)}
              </p>
              {selected.footer_text && (
                <p className="mt-2 text-xs italic text-muted-foreground">
                  {selected.footer_text}
                </p>
              )}
            </div>
            {slots && slots.headerVarCount > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-popover-foreground">
                  {`Cabeçalho {{1}}`}
                </Label>
                <Input
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder="Valor para a variável do cabeçalho"
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
              </div>
            )}
            {slots?.bodyVars.map((v, i) => {
              const mapping = selected.variable_mappings?.[String(v)];
              return (
                <div key={v} className="space-y-1">
                  <Label className="text-xs text-popover-foreground">{`Corpo {{${v}}}`}</Label>
                  <Input
                    value={params[i] ?? ""}
                    onChange={(e) => {
                      const next = [...params];
                      next[i] = e.target.value;
                      setParams(next);
                    }}
                    placeholder={`Valor para {{${v}}}`}
                    className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                  />
                  {mapping && (
                    <p className="text-xs text-muted-foreground">
                      {describeMapping(mapping as TemplateVariableMapping)}
                    </p>
                  )}
                </div>
              );
            })}
            {slots?.urlButtonSlots.map((slot) => (
              <div key={slot.index} className="space-y-1">
                <Label className="text-xs text-popover-foreground">
                  {`Botão de URL "${slot.text}" — valor para `}{`{{1}}`}
                </Label>
                <Input
                  value={buttonParams[slot.index] ?? ""}
                  onChange={(e) =>
                    setButtonParams((prev) => ({
                      ...prev,
                      [slot.index]: e.target.value,
                    }))
                  }
                  placeholder="Valor do sufixo da URL"
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-[10px] text-muted-foreground break-all">
                  URL final: {slot.url.replace(/\{\{1\}\}/g, buttonParams[slot.index] || "{{1}}")}
                </p>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={resetSelection}
                className="border-border text-popover-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={confirm}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Enviar template
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border text-popover-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
