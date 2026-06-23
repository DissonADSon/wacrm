'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  AlertCircle,
  X,
  Pencil,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  uploadAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { useAuth } from '@/hooks/use-auth';
import { APP_NAME } from '@/lib/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  MessageTemplate,
  TemplateButton,
  TemplateSampleValues,
  CustomField,
  DealCustomField,
} from '@/types';
import { templateStatusConfig } from '@/lib/template-status';
import {
  extractVariableIndices,
  TEMPLATE_LIMITS,
} from '@/lib/whatsapp/template-validators';
import {
  CONTACT_FIELD_OPTIONS,
  DEAL_FIELD_OPTIONS,
  type TemplateVariableSource,
} from '@/lib/whatsapp/template-variables';

const CATEGORIES = ['Marketing', 'Utility', 'Authentication'] as const;
type HeaderFormat = 'none' | 'text' | 'image' | 'video' | 'document';
const HEADER_FORMATS: HeaderFormat[] = ['none', 'text', 'image', 'video', 'document'];
const HEADER_FORMAT_LABELS: Record<HeaderFormat, string> = {
  none: 'Nenhum',
  text: 'Texto',
  image: 'Imagem',
  video: 'Vídeo',
  document: 'Documento',
};

// Sentinela do <select> de fonte de variável: nenhum mapeamento (a variável
// será preenchida na hora do envio). String não-vazia porque o Select do
// @base-ui não aceita value="".
const VAR_SOURCE_NONE = '__none__';
// Sentinela para a fonte "Valor fixo" — quando escolhida, mostramos um Input
// para o usuário digitar o texto que vai sempre nessa variável.
const VAR_SOURCE_STATIC = '__static__';

// Codifica/decodifica o valor do <select> de fonte numa única string, já que
// a opção carrega a fonte (source) E o campo (value). Ex.: "contact_field:name".
function encodeVarOption(source: TemplateVariableSource, value: string): string {
  return `${source}:${value}`;
}
function decodeVarOption(
  raw: string,
): { source: TemplateVariableSource; value: string } | null {
  const i = raw.indexOf(':');
  if (i < 0) return null;
  return {
    source: raw.slice(0, i) as TemplateVariableSource,
    value: raw.slice(i + 1),
  };
}

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
  Utility: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  Authentication: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
};

interface TemplateFormData {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_format: HeaderFormat;
  header_content: string;
  header_media_url: string;
  header_sample: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
  // Mapeamento de cada variável {{N}} (índice 1-based como string) à sua
  // fonte (a "legenda"). source vazio = sem mapeamento (preencher na hora).
  variable_mappings: Record<string, { source: string; value: string }>;
}

const emptyForm: TemplateFormData = {
  name: '',
  category: 'Marketing',
  language: 'en_US',
  header_format: 'none',
  header_content: '',
  header_media_url: '',
  header_sample: '',
  body_text: '',
  body_samples: [],
  footer_text: '',
  buttons: [],
  variable_mappings: {},
};

const COMMON_LANGUAGE_CODES = [
  'en_US',
  'en_GB',
  'en',
  'es',
  'es_ES',
  'es_MX',
  'fr',
  'fr_FR',
  'de',
  'it',
  'pt_BR',
  'pt_PT',
  'nl',
  'pl',
  'ru',
  'tr',
  'lt',
];

function emptyButton(type: TemplateButton['type']): TemplateButton {
  switch (type) {
    case 'QUICK_REPLY':
      return { type: 'QUICK_REPLY', text: '' };
    case 'URL':
      return { type: 'URL', text: '', url: '' };
    case 'PHONE_NUMBER':
      return { type: 'PHONE_NUMBER', text: '', phone_number: '' };
    case 'COPY_CODE':
      return { type: 'COPY_CODE', text: '', example: '' };
  }
}

