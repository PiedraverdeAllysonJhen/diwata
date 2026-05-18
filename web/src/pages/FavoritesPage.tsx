import { KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
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
  normalizeAuthors
} from "../lib/bookMetadata";

type RawCategoryRelation = {
  category_id: string;
  categories: { id: string; name: string } | { id: string; name: string }[] | null;
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

type Notice = {
  type: "success" | "error";
  text: string;
};

type LoadSource = "manual" | "live";

function formatLastSync(value: string | null) {
  if (!value) return "Waiting for first sync";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waiting for first sync";

  return `Last sync ${date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  })}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getBookMonogram(title: string): string {
  const letters = title
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return letters || "BK";
}

function getToneClasses(seed: string) {
  const tones = [
    "from-emerald-800 via-emerald-700 to-teal-600",
    "from-slate-800 via-slate-700 to-emerald-700",
    "from-green-900 via-emerald-700 to-lime-600",
    "from-teal-800 via-cyan-700 to-emerald-600"
  ] as const;

  const hash = Array.from(seed).reduce((accumulator, character) => accumulator + character.charCodeAt(0), 0);
  return tones[hash % tones.length];
}

function normalizeCategories(relations: RawCategoryRelation[] | null): string[] {
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

  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function onCardKeyDown(event: KeyboardEvent<HTMLElement>, onActivate: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate();
  }
}

function normalizeBookmarkRows(rows: BookmarkRow[]): FavoriteBook[] {
  return rows
    .map((row) => {
      const book = Array.isArray(row.books) ? row.books[0] ?? null : row.books;
      if (!book) return null;

      return {
        bookmarkedAt: row.created_at,
        book,
        categories: normalizeCategories(book.book_categories),
        authors: normalizeAuthors(book.book_authors)
      };
    })
    .filter((entry): entry is FavoriteBook => entry !== null);
}

function FavoriteBookCard({
  activeAction,
  entry,
  isReserved,
  onOpenDetails,
  onOpenReservations,
  onRemove
}: {
  activeAction: string | null;
  entry: FavoriteBook;
  isReserved: boolean;
  onOpenDetails: () => void;
  onOpenReservations: () => void;
  onRemove: () => void;
}) {
  const canReserve = entry.book.available_copies > 0 && !isReserved;

  return (
    <article
      className="group flex h-full cursor-pointer flex-col gap-4 rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_20px_44px_rgba(15,23,42,0.09)]"
      role="button"
      tabIndex={0}
      onClick={onOpenDetails}
      onKeyDown={(event) => onCardKeyDown(event, onOpenDetails)}
    >
      <div className="flex items-start gap-4">
        <div
          className={`relative flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br ${getToneClasses(
            entry.book.id
          )} text-sm font-semibold tracking-[0.2em] text-white shadow-sm ring-1 ring-slate-200/80`}
        >
          {entry.book.cover_image_url ? (
            <>
              <img
                src={entry.book.cover_image_url}
                alt={`${entry.book.title} cover`}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-slate-950/5 via-slate-950/15 to-slate-950/35" />
            </>
          ) : (
            <span className="relative z-10">{getBookMonogram(entry.book.title)}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-sm font-semibold tracking-tight text-slate-900">{entry.book.title}</h3>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                {entry.book.subtitle ?? entry.book.publisher ?? "Saved catalog title"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                Saved
              </span>
              <span
                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                  isReserved
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : entry.book.available_copies > 0
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {isReserved ? "Reserved" : entry.book.available_copies > 0 ? "Available" : "Unavailable"}
              </span>
            </div>
          </div>

          <div className="mt-3 space-y-1.5 text-xs text-slate-500">
            <p className="line-clamp-2 text-slate-600">By {formatAuthorLine(entry.authors)}</p>
            <p>{formatPublicationLabel(entry.book.publication_date, entry.book.publication_year)}</p>
            <p>{entry.book.language ?? "Language not set"}</p>
            <p>{entry.book.available_copies} available of {entry.book.total_copies}</p>
            <p>Saved on {formatDate(entry.bookmarkedAt)}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-emerald-200 hover:text-emerald-700"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          onKeyDown={(event) => event.stopPropagation()}
          disabled={activeAction === `remove-${entry.book.id}`}
        >
          {activeAction === `remove-${entry.book.id}` ? "Removing..." : "Remove"}
        </button>
        <button
          type="button"
          className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-55"
          onClick={(event) => {
            event.stopPropagation();
            onOpenReservations();
          }}
          onKeyDown={(event) => event.stopPropagation()}
          disabled={!canReserve}
        >
          {isReserved ? "Reserved" : canReserve ? "Reserve" : "Unavailable"}
        </button>
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
  const [reservedBookIds, setReservedBookIds] = useState<Set<string>>(new Set());
  const [activeAction, setActiveAction] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      if (!hasSupabaseEnv) {
        setIsBootstrapping(false);
        return;
      }

      const {
        data: { session: currentSession }
      } = await supabase.auth.getSession();

      if (!isMounted) return;

      if (!currentSession) {
        navigate("/", { replace: true });
        return;
      }

      setSession(currentSession);
      setIsBootstrapping(false);
    };

    void bootstrap();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) {
        navigate("/", { replace: true });
        return;
      }
      setSession(nextSession);
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

      const [favoritesResult, reservationsResult] = await Promise.all([
        supabase
          .from("bookmarks")
          .select(
            "book_id,created_at,books(id,isbn,title,subtitle,description,publisher,language,publication_year,publication_date,cover_image_url,available_copies,total_copies,tags,book_authors(author_id,authors(id,name)),book_categories(category_id,categories(id,name)))"
          )
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("reservations")
          .select("book_id,status")
          .eq("user_id", session.user.id)
          .in("status", ["pending", "ready_for_pickup"])
      ]);

      if (favoritesResult.error) {
        setNotice({ type: "error", text: favoritesResult.error.message });
      } else {
        setFavorites(normalizeBookmarkRows((favoritesResult.data ?? []) as BookmarkRow[]));
      }

      if (reservationsResult.error) {
        setNotice({ type: "error", text: reservationsResult.error.message });
      } else {
        const activeReservations = (reservationsResult.data ?? []) as ActiveReservation[];
        setReservedBookIds(new Set(activeReservations.map((reservation) => reservation.book_id)));
      }

      if (!favoritesResult.error && !reservationsResult.error) {
        setNotice(null);
      }

      setLastSyncedAt(new Date().toISOString());

      if (source === "manual") {
        setIsFetching(false);
      } else {
        setIsLiveSyncing(false);
      }
    },
    [session?.user.id]
  );

  useEffect(() => {
    if (!session?.user.id) return;
    void loadFavorites("manual");
  }, [session?.user.id, loadFavorites]);

  useEffect(() => {
    if (!session?.user.id || !hasSupabaseEnv) return;

    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const queueLiveRefresh = () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }

      refreshTimeout = window.setTimeout(() => {
        void loadFavorites("live");
      }, 300);
    };

    const channel = supabase
      .channel(`favorites-realtime-${session.user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookmarks", filter: `user_id=eq.${session.user.id}` },
        queueLiveRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservations", filter: `user_id=eq.${session.user.id}` },
        queueLiveRefresh
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "books" }, queueLiveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_categories" }, queueLiveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, queueLiveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_authors" }, queueLiveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "authors" }, queueLiveRefresh)
      .subscribe();

    return () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id, loadFavorites]);

  const favoriteShelves = useMemo<FavoriteShelf[]>(() => {
    const groupedFavorites = new Map<string, FavoriteBook[]>();

    for (const entry of favorites) {
      const categoryNames = entry.categories.length > 0 ? entry.categories : ["Uncategorized"];

      for (const categoryName of categoryNames) {
        const existingItems = groupedFavorites.get(categoryName) ?? [];
        groupedFavorites.set(categoryName, [...existingItems, entry]);
      }
    }

    return Array.from(groupedFavorites.entries())
      .map(([name, items]) => ({
        name,
        items: [...items].sort((left, right) => left.book.title.localeCompare(right.book.title))
      }))
      .sort((left, right) => right.items.length - left.items.length || left.name.localeCompare(right.name));
  }, [favorites]);

  const reservedFavoritesCount = useMemo(
    () => favorites.filter((entry) => reservedBookIds.has(entry.book.id)).length,
    [favorites, reservedBookIds]
  );

  const readyToReserveCount = useMemo(
    () => favorites.filter((entry) => entry.book.available_copies > 0 && !reservedBookIds.has(entry.book.id)).length,
    [favorites, reservedBookIds]
  );

  const handleRemoveFavorite = async (bookId: string) => {
    if (!session?.user.id) return;

    setActiveAction(`remove-${bookId}`);
    setNotice(null);

    const { error } = await supabase.from("bookmarks").delete().eq("user_id", session.user.id).eq("book_id", bookId);

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
            <p>Add your values in `web/.env` before using favorites.</p>
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
            <h1>Loading favorites...</h1>
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
      description="Saved titles are now grouped by category shelves so the page feels curated instead of crowded."
      userEmail={userEmail}
      notifier={{
        notifications: notifier.notifications,
        unreadCount: notifier.unreadCount,
        isOpen: notifier.isOpen,
        onToggle: notifier.toggleOpen,
        onClose: notifier.close,
        onMarkRead: notifier.markAsRead,
        onMarkAllRead: notifier.markAllAsRead
      }}
      sidebarStats={[
        { label: "Favorites", value: String(favorites.length) },
        { label: "Shelves", value: String(favoriteShelves.length) }
      ]}
      sidebarAction={{
        label: isFetching ? "Refreshing..." : "Refresh Data",
        onClick: () => {
          void loadFavorites("manual");
        },
        disabled: isFetching
      }}
      headerActions={
        <div className="discover-inline-actions">
          <button type="button" className="btn btn-soft btn-small" onClick={() => navigate("/search")}>
            Open Discover
          </button>
          <button type="button" className="btn btn-soft btn-small" onClick={() => navigate("/reservations")}>
            Open Reservations
          </button>
        </div>
      }
      statusBar={
        <PortalLiveIndicator
          isSyncing={isLiveSyncing}
          text={`${isLiveSyncing ? "Syncing favorites..." : "Favorites synced"} | ${formatLastSync(lastSyncedAt)}`}
        />
      }
      notice={notice ? <p className={`status ${notice.type} portal-notice`}>{notice.text}</p> : undefined}
      onNavigate={(route) => navigate(`/${route}`)}
      onSignOut={handleSignOut}
    >
      <div className="space-y-5">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Favorites overview">
          <article className="rounded-[1.35rem] border border-slate-200 bg-white/95 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Saved Books</p>
            <strong className="mt-3 block text-3xl font-semibold tracking-tight text-slate-900">{favorites.length}</strong>
            <p className="mt-2 text-sm text-slate-500">Titles you have bookmarked for quicker return visits.</p>
          </article>
          <article className="rounded-[1.35rem] border border-slate-200 bg-white/95 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Category Shelves</p>
            <strong className="mt-3 block text-3xl font-semibold tracking-tight text-slate-900">{favoriteShelves.length}</strong>
            <p className="mt-2 text-sm text-slate-500">Grouped by catalog category to keep saved books easy to scan.</p>
          </article>
          <article className="rounded-[1.35rem] border border-slate-200 bg-white/95 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Ready To Reserve</p>
            <strong className="mt-3 block text-3xl font-semibold tracking-tight text-slate-900">{readyToReserveCount}</strong>
            <p className="mt-2 text-sm text-slate-500">Favorites with an available copy and no active reservation yet.</p>
          </article>
          <article className="rounded-[1.35rem] border border-slate-200 bg-white/95 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Already Reserved</p>
            <strong className="mt-3 block text-3xl font-semibold tracking-tight text-slate-900">{reservedFavoritesCount}</strong>
            <p className="mt-2 text-sm text-slate-500">Saved titles that already have an active reservation on your account.</p>
          </article>
        </section>

        <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">Favorite Shelves</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">Favorites grouped by category</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                Suggestions and duplicate search controls are removed here so the page stays focused on the books you already saved.
              </p>
            </div>
            <p className="text-sm font-medium text-slate-500">{favoriteShelves.length} active shelves</p>
          </div>

          {favoriteShelves.length === 0 ? (
            <div className="rounded-[1.6rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
              No favorite books yet. Save titles from Discover to build your shelves.
            </div>
          ) : (
            <div className="space-y-5">
              {favoriteShelves.map((shelf) => {
                const shelfReservedCount = shelf.items.filter((entry) => reservedBookIds.has(entry.book.id)).length;

                return (
                  <article
                    key={shelf.name}
                    className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4"
                  >
                    <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Catalog Category</p>
                        <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">{shelf.name}</h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {shelf.items.length} saved {shelf.items.length === 1 ? "book" : "books"} in this shelf.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-500">
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
                          {shelfReservedCount} reserved
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
                          {shelf.items.length - shelfReservedCount} available to review
                        </span>
                      </div>
                    </div>

                    {shelf.items.length === 0 ? (
                      <div className="rounded-[1.2rem] border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                        No favorite books in this category yet.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        {shelf.items.map((entry) => (
                          <FavoriteBookCard
                            key={`${shelf.name}-${entry.book.id}`}
                            activeAction={activeAction}
                            entry={entry}
                            isReserved={reservedBookIds.has(entry.book.id)}
                            onOpenDetails={() => navigate(`/books/${entry.book.id}`)}
                            onOpenReservations={() => navigate("/reservations")}
                            onRemove={() => {
                              void handleRemoveFavorite(entry.book.id);
                            }}
                          />
                        ))}
                      </div>
                    )}
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
