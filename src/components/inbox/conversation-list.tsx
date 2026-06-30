"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus } from "@/types";
import { Search, ChevronDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};

const STATUS_LABELS: Record<ConversationStatus, string> = {
  open: "Aberta",
  pending: "Pendente",
  closed: "Fechada",
};

type InboxFilter = ConversationStatus | "all" | "unread";

type TagLite = { id: string; name: string; color: string };

/** Extrai as tags do contato vindas do join contact_tags(tag:tags(...)).
 *  O tipo Conversation.contact não declara o join, então lemos de forma
 *  defensiva sem alargar o tipo global. */
function tagsOf(conv: Conversation): TagLite[] {
  const ct = (conv.contact as unknown as
    | { contact_tags?: { tag: TagLite | null }[] }
    | null
    | undefined)?.contact_tags;
  return (ct ?? []).map((r) => r.tag).filter((t): t is TagLite => !!t);
}

const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = [
  { label: "Todas", value: "all" },
  { label: "Não lidas", value: "unread" },
  { label: "Abertas", value: "open" },
  { label: "Pendentes", value: "pending" },
  { label: "Fechadas", value: "closed" },
];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, contact:contacts(*, contact_tags(tag:tags(id,name,color)))")
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  // Tags presentes nas conversas carregadas — popula o filtro sem fetch extra.
  const allTags = useMemo(() => {
    const map = new Map<string, TagLite>();
    conversations.forEach((c) => tagsOf(c).forEach((t) => map.set(t.id, t)));
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [conversations]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    if (tagFilter) {
      result = result.filter((c) => tagsOf(c).some((t) => t.id === tagFilter));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [conversations, filter, tagFilter, search]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Buscar conversas..."
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                {activeFilter?.label ?? "Todas"}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
              {tagFilter && allTags.find((t) => t.id === tagFilter) ? (
                <>
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: allTags.find((t) => t.id === tagFilter)!.color }}
                  />
                  {allTags.find((t) => t.id === tagFilter)!.name}
                </>
              ) : (
                "Tags"
              )}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto border-border bg-popover">
              <DropdownMenuItem
                onClick={() => setTagFilter("")}
                className={cn("text-sm", !tagFilter ? "text-primary" : "text-popover-foreground")}
              >
                Todas as tags
              </DropdownMenuItem>
              {allTags.length === 0 && (
                <DropdownMenuItem disabled className="text-sm text-muted-foreground">
                  Nenhuma tag nas conversas
                </DropdownMenuItem>
              )}
              {allTags.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  onClick={() => setTagFilter(t.id)}
                  className={cn("text-sm", tagFilter === t.id ? "text-primary" : "text-popover-foreground")}
                >
                  <span className="mr-2 size-2 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma conversa encontrada</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || "Desconhecido";
  const initials = displayName.charAt(0).toUpperCase();
  const tags = tagsOf(conversation);

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
        locale: ptBR,
      })
    : "";

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
        isActive && "border-l-2 border-primary bg-muted/70"
      )}
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {displayName}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.last_message_text || "Nenhuma mensagem ainda"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={STATUS_LABELS[conversation.status]}
            />
          </div>
        </div>

        {/* Tags do contato — replica a triagem visual do WhatsApp na lista. */}
        {tags.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {tags.slice(0, 3).map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                style={{ backgroundColor: `${t.color}20`, color: t.color }}
                title={t.name}
              >
                <span className="size-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                {t.name}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-[9px] text-muted-foreground">+{tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
