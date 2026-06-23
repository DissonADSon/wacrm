'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { DealCustomField } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Trash2 } from 'lucide-react';

interface DealCustomFieldsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog wrapper em volta de {@link DealCustomFieldsPanel}, usado nas
 * configurações do pipeline. O mesmo painel pode ser renderizado inline.
 * O Radix desmonta o conteúdo do dialog ao fechar, então o painel remonta
 * (e recarrega) a cada abertura.
 */
export function DealCustomFieldsManager({
  open,
  onOpenChange,
}: DealCustomFieldsManagerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            Campos personalizados do card
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Defina campos extras da oportunidade (ex.: código de rastreamento,
            nº do pedido, transportadora). Eles aparecem em todos os cards do
            pipeline.
          </DialogDescription>
        </DialogHeader>
        <DealCustomFieldsPanel />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Criar / renomear / excluir definições de campos personalizados de
 * oportunidade (por conta). Os valores por card são editados em outro lugar
 * (detalhe do card → Campos personalizados); aqui só se gerencia o catálogo
 * de campos. Admin+ é controlado pelo chamador — a RLS de `deal_custom_fields`
 * também rejeita escrita de não-admin como defesa em profundidade.
 */
export function DealCustomFieldsPanel() {
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [fields, setFields] = useState<DealCustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchFields = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from('deal_custom_fields')
      .select('*')
      .order('field_name');
    setFields((data as DealCustomField[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId]);

  // Carrega a lista de campos na montagem assim que a conta é conhecida. Os
  // setters dentro de fetchFields rodam depois do await do Supabase — não
  // de forma síncrona no corpo do efeito — então o aviso do lint não se aplica.
  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchFields();
    }
  }, [accountId, fetchFields]);

  /** Conflito de nome (case-insensitive) dentro da lista carregada. */
  function isDuplicate(name: string, exceptId?: string): boolean {
    const lower = name.toLowerCase();
    return fields.some(
      (f) => f.id !== exceptId && f.field_name.toLowerCase() === lower
    );
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    if (!accountId || !user) {
      toast.error('Seu perfil não está vinculado a uma conta.');
      return;
    }
    if (isDuplicate(name)) {
      toast.error(`Já existe um campo chamado "${name}".`);
      return;
    }

    setCreating(true);
    const { error } = await supabase.from('deal_custom_fields').insert({
      field_name: name,
      field_type: 'text',
      account_id: accountId,
    });
    setCreating(false);

    if (error) {
      toast.error('Não foi possível criar o campo. Você pode não ter permissão.');
      return;
    }
    toast.success(`"${name}" criado.`);
    setNewName('');
    await fetchFields();
  }

  /** Retorna true em sucesso para a linha manter o novo nome, false para
   *  reverter ao anterior. No-ops (vazio / sem mudança) contam como sucesso. */
  async function handleRename(
    field: DealCustomField,
    nextName: string
  ): Promise<boolean> {
    const name = nextName.trim();
    if (!name || name === field.field_name) return true;
    if (isDuplicate(name, field.id)) {
      toast.error(`Já existe um campo chamado "${name}".`);
      return false;
    }
    setBusyId(field.id);
    const { error } = await supabase
      .from('deal_custom_fields')
      .update({ field_name: name })
      .eq('id', field.id);
    setBusyId(null);
    if (error) {
      toast.error('Não foi possível renomear o campo.');
      return false;
    }
    await fetchFields();
    return true;
  }

  async function handleDelete(field: DealCustomField) {
    if (
      !window.confirm(
        `Excluir "${field.field_name}"? Isso também remove o valor armazenado em todos os cards. Esta ação não pode ser desfeita.`
      )
    ) {
      return;
    }
    setBusyId(field.id);
    const { error } = await supabase
      .from('deal_custom_fields')
      .delete()
      .eq('id', field.id);
    setBusyId(null);
    if (error) {
      toast.error('Não foi possível excluir o campo.');
      return;
    }
    toast.success(`"${field.field_name}" excluído.`);
    await fetchFields();
  }

  return (
    <div className="space-y-4">
      {/* Criar */}
      <div className="flex items-center gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleCreate();
            }
          }}
          placeholder="Nome do novo campo…"
          className="bg-muted text-foreground"
        />
        <Button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
        >
          {creating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Adicionar
        </Button>
      </div>

      {/* Lista */}
      <div className="max-h-72 overflow-y-auto rounded-md border border-border">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Carregando…
          </div>
        ) : fields.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum campo personalizado ainda.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {fields.map((field) => (
              <FieldRow
                key={field.id}
                field={field}
                busy={busyId === field.id}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Uma única linha editável. Estado local controlado permite commitar no
 *  blur / Enter e reverter limpo ao último nome salvo quando a renomeação falha. */
function FieldRow({
  field,
  busy,
  onRename,
  onDelete,
}: {
  field: DealCustomField;
  busy: boolean;
  onRename: (field: DealCustomField, name: string) => Promise<boolean>;
  onDelete: (field: DealCustomField) => void;
}) {
  const [name, setName] = useState(field.field_name);

  async function commit() {
    if (name.trim() === field.field_name) {
      setName(field.field_name); // normaliza edição só com espaços
      return;
    }
    const ok = await onRename(field, name);
    if (!ok) setName(field.field_name);
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <Input
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        aria-label={`Renomear ${field.field_name}`}
        className="focus:border-primary h-8 border-transparent bg-transparent text-foreground hover:border-border"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onClick={() => onDelete(field)}
        title="Excluir campo"
        className="shrink-0 text-muted-foreground hover:text-red-400"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
      </Button>
    </li>
  );
}