export function TemplateManager() {
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  // Campos personalizados de contato e de card — alimentam o <select> de
  // fonte de cada variável (a "legenda" do que cada {{N}} significa).
  const [contactCustomFields, setContactCustomFields] = useState<CustomField[]>(
    [],
  );
  const [dealCustomFields, setDealCustomFields] = useState<DealCustomField[]>(
    [],
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<TemplateFormData>(emptyForm);
  // Non-null when the dialog is editing an existing row — switches the
  // submit handler from POST /submit to PATCH /[id] and changes the
  // dialog title + CTA. Set to the template id to pre-fill from a row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Template selected for the confirm-delete dialog. The destructive
  // action goes through this two-step so a slip on the trash icon
  // doesn't take the template off Meta as well as locally.
  const [templateToDelete, setTemplateToDelete] =
    useState<MessageTemplate | null>(null);
  // Header-image upload (issue #230). Uploads to the account-scoped
  // chat-media bucket and stores the public URL in header_media_url; the
  // submit route turns that into a Meta Resumable-Upload handle.
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const headerFileRef = useRef<HTMLInputElement>(null);

  // Body variable indices — `[1, 2, 3]` for "{{1}} {{2}} {{3}}". We
  // re-run the extractor on every render to keep the sample-value rows
  // in sync with what the user typed.
  const bodyVarCount = useMemo(
    () => extractVariableIndices(form.body_text).length,
    [form.body_text],
  );
  const headerVarCount = useMemo(
    () =>
      form.header_format === 'text'
        ? extractVariableIndices(form.header_content).length
        : 0,
    [form.header_format, form.header_content],
  );

  // Resize body_samples so it always has exactly bodyVarCount entries.
  // (We mutate via setForm in an effect so React owns the state.)
  useEffect(() => {
    setForm((prev) => {
      if (prev.body_samples.length === bodyVarCount) return prev;
      const next = prev.body_samples.slice(0, bodyVarCount);
      while (next.length < bodyVarCount) next.push('');
      return { ...prev, body_samples: next };
    });
  }, [bodyVarCount]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchTemplates(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  async function fetchTemplates(userId: string) {
    try {
      setLoading(true);
      // Carrega templates + campos personalizados (contato e card) em
      // paralelo. Os campos alimentam o <select> de fonte das variáveis.
      const [templatesRes, contactFieldsRes, dealFieldsRes] = await Promise.all([
        supabase
          .from('message_templates')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        supabase.from('custom_fields').select('*').order('field_name'),
        supabase.from('deal_custom_fields').select('*').order('field_name'),
      ]);
      if (templatesRes.error) throw templatesRes.error;
      setTemplates(templatesRes.data || []);
      setContactCustomFields((contactFieldsRes.data as CustomField[]) ?? []);
      setDealCustomFields((dealFieldsRes.data as DealCustomField[]) ?? []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error('Falha ao carregar os templates');
    } finally {
      setLoading(false);
    }
  }

  function buildSubmitPayload() {
    const sample_values: TemplateSampleValues = {};
    if (form.body_samples.some((v) => v.trim())) {
      sample_values.body = form.body_samples.map((v) => v.trim());
    }
    if (form.header_format === 'text' && form.header_sample.trim()) {
      sample_values.header = [form.header_sample.trim()];
    }

    // Mantém apenas o mapeamento das variáveis que existem no corpo agora e
    // têm uma fonte de fato escolhida (descarta sentinela "sem mapeamento").
    const bodyIndices = extractVariableIndices(form.body_text);
    const variable_mappings: Record<string, { source: string; value: string }> = {};
    for (const idx of bodyIndices) {
      const m = form.variable_mappings[String(idx)];
      if (m && m.source) variable_mappings[String(idx)] = m;
    }

    return {
      name: form.name.trim(),
      category: form.category,
      language: form.language.trim() || 'en_US',
      header_type: form.header_format === 'none' ? undefined : form.header_format,
      header_content:
        form.header_format === 'text' ? form.header_content.trim() : undefined,
      header_media_url:
        form.header_format !== 'none' && form.header_format !== 'text'
          ? form.header_media_url.trim() || undefined
          : undefined,
      body_text: form.body_text.trim(),
      footer_text: form.footer_text.trim() || undefined,
      buttons: form.buttons.length > 0 ? form.buttons : undefined,
      sample_values:
        Object.keys(sample_values).length > 0 ? sample_values : undefined,
      variable_mappings:
        Object.keys(variable_mappings).length > 0 ? variable_mappings : null,
    };
  }

  function openEdit(template: MessageTemplate) {
    setEditingId(template.id);
    setForm({
      name: template.name,
      category: template.category,
      language: template.language || 'en_US',
      header_format: (template.header_type ?? 'none') as HeaderFormat,
      header_content: template.header_content ?? '',
      header_media_url: template.header_media_url ?? '',
      header_sample: template.sample_values?.header?.[0] ?? '',
      body_text: template.body_text,
      body_samples: template.sample_values?.body ?? [],
      footer_text: template.footer_text ?? '',
      buttons: template.buttons ?? [],
      variable_mappings: template.variable_mappings
        ? { ...template.variable_mappings }
        : {},
    });
    setDialogOpen(true);
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    // AUTHENTICATION is blocked by the persistent banner + disabled
    // submit button; this is a defensive second line of defense.
    if (form.category === 'Authentication') return;
    try {
      setSubmitting(true);
      const isEdit = editingId !== null;
      const url = isEdit
        ? `/api/whatsapp/templates/${editingId}`
        : '/api/whatsapp/templates/submit';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSubmitPayload()),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error || `Falha ao ${isEdit ? 'editar' : 'enviar'} (HTTP ${res.status})`,
        );
      }
      // Refresh first, then close — re-opening the dialog
      // immediately should not show a stale list.
      if (user) await fetchTemplates(user.id);
      toast.success(
        data.dry_run
          ? isEdit
            ? 'Template atualizado (simulação — sem chamada à Meta)'
            : 'Template salvo (simulação — sem chamada à Meta)'
          : isEdit
            ? 'Edição enviada — a Meta normalmente revisa em até 24 horas.'
            : 'Enviado à Meta — o tempo de revisão típico é de 24 horas. O status é atualizado automaticamente.',
      );
      setDialogOpen(false);
      setForm(emptyForm);
      setEditingId(null);
    } catch (err) {
      console.error('Submit error:', err);
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSyncFromMeta() {
    if (!user) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Falha na sincronização (HTTP ${res.status})`);
      }
      toast.success(
        `${data.total} template${data.total === 1 ? '' : 's'} sincronizado${data.total === 1 ? '' : 's'} da Meta` +
          (data.inserted || data.updated
            ? ` (${data.inserted} novo(s), ${data.updated} atualizado(s))`
            : ''),
      );
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        const preview = data.errors.slice(0, 3).map(
          (e: { name: string; language: string; message: string }) =>
            `${e.name} (${e.language})`,
        );
        const suffix =
          data.errors.length > 3 ? `, +${data.errors.length - 3} restante(s)` : '';
        toast.error(`Falha ao sincronizar: ${preview.join(', ')}${suffix}`);
      }
      if (data.truncated) {
        // Use error (not warning) so the message survives long
        // enough to read — sonner's `warning` auto-dismisses on
        // the same short timer as `success`.
        toast.error(
          'Sincronizados apenas os primeiros 2000 templates — sua conta tem mais. Sincronize novamente para continuar, ou contate o suporte se isso persistir.',
          { duration: 10000 },
        );
      }
      await fetchTemplates(user.id);
    } catch (err) {
      console.error('Template sync error:', err);
      toast.error(err instanceof Error ? err.message : 'Falha ao sincronizar os templates');
    } finally {
      setSyncing(false);
    }
  }

  async function confirmDelete() {
    const target = templateToDelete;
    if (!target || deletingId) return;
    setDeletingId(target.id);
    try {
      // Route handler scopes the Meta delete via hsm_id (so sibling
      // language variants survive) and falls through to remove the
      // local row. Local-only rows skip the Meta call.
      const res = await fetch(`/api/whatsapp/templates/${target.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Falha ao excluir (HTTP ${res.status})`);
      }
      toast.success('Template excluído');
      setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      setTemplateToDelete(null);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error(err instanceof Error ? err.message : 'Falha ao excluir o template');
    } finally {
      setDeletingId(null);
    }
  }

  // The patch type unions every field across button variants. The
  // conditional rendering below ensures only fields valid for the
  // current button's `type` reach this function, so the runtime
  // assertion + per-type spread preserves discriminated-union
  // invariants without forcing every call site to thread the type
  // through generics (which TS can't infer from a partial literal).
  type ButtonPatch = {
    text?: string;
    url?: string;
    phone_number?: string;
    example?: string;
  };
  function updateButton(index: number, patch: ButtonPatch) {
    setForm((prev) => {
      const current = prev.buttons[index];
      if (!current) return prev;
      const next = [...prev.buttons];
      // Per-variant spread keeps the discriminant pinned. Switch
      // exhaustiveness is enforced by TypeScript.
      switch (current.type) {
        case 'QUICK_REPLY':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
          };
          break;
        case 'URL':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.url !== undefined && { url: patch.url }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
        case 'PHONE_NUMBER':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.phone_number !== undefined && {
              phone_number: patch.phone_number,
            }),
          };
          break;
        case 'COPY_CODE':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
      }
      return { ...prev, buttons: next };
    });
  }

  function changeButtonType(index: number, type: TemplateButton['type']) {
    setForm((prev) => {
      const next = [...prev.buttons];
      next[index] = emptyButton(type);
      return { ...prev, buttons: next };
    });
  }

  function removeButton(index: number) {
    setForm((prev) => ({
      ...prev,
      buttons: prev.buttons.filter((_, i) => i !== index),
    }));
  }

  function addButton() {
    if (form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal) return;
    setForm((prev) => ({
      ...prev,
      buttons: [...prev.buttons, emptyButton('QUICK_REPLY')],
    }));
  }

  // Atualiza a fonte de UMA variável a partir do valor escolhido no <select>.
  // O valor de "Valor fixo" preserva o texto já digitado.
  function setVarSource(index: number, raw: string) {
    setForm((prev) => {
      const key = String(index);
      const next = { ...prev.variable_mappings };
      if (raw === VAR_SOURCE_NONE) {
        delete next[key];
      } else if (raw === VAR_SOURCE_STATIC) {
        next[key] = { source: 'static', value: prev.variable_mappings[key]?.value ?? '' };
      } else {
        const decoded = decodeVarOption(raw);
        if (decoded) next[key] = { source: decoded.source, value: decoded.value };
      }
      return { ...prev, variable_mappings: next };
    });
  }

  // Atualiza o texto fixo (source === 'static') de UMA variável.
  function setVarStaticValue(index: number, value: string) {
    setForm((prev) => {
      const key = String(index);
      return {
        ...prev,
        variable_mappings: {
          ...prev.variable_mappings,
          [key]: { source: 'static', value },
        },
      };
    });
  }

  // Valor atual do <select> de fonte de UMA variável (codifica fonte+campo).
  function varSelectValue(index: number): string {
    const m = form.variable_mappings[String(index)];
    if (!m || !m.source) return VAR_SOURCE_NONE;
    if (m.source === 'static') return VAR_SOURCE_STATIC;
    return encodeVarOption(m.source as TemplateVariableSource, m.value);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const headerNeedsMedia =
    form.header_format !== 'none' && form.header_format !== 'text';

  async function handleHeaderImageFile(file: File) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast.error('A imagem do cabeçalho deve ser JPEG ou PNG.');
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error(
        `A imagem tem ${(file.size / 1024 / 1024).toFixed(1)} MB — o limite da Meta é 5 MB.`,
      );
      return;
    }
    setUploadingHeader(true);
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      setForm((f) => ({ ...f, header_media_url: publicUrl }));
      toast.success('Imagem enviada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha no upload.');
    } finally {
      setUploadingHeader(false);
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead
        title="Templates de mensagem"
        description={
          'Crie templates e envie-os à Meta para aprovação. Use "Sincronizar da Meta" para trazer templates aprovados em outro lugar.'
        }
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleSyncFromMeta}
              disabled={syncing}
              title="Trazer templates aprovados da sua Conta do WhatsApp Business na Meta"
            >
              <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Sincronizando…' : 'Sincronizar da Meta'}
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              Novo Template
            </Button>
          </div>
        }
      />

      {templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground text-sm">Nenhum template ainda.</p>
            <p className="text-muted-foreground text-xs mt-1">
              Crie seu primeiro template de mensagem para começar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {templates.map((template) => {
            const statusKey = template.status || 'DRAFT';
            const status = templateStatusConfig[statusKey];
            return (
              <Card key={template.id}>
                <CardContent className="flex items-start justify-between pt-4">
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-foreground">{template.name}</h3>
                      <Badge
                        className={`text-xs border ${categoryColors[template.category] || ''}`}
                      >
                        {template.category}
                      </Badge>
                      <Badge className={`text-xs border ${status.classes}`}>
                        {status.label}
                      </Badge>
                      {template.language && (
                        <span className="text-xs text-muted-foreground uppercase">
                          {template.language}
                        </span>
                      )}
                      {template.quality_score && (
                        <span
                          className={`text-[10px] uppercase font-medium ${
                            template.quality_score === 'GREEN'
                              ? 'text-emerald-400'
                              : template.quality_score === 'YELLOW'
                                ? 'text-yellow-400'
                                : 'text-red-400'
                          }`}
                          title="Pontuação de qualidade da Meta"
                        >
                          {template.quality_score}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {template.body_text}
                    </p>
                    {template.footer_text && (
                      <p className="text-xs text-muted-foreground italic">
                        {template.footer_text}
                      </p>
                    )}
                    {(template.rejection_reason || template.submission_error) && (
                      <div className="flex items-start gap-1.5 text-xs text-red-400 bg-red-950/20 border border-red-900/40 rounded px-2 py-1.5">
                        <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                        <span>
                          {template.rejection_reason || template.submission_error}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {statusKey === 'APPROVED' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(template)}
                        title="Editar dispara nova revisão da Meta — o status volta para PENDING."
                        aria-label="Editar template"
                        className="text-muted-foreground hover:text-primary hover:bg-primary/10 h-8 px-2"
                      >
                        <Pencil className="size-3.5" />
                        Editar
                      </Button>
                    )}
                    {(statusKey === 'REJECTED' || statusKey === 'PAUSED') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(template)}
                        title="Editar o template e reenviar à Meta para revisão."
                        aria-label="Editar e reenviar template"
                        className="text-muted-foreground hover:text-primary hover:bg-primary/10 h-8 px-2"
                      >
                        <RotateCcw className="size-3.5" />
                        Reenviar
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setTemplateToDelete(template)}
                      disabled={deletingId === template.id}
                      aria-label={
                        template.meta_template_id
                          ? 'Excluir template da Meta e localmente'
                          : 'Excluir template localmente'
                      }
                      title={
                        template.meta_template_id
                          ? 'Excluir da Meta e localmente'
                          : 'Excluir localmente'
                      }
                      className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 h-8 w-8"
                    >
                      {deletingId === template.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingId(null);
            setForm(emptyForm);
          }
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editingId ? 'Editar Template de Mensagem' : 'Novo Template de Mensagem'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editingId
                ? 'Salve suas alterações para reenviar à Meta. O status voltará para PENDING durante a revisão.'
                : 'Monte um template e envie-o à Meta para aprovação. Após aprovado, você pode usá-lo em transmissões e na caixa de entrada.'}
            </DialogDescription>
          </DialogHeader>

          {form.category === 'Authentication' && (
            <div className="flex items-start gap-2 rounded border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <p>
                Templates de AUTHENTICATION têm um corpo fixo + botão de OTP
                que exigem um construtor diferente. Por enquanto, crie-os no
                Meta WhatsApp Manager e use <strong>Sincronizar da Meta</strong>{' '}
                para trazê-los.
              </p>
            </div>
          )}

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Nome do Template</Label>
              <Input
                placeholder="ex.: order_confirmation"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={editingId !== null}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <p className="text-[11px] text-muted-foreground">
                {editingId
                  ? 'O nome fica fixo quando o template existe na Meta — crie um novo template para alterá-lo.'
                  : 'Apenas letras minúsculas, dígitos e sublinhados.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Categoria</Label>
                <Select
                  value={form.category}
                  onValueChange={(val) =>
                    setForm({
                      ...form,
                      category: val as MessageTemplate['category'],
                    })
                  }
                >
                  <SelectTrigger className="w-full bg-muted border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {CATEGORIES.map((cat) => (
                      <SelectItem
                        key={cat}
                        value={cat}
                        className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                      >
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Idioma</Label>
                <Input
                  list="template-language-codes"
                  placeholder="en_US"
                  value={form.language}
                  onChange={(e) =>
                    setForm({ ...form, language: e.target.value })
                  }
                  disabled={editingId !== null}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <datalist id="template-language-codes">
                  {COMMON_LANGUAGE_CODES.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
                <p className="text-[11px] text-muted-foreground">
                  {editingId
                    ? 'O idioma fica fixo quando o template existe na Meta.'
                    : (
                        <>
                          Deve corresponder ao código exato na Meta — <code>en_US</code>{' '}
                          e <code>en</code> são distintos.
                        </>
                      )}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Cabeçalho</Label>
              <Select
                value={form.header_format}
                onValueChange={(val) =>
                  // Preserve header_content, header_media_url, and
                  // header_sample across format switches. The submit
                  // payload builder only reads the field that matches
                  // the active format, so an orphan value on a hidden
                  // field is harmless — and keeping it lets the user
                  // switch formats to compare without losing typing.
                  setForm({
                    ...form,
                    header_format: (val || 'none') as HeaderFormat,
                  })
                }
              >
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {HEADER_FORMATS.map((type) => (
                    <SelectItem
                      key={type}
                      value={type}
                      className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                    >
                      {HEADER_FORMAT_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {form.header_format === 'text' && (
                <div className="space-y-2 mt-2">
                  <Input
                    id="template-header-text"
                    aria-label="Texto do cabeçalho"
                    placeholder="Texto do cabeçalho (máx. 60 caracteres, {{1}} opcional)"
                    value={form.header_content}
                    onChange={(e) =>
                      setForm({ ...form, header_content: e.target.value })
                    }
                    maxLength={TEMPLATE_LIMITS.headerTextMaxLength}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  {headerVarCount > 0 && (
                    <Input
                      id="template-header-sample"
                      aria-label="Valor de exemplo para a variável do cabeçalho"
                      placeholder="Valor de exemplo para {{1}} (obrigatório para revisão da Meta)"
                      value={form.header_sample}
                      onChange={(e) =>
                        setForm({ ...form, header_sample: e.target.value })
                      }
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  )}
                </div>
              )}

              {headerNeedsMedia && (
                <div className="space-y-2 mt-2">
                  {form.header_format === 'image' && (
                    <div className="flex items-center gap-2">
                      <input
                        ref={headerFileRef}
                        type="file"
                        accept="image/jpeg,image/png"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleHeaderImageFile(f);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={uploadingHeader}
                        onClick={() => headerFileRef.current?.click()}
                      >
                        {uploadingHeader ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        Enviar imagem
                      </Button>
                      <span className="text-[11px] text-muted-foreground">
                        JPEG ou PNG, ≤5 MB
                      </span>
                    </div>
                  )}
                  <Input
                    placeholder={`https://… (ou cole um link público de ${form.header_format})`}
                    value={form.header_media_url}
                    onChange={(e) =>
                      setForm({ ...form, header_media_url: e.target.value })
                    }
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  {form.header_format === 'image' && form.header_media_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.header_media_url}
                      alt="Exemplo de cabeçalho"
                      className="max-h-28 rounded-md border border-border object-contain"
                    />
                  )}
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {form.header_format === 'image'
                      ? 'Envie um JPEG/PNG (≤5 MB, ≥800×418 px recomendado) ou cole um link HTTPS público — fazemos o upload para a Meta para revisão automaticamente.'
                      : 'Deve ser um link HTTPS publicamente acessível. A Meta o busca uma vez durante a revisão, então precisa ficar ativo por ~24 h.'}
                    {form.header_format === 'video' &&
                      ' Recomendado: MP4 / 3GPP, ≤16 MB, ≤60 segundos.'}
                    {form.header_format === 'document' &&
                      ' Recomendado: PDF, ≤100 MB.'}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Texto do Corpo</Label>
              <Textarea
                placeholder="Olá {{1}}, seu pedido {{2}} foi confirmado."
                value={form.body_text}
                onChange={(e) =>
                  setForm({ ...form, body_text: e.target.value })
                }
                rows={4}
                maxLength={TEMPLATE_LIMITS.bodyMaxLength}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground resize-none"
              />
              <p className="text-[11px] text-muted-foreground">
                Use {`{{1}}`}, {`{{2}}`} para variáveis (devem ser contíguas
                começando em {`{{1}}`}).
              </p>

              {bodyVarCount > 0 && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Valores de exemplo (a Meta os usa para revisar seu template)
                  </Label>
                  {form.body_samples.map((val, i) => {
                    const inputId = `template-body-sample-${i}`;
                    return (
                      <Input
                        key={i}
                        id={inputId}
                        aria-label={`Valor de exemplo para a variável do corpo {{${i + 1}}}`}
                        placeholder={`Exemplo para {{${i + 1}}}`}
                        value={val}
                        onChange={(e) => {
                          const next = [...form.body_samples];
                          next[i] = e.target.value;
                          setForm({ ...form, body_samples: next });
                        }}
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                      />
                    );
                  })}
                </div>
              )}

              {bodyVarCount > 0 && (
                <div className="space-y-2 pt-2 mt-2 border-t border-border">
                  <Label className="text-[11px] text-muted-foreground">
                    Variáveis — de onde vem cada valor no envio
                  </Label>
                  <p className="text-[11px] text-muted-foreground -mt-1">
                    Mapeie cada {`{{N}}`} a um campo do contato ou do card. Deixe
                    em &quot;Preencher na hora&quot; para digitar o valor a cada
                    envio.
                  </p>
                  {extractVariableIndices(form.body_text).map((idx) => {
                    const isStatic =
                      form.variable_mappings[String(idx)]?.source === 'static';
                    return (
                      <div key={idx} className="flex items-start gap-2">
                        <span className="text-xs text-muted-foreground font-mono mt-2 w-10 shrink-0">
                          {`{{${idx}}}`}
                        </span>
                        <div className="flex-1 space-y-1.5">
                          <Select
                            value={varSelectValue(idx)}
                            onValueChange={(val) => {
                              if (!val) return;
                              setVarSource(idx, val);
                            }}
                          >
                            <SelectTrigger className="w-full bg-muted border-border text-foreground h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border">
                              <SelectItem
                                value={VAR_SOURCE_NONE}
                                className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                              >
                                Preencher na hora
                              </SelectItem>
                              {CONTACT_FIELD_OPTIONS.map((opt) => (
                                <SelectItem
                                  key={`contact_field:${opt.value}`}
                                  value={encodeVarOption('contact_field', opt.value)}
                                  className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                                >
                                  {opt.label}
                                </SelectItem>
                              ))}
                              {DEAL_FIELD_OPTIONS.map((opt) => (
                                <SelectItem
                                  key={`deal_field:${opt.value}`}
                                  value={encodeVarOption('deal_field', opt.value)}
                                  className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                                >
                                  {opt.label}
                                </SelectItem>
                              ))}
                              {contactCustomFields.map((cf) => (
                                <SelectItem
                                  key={`contact_custom:${cf.id}`}
                                  value={encodeVarOption('contact_custom', cf.id)}
                                  className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                                >
                                  {`Contato: ${cf.field_name}`}
                                </SelectItem>
                              ))}
                              {dealCustomFields.map((df) => (
                                <SelectItem
                                  key={`deal_custom:${df.id}`}
                                  value={encodeVarOption('deal_custom', df.id)}
                                  className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                                >
                                  {`Card: ${df.field_name}`}
                                </SelectItem>
                              ))}
                              <SelectItem
                                value={VAR_SOURCE_STATIC}
                                className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                              >
                                Valor fixo
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          {isStatic && (
                            <Input
                              aria-label={`Valor fixo para a variável {{${idx}}}`}
                              placeholder={`Valor fixo para {{${idx}}}`}
                              value={form.variable_mappings[String(idx)]?.value ?? ''}
                              onChange={(e) => setVarStaticValue(idx, e.target.value)}
                              className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Rodapé (opcional)</Label>
              <Input
                placeholder="Texto de rodapé opcional (máx. 60 caracteres)"
                value={form.footer_text}
                onChange={(e) =>
                  setForm({ ...form, footer_text: e.target.value })
                }
                maxLength={TEMPLATE_LIMITS.footerMaxLength}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground">Botões (opcional)</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addButton}
                  disabled={form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal}
                  className="border-border bg-transparent text-muted-foreground hover:bg-muted h-7 text-xs"
                >
                  <Plus className="size-3" />
                  Adicionar Botão
                </Button>
              </div>
              {form.buttons.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Até {TEMPLATE_LIMITS.maxButtonsTotal} botões. Botões
                  QUICK_REPLY devem vir antes dos botões de URL / telefone /
                  copiar código.
                </p>
              ) : (
                <div className="space-y-2">
                  {form.buttons.map((btn, i) => (
                    <div
                      key={i}
                      className="space-y-2 rounded border border-border bg-muted/50 p-2"
                    >
                      <div className="flex items-center gap-2">
                        <Select
                          value={btn.type}
                          onValueChange={(val) => {
                            // Same null guard as the Header Select
                            // (per PR 148): @base-ui Select fires
                            // onValueChange(null) on deselect.
                            if (!val) return;
                            changeButtonType(i, val as TemplateButton['type']);
                          }}
                        >
                          <SelectTrigger className="w-40 bg-muted border-border text-foreground h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                            <SelectItem
                              value="QUICK_REPLY"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              Resposta Rápida
                            </SelectItem>
                            <SelectItem
                              value="URL"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              URL
                            </SelectItem>
                            <SelectItem
                              value="PHONE_NUMBER"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              Telefone
                            </SelectItem>
                            <SelectItem
                              value="COPY_CODE"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              Copiar Código
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          placeholder="Rótulo do botão"
                          value={btn.text}
                          maxLength={TEMPLATE_LIMITS.buttonTextMaxLength}
                          onChange={(e) =>
                            updateButton(i, { text: e.target.value })
                          }
                          className="flex-1 bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeButton(i)}
                          className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 size-7"
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                      {btn.type === 'URL' && (
                        <div className="space-y-1 pl-1">
                          <Input
                            placeholder="https://exemplo.com/caminho ou com sufixo {{1}}"
                            value={btn.url}
                            onChange={(e) =>
                              updateButton(i, { url: e.target.value })
                            }
                            className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                          />
                          {extractVariableIndices(btn.url).length > 0 && (
                            <Input
                              placeholder="Valor de exemplo para {{1}} (obrigatório quando a URL tem variável)"
                              value={btn.example ?? ''}
                              onChange={(e) =>
                                updateButton(i, { example: e.target.value })
                              }
                              className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                            />
                          )}
                        </div>
                      )}
                      {btn.type === 'PHONE_NUMBER' && (
                        <Input
                          placeholder="+15551234567"
                          value={btn.phone_number}
                          onChange={(e) =>
                            updateButton(i, { phone_number: e.target.value })
                          }
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                      )}
                      {btn.type === 'COPY_CODE' && (
                        <Input
                          placeholder="Código de exemplo (ex.: SUMMER20)"
                          value={btn.example}
                          onChange={(e) =>
                            updateButton(i, { example: e.target.value })
                          }
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || form.category === 'Authentication'}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {editingId ? 'Salvando…' : 'Enviando…'}
                </>
              ) : editingId ? (
                'Salvar e Reenviar'
              ) : (
                'Enviar para Aprovação'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm-delete dialog. Surfacing the meta_template_id case
          separately so users understand a real Meta delete is happening,
          not just a local cleanup. */}
      <Dialog
        open={templateToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setTemplateToDelete(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Excluir template?</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {templateToDelete?.meta_template_id
                ? `"${templateToDelete?.name}" será excluído da Meta e do ${APP_NAME}. Transmissões ativas que usam este template começarão a falhar no próximo envio. Isso não pode ser desfeito.`
                : `"${templateToDelete?.name}" será excluído do ${APP_NAME}. Ele nunca foi enviado à Meta, então nenhuma limpeza remota é necessária.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setTemplateToDelete(null)}
              disabled={deletingId !== null}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={deletingId !== null}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingId !== null ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Excluindo…
                </>
              ) : (
                'Excluir'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
