import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { hasSupabaseEnv, supabase } from "../lib/supabase";
import PortalLiveIndicator from "../components/PortalLiveIndicator";
import LibraryWorkspaceLayout from "../components/LibraryWorkspaceLayout";
import { useReservationNotifier } from "../hooks/useReservationNotifier";
import {
  RawAuthorRelation,
  formatAuthorLine,
  formatPublicationLabel,
  normalizeAuthors,
} from "../lib/bookMetadata";

type RawCategoryRelation = {
  category_id: string;
  categories:
    | { id: string; name: string }
    | { id: string; name: string }[]
    | null;
};

type Book = {
  id: string;
  isbn: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  language: string | null;
  publication_year: number | null;
  publication_date: string | null;
  cover_image_url: string | null;
  available_copies: number;
  total_copies: number;
  tags: string[] | null;
  book_authors: RawAuthorRelation[] | null;
  book_categories: RawCategoryRelation[] | null;
};

type BookmarkRow = {
  book_id: string;
  created_at: string;
  books: Book | Book[] | null;
};

type FavoriteBook = {
  bookmarkedAt: string;
  book: Book;
  categories: string[];
  authors: string[];
};

type FavoriteShelf = {
  name: string;
  items: FavoriteBook[];
};

type ActiveReservation = {
  book_id: string;
  status: "pending" | "ready_for_pickup";
};

type Notice = { type: "success" | "error"; text: string };
type LoadSource = "manual" | "live";

function formatLastSync(value: string | null) {
  if (!value) return "Waiting for first sync";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waiting for first sync";
  return `Last sync ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
}

// Date-only format for the compact card footer
function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getBookMonogram(title: string): string {
  const letters = title
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
  return letters || "BK";
}

function getToneClasses(seed: string) {
  const tones = [
    "from-emerald-800 via-emerald-700 to-teal-600",
    "from-slate-800 via-slate-700 to-emerald-700",
    "from-green-900 via-emerald-700 to-lime-600",
    "from-teal-800 via-cyan-700 to-emerald-600",
  ] as const;
  const hash = Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0);
  return tones[hash % tones.length];
}

function normalizeCategories(
  relations: RawCategoryRelation[] | null,
): string[] {
  if (!relations || relations.length === 0) return [];
  const values = new Set<string>();
  for (const relation of relations) {
    const categories = relation.categories;
    if (!categories) continue;
    if (Array.isArray(categories)) {
      for (const item of categories) {
        if (item.name) values.add(item.name);
      }
      continue;
    }
    if (categories.name) values.add(categories.name);
  }
  return Array.from(values).sort((l, r) => l.localeCompare(r));
}

function onCardKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onActivate: () => void,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate();
  }
}

function normalizeBookmarkRows(rows: BookmarkRow[]): FavoriteBook[] {
  return rows
    .map((row) => {
      const book = Array.isArray(row.books)
        ? (row.books[0] ?? null)
        : row.books;
      if (!book) return null;
      return {
        bookmarkedAt: row.created_at,
        book,
        categories: normalizeCategories(book.book_categories),
        authors: normalizeAuthors(book.book_authors),
      };
    })
    .filter((e): e is FavoriteBook => e !== null);
}

// REDESIGNED: clean two-section card — no overlay, dot-separated meta, structured footer
function FavoriteBookCard({
  activeAction,
  entry,
  isReserved,
  isSavingReserve,
  onOpenDetails,
  onReserve,
  onRemove,
}: {
  activeAction: string | null;
  entry: FavoriteBook;
  isReserved: boolean;
  isSavingReserve: boolean;
  onOpenDetails: () => void;
  onReserve: () => void;
  onRemove: () => void;
}) {
  const canReserve = entry.book.available_copies > 0 && !isReserved;
  const pubLabel = formatPublicationLabel(
    entry.book.publication_date,
    entry.book.publication_year,
  );
  const metaLine = [
    pubLabel !== "Unknown" ? pubLabel : null,
    entry.book.language,
    `${entry.book.available_copies}/${entry.book.total_copies} copies`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className="group flex flex-col rounded-[1.4rem] border border-slate-200 bg-white overflow-hidden shadow-[0_4px_16px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_12px_28px_rgba(15,23,42,0.10)] cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={onOpenDetails}
      onKeyDown={(e) => onCardKeyDown(e, onOpenDetails)}
    >
      {/* Body */}
      <div className="flex gap-3.5 p-4">
        {/* Cover — sharp, no darkening overlay */}
        <div
          className={`relative w-14 h-[84px] shrink-0 rounded-xl overflow-hidden bg-gradient-to-br ${getToneClasses(entry.book.id)} shadow-sm`}
        >
          {entry.book.cover_image_url ? (
            <img
              src={entry.book.cover_image_url}
              alt={`${entry.book.title} cover`}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold tracking-widest text-white/90">
              {getBookMonogram(entry.book.title)}
            </span>
          )}
        </div>

        {/* Text block */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 leading-tight line-clamp-2 flex-1">
              {entry.book.title}
            </h3>
            <span
              className={`shrink-0 mt-0.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                isReserved
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : entry.book.available_copies > 0
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {isReserved
                ? "Reserved"
                : entry.book.available_copies > 0
                  ? "Available"
                  : "Unavailable"}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-slate-600 line-clamp-1">
            By {formatAuthorLine(entry.authors)}
          </p>
          {/* Dot-separated metadata — replaces 4 vertical <p> tags */}
          <p className="mt-1 text-[11px] text-slate-400 line-clamp-1">
            {metaLine}
          </p>
        </div>
      </div>

      {/* Footer row — saved date + action buttons, no wrap */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-100 bg-slate-50/60">
        <span className="text-[11px] text-slate-400 shrink-0 min-w-0 truncate">
          Saved {formatDate(entry.bookmarkedAt)}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onKeyDown={(e) => e.stopPropagation()}
            disabled={activeAction === `remove-${entry.book.id}`}
          >
            {activeAction === `remove-${entry.book.id}`
              ? "Removing…"
              : "Remove"}
          </button>
          <button
            type="button"
            className="rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={(e) => {
              e.stopPropagation();
              onReserve();
            }}
            onKeyDown={(e) => e.stopPropagation()}
            disabled={!canReserve || isSavingReserve}
          >
            {isReserved
              ? "Reserved"
              : isSavingReserve
                ? "Saving…"
                : canReserve
                  ? "Reserve"
                  : "Unavailable"}
          </button>
        </div>
      </div>
    </article>
  );
}

