'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Zap, Pencil, Trash2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { QuickReply } from '@/types';

/**
 * Mensagens rápidas — respostas prontas de texto livre, compartilhadas
 * pela conta, usadas no chat via "/". Diferente de Templates (Meta).
 * CRUD inline; escopo por account_id (toda a equipe vê e usa).
 */
export function QuickRepliesPanel() {
  const supabase = createClient();
  const { user, accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<QuickReply[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!accountId) {
      setLoading(false);
      return;
    }
    fetchItems(accountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, accountId]);

  async function fetchItems(acc: string) {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('quick_replies')
        .select('*')
        .eq('account_id', acc)
        .order('title', { ascending: true });
      if (error) throw error;
      setItems(data || []);
    } catch (err) {
      console.error('Failed to fetch quick replies:', err);
      toast.error('Falha ao carregar as mensagens rápidas');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setEditingId(null);
    setTitle('');
    setBody('');
  }

  function startEdit(qr: QuickReply) {
    setEditingId(qr.id);
    setTitle(qr.title);
    setBody(qr.body);
  }

  async function handleSave() {
    if (!title.trim() || !body.trim()) {
      toast.error('Título e mensagem são obrigatórios');
      return;
    }
    if (!user || !accountId) {
      toast.error('Não autenticado');
      return;
    }
    try {
      setSaving(true);
      if (editingId) {
        const { error } = await supabase
          .from('quick_replies')
          .update({ title: title.trim(), body: body.trim(), updated_at: new Date().toISOString() })
          .eq('id', editingId);
        if (error) throw error;
        toast.success('Mensagem rápida atualizada');
      } else {
        const { error } = await supabase.from('quick_replies').insert({
          account_id: accountId,
          created_by: user.id,
          title: title.trim(),
          body: body.trim(),
        });
        if (error) throw error;
        toast.success('Mensagem rápida criada');
      }
      resetForm();
      await fetchItems(accountId);
    } catch (err) {
      console.error('Save quick reply error:', err);
      toast.error('Falha ao salvar a mensagem rápida');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase.from('quick_replies').delete().eq('id', id);
      if (error) throw error;
      toast.success('Mensagem rápida excluída');
      setItems((prev) => prev.filter((q) => q.id !== id));
      if (editingId === id) resetForm();
    } catch (err) {
      console.error('Delete quick reply error:', err);
      toast.error('Falha ao excluir a mensagem rápida');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Zap className="size-4 text-primary" />
          Mensagens rápidas
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Respostas prontas compartilhadas pela equipe. No chat, digite{' '}
          <span className="font-mono text-foreground">/</span> para inserir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {items.length > 0 ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {items.map((qr) => (
                  <li key={qr.id} className="flex items-start gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {qr.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                        {qr.body}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${qr.title}`}
                        onClick={() => startEdit(qr)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Excluir ${qr.title}`}
                        onClick={() => handleDelete(qr.id)}
                      >
                        <Trash2 className="size-3.5 text-red-400" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma mensagem rápida ainda — crie a primeira abaixo.
              </p>
            )}

            {/* Inline create/edit */}
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {editingId ? 'Editar mensagem rápida' : 'Nova mensagem rápida'}
                </p>
                {editingId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                    Cancelar edição
                  </button>
                )}
              </div>
              <Input
                placeholder="Título (ex.: Dados do PIX)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={saving}
                maxLength={60}
              />
              <Textarea
                placeholder="Mensagem (ex.: Nossa chave PIX é ...)"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={saving}
                className="min-h-[80px]"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleSave}
                disabled={saving || !title.trim() || !body.trim()}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {editingId ? 'Salvar' : 'Adicionar'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