export default function FavoritesPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [favorites, setFavorites] = useState<FavoriteBook[]>([]);
  const [reservedBookIds, setReservedBookIds] = useState<Set<string>>(
    new Set(),
  );
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [activeReserveBookId, setActiveReserveBookId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let isMounted = true;
    const bootstrap = async () => {
      if (!hasSupabaseEnv) {
        setIsBootstrapping(false);
        return;
      }
      const {
        data: { session: s },
      } = await supabase.auth.getSession();
      if (!isMounted) return;
      if (!s) {
        navigate("/", { replace: true });
        return;
      }
      setSession(s);
      setIsBootstrapping(false);
    };
    void bootstrap();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!next) {
        navigate("/", { replace: true });
        return;
      }
      setSession(next);
    });
    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  const loadFavorites = useCallback(
    async (source: LoadSource = "manual") => {
      if (!session?.user.id) return;
      if (source === "manual") {
        setIsFetching(true);
      } else {
        setIsLiveSyncing(true);
      }

      const [favResult, resResult] = await Promise.all([
        supabase
          .from("bookmarks")
          .select(
            "book_id,created_at,books(id,isbn,title,subtitle,description,publisher,language,publication_year,publication_date,cover_image_url,available_copies,total_copies,tags,book_authors(author_id,authors(id,name)),book_categories(category_id,categories(id,name)))",
          )
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("reservations")
          .select("book_id,status")
          .eq("user_id", session.user.id)
          .in("status", ["pending", "ready_for_pickup"]),
      ]);

      if (favResult.error) {
        setNotice({ type: "error", text: favResult.error.message });
      } else {
        setFavorites(
          normalizeBookmarkRows((favResult.data ?? []) as BookmarkRow[]),
        );
      }

      if (resResult.error) {
        setNotice({ type: "error", text: resResult.error.message });
      } else {
        setReservedBookIds(
          new Set(
            ((resResult.data ?? []) as ActiveReservation[]).map(
              (r) => r.book_id,
            ),
          ),
        );
      }

      if (!favResult.error && !resResult.error) setNotice(null);
      setLastSyncedAt(new Date().toISOString());
      if (source === "manual") {
        setIsFetching(false);
      } else {
        setIsLiveSyncing(false);
      }
    },
    [session?.user.id],
  );

  useEffect(() => {
    if (!session?.user.id) return;
    void loadFavorites("manual");
  }, [session?.user.id, loadFavorites]);

  useEffect(() => {
    if (!session?.user.id || !hasSupabaseEnv) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const queue = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        void loadFavorites("live");
      }, 300);
    };
    const ch = supabase
      .channel(`favorites-realtime-${session.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookmarks",
          filter: `user_id=eq.${session.user.id}`,
        },
        queue,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `user_id=eq.${session.user.id}`,
        },
        queue,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "books" },
        queue,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "book_categories" },
        queue,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "categories" },
        queue,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "book_authors" },
        queue,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "authors" },
        queue,
      )
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      void supabase.removeChannel(ch);
    };
  }, [session?.user.id, loadFavorites]);

  const favoriteShelves = useMemo<FavoriteShelf[]>(() => {
    const grouped = new Map<string, FavoriteBook[]>();
    for (const entry of favorites) {
      const names =
        entry.categories.length > 0 ? entry.categories : ["Uncategorized"];
      for (const name of names) {
        grouped.set(name, [...(grouped.get(name) ?? []), entry]);
      }
    }
    return Array.from(grouped.entries())
      .map(([name, items]) => ({
        name,
        items: [...items].sort((l, r) =>
          l.book.title.localeCompare(r.book.title),
        ),
      }))
      .sort(
        (l, r) =>
          r.items.length - l.items.length || l.name.localeCompare(r.name),
      );
  }, [favorites]);

  const reservedFavoritesCount = useMemo(
    () => favorites.filter((e) => reservedBookIds.has(e.book.id)).length,
    [favorites, reservedBookIds],
  );
  const readyToReserveCount = useMemo(
    () =>
      favorites.filter(
        (e) => e.book.available_copies > 0 && !reservedBookIds.has(e.book.id),
      ).length,
    [favorites, reservedBookIds],
  );

  const handleReserveBook = async (bookId: string) => {
    if (!session?.user.id) return;
    setActiveReserveBookId(bookId);
    setNotice(null);
    const { error } = await supabase
      .from("reservations")
      .insert({ user_id: session.user.id, book_id: bookId, status: "pending" });
    if (error) {
      setNotice({
        type: "error",
        text:
          error.code === "23505" || /duplicate/i.test(error.message)
            ? "You already have an active reservation for this book."
            : error.message,
      });
      setActiveReserveBookId(null);
      return;
    }
    setReservedBookIds((prev) => new Set([...prev, bookId]));
    setNotice({ type: "success", text: "Reservation created successfully." });
    setActiveReserveBookId(null);
  };

  const handleRemoveFavorite = async (bookId: string) => {
    if (!session?.user.id) return;
    setActiveAction(`remove-${bookId}`);
    setNotice(null);
    const { error } = await supabase
      .from("bookmarks")
      .delete()
      .eq("user_id", session.user.id)
      .eq("book_id", bookId);
    if (error) {
      setNotice({ type: "error", text: error.message });
      setActiveAction(null);
      return;
    }
    setNotice({ type: "success", text: "Book removed from favorites." });
    await loadFavorites("live");
    setActiveAction(null);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const userEmail = session?.user.email ?? "student@vsu.edu.ph";
  const notifier = useReservationNotifier(session?.user.id);

  if (!hasSupabaseEnv) {
    return (
      <main className="portal-page">
        <section className="portal-shell portal-single">
          <article className="portal-panel">
            <h1>Supabase not configured</h1>
          </article>
        </section>
      </main>
    );
  }
  if (isBootstrapping) {
    return (
      <main className="portal-page">
        <section className="portal-shell portal-single">
          <article className="portal-panel">
            <h1>Loading favorites…</h1>
          </article>
        </section>
      </main>
    );
  }

  return (
    <LibraryWorkspaceLayout
      activeRoute="favorites"
      activeMenuKey="favorite"
      title="Favorite Books"
      description="Your personal curated collection of resources and saved library titles."
      userEmail={userEmail}
      notifier={{
        notifications: notifier.notifications,
        unreadCount: notifier.unreadCount,
        isOpen: notifier.isOpen,
        onToggle: notifier.toggleOpen,
        onClose: notifier.close,
        onMarkRead: notifier.markAsRead,
        onMarkAllRead: notifier.markAllAsRead,
      }}
      sidebarStats={[
        { label: "Favorites", value: String(favorites.length) },
        { label: "Shelves", value: String(favoriteShelves.length) },
      ]}
      sidebarAction={{
        label: isFetching ? "Refreshing…" : "Refresh Data",
        onClick: () => {
          void loadFavorites("manual");
        },
        disabled: isFetching,
      }}
      headerActions={
        <div className="discover-inline-actions">
          <button
            type="button"
            className="btn btn-soft btn-small"
            onClick={() => navigate("/search")}
          >
            Open Discover
          </button>
          <button
            type="button"
            className="btn btn-soft btn-small"
            onClick={() => navigate("/reservations")}
          >
            Open Reservations
          </button>
        </div>
      }
      statusBar={
        <PortalLiveIndicator
          isSyncing={isLiveSyncing}
          text={`${isLiveSyncing ? "Syncing favorites…" : "Favorites synced"} | ${formatLastSync(lastSyncedAt)}`}
        />
      }
      notice={
        notice ? (
          <p className={`status ${notice.type} portal-notice`}>{notice.text}</p>
        ) : undefined
      }
      onNavigate={(route) => navigate(`/${route}`)}
      onSignOut={handleSignOut}
    >
      <div className="space-y-5">
        <section
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="Favorites overview"
        >
          {[
            {
              label: "Saved Books",
              value: favorites.length,
              desc: "Titles bookmarked for quicker return visits.",
            },
            {
              label: "Category Shelves",
              value: favoriteShelves.length,
              desc: "Grouped by catalog category for easy scanning.",
            },
            {
              label: "Ready To Reserve",
              value: readyToReserveCount,
              desc: "Available copies with no active reservation yet.",
            },
            {
              label: "Already Reserved",
              value: reservedFavoritesCount,
              desc: "Saved titles with an active reservation on your account.",
            },
          ].map((stat) => (
            <article
              key={stat.label}
              className="rounded-[1.35rem] border border-slate-200 bg-white/95 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)]"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {stat.label}
              </p>
              <strong className="mt-3 block text-3xl font-semibold tracking-tight text-slate-900">
                {stat.value}
              </strong>
              <p className="mt-2 text-sm text-slate-500">{stat.desc}</p>
            </article>
          ))}
        </section>

        <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                Favorite Shelves
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                Favorites grouped by category
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                Your personal curated collection of resources and saved library
                titles.
              </p>
            </div>
            <p className="text-sm font-medium text-slate-500">
              {favoriteShelves.length} active shelves
            </p>
          </div>

          {isFetching && favorites.length === 0 ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-[1.4rem] border border-slate-100 overflow-hidden"
                >
                  <div className="bg-slate-100 h-[108px]" />
                  <div className="bg-slate-50 h-10 border-t border-slate-100" />
                </div>
              ))}
            </div>
          ) : favoriteShelves.length === 0 ? (
            <div className="rounded-[1.6rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
              No favorite books yet. Save titles from Discover to build your
              shelves.
            </div>
          ) : (
            <div className="space-y-5">
              {favoriteShelves.map((shelf) => {
                const shelfReservedCount = shelf.items.filter((e) =>
                  reservedBookIds.has(e.book.id),
                ).length;
                return (
                  <article
                    key={shelf.name}
                    className="rounded-[1.5rem] bg-slate-50/70 p-4"
                  >
                    <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Catalog Category
                        </p>
                        <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
                          {shelf.name}
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {shelf.items.length} saved{" "}
                          {shelf.items.length === 1 ? "book" : "books"} in this
                          shelf.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-500">
                        <span className="rounded-full bg-white px-3 py-1.5">
                          {shelfReservedCount} reserved
                        </span>
                        <span className="rounded-full bg-white px-3 py-1.5">
                          {shelf.items.length - shelfReservedCount} unreserved
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {shelf.items.map((entry) => (
                        <FavoriteBookCard
                          key={`${shelf.name}-${entry.book.id}`}
                          activeAction={activeAction}
                          entry={entry}
                          isReserved={reservedBookIds.has(entry.book.id)}
                          isSavingReserve={
                            activeReserveBookId === entry.book.id
                          }
                          onOpenDetails={() =>
                            navigate(`/books/${entry.book.id}`)
                          }
                          onReserve={() => {
                            void handleReserveBook(entry.book.id);
                          }}
                          onRemove={() => {
                            void handleRemoveFavorite(entry.book.id);
                          }}
                        />
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </LibraryWorkspaceLayout>
  );
}
