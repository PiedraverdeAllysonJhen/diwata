import { useCallback, useEffect, useMemo, useState } from "react";
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
};

type BookmarkRow = {
  book_id: string;
  created_at: string;
  books: Book | Book[] | null;
};

type FavoriteBook = {
  bookmarkedAt: string;
  book: Book;
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

function getToneClass(seed: string): string {
  const hash = Array.from(seed).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return `tone-${(hash % 5) + 1}`;
}

function normalizeBookmarkRows(rows: BookmarkRow[]): FavoriteBook[] {
  return rows
    .map((row) => {
      const book = Array.isArray(row.books) ? row.books[0] : row.books;
      if (!book) return null;
      return {
        bookmarkedAt: row.created_at,
        book
      };
    })
    .filter((entry): entry is FavoriteBook => entry !== null);
}

export default function FavoritesPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [favorites, setFavorites] = useState<FavoriteBook[]>([]);
  const [catalogBooks, setCatalogBooks] = useState<Book[]>([]);
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

      const [favoritesResult, catalogResult] = await Promise.all([
        supabase
          .from("bookmarks")
          .select(
            "book_id,created_at,books(id,isbn,title,subtitle,description,publisher,language,publication_year,publication_date,cover_image_url,available_copies,total_copies,tags,book_authors(author_id,authors(id,name)))"
          )
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("books")
          .select(
            "id,isbn,title,subtitle,description,publisher,language,publication_year,publication_date,cover_image_url,available_copies,total_copies,tags,book_authors(author_id,authors(id,name))"
          )
          .order("title", { ascending: true })
          .limit(240)
      ]);

      if (favoritesResult.error) {
        setNotice({ type: "error", text: favoritesResult.error.message });
      } else {
        setFavorites(normalizeBookmarkRows((favoritesResult.data ?? []) as BookmarkRow[]));
      }

      if (catalogResult.error) {
        setNotice({ type: "error", text: catalogResult.error.message });
      } else {
        setCatalogBooks((catalogResult.data ?? []) as Book[]);
      }

      if (!favoritesResult.error && !catalogResult.error) {
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
      .on("postgres_changes", { event: "*", schema: "public", table: "books" }, queueLiveRefresh)
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

  const favoriteBookIds = useMemo(() => new Set(favorites.map((entry) => entry.book.id)), [favorites]);

  const catalogSuggestions = useMemo(() => {
    const keyword = searchInput.trim().toLowerCase();

    return catalogBooks
      .filter((book) => !favoriteBookIds.has(book.id))
      .filter((book) => {
        if (!keyword) return true;
        const values = [
          book.title,
          book.subtitle ?? "",
          book.language ?? "",
          book.publication_year ? String(book.publication_year) : "",
          book.publication_date ?? "",
          book.isbn ?? "",
          book.publisher ?? "",
          normalizeAuthors(book.book_authors).join(" "),
          (book.tags ?? []).join(" ")
        ];

        return values.some((value) => value.toLowerCase().includes(keyword));
      })
      .slice(0, 12);
  }, [catalogBooks, favoriteBookIds, searchInput]);

  const handleAddFavorite = async (bookId: string) => {
    if (!session?.user.id) return;

    setActiveAction(`add-${bookId}`);
    setNotice(null);

    const { error } = await supabase.from("bookmarks").insert({
      user_id: session.user.id,
      book_id: bookId
    });

    if (error) {
      setNotice({ type: "error", text: error.message });
      setActiveAction(null);
      return;
    }

    setNotice({ type: "success", text: "Book added to favorites." });
    await loadFavorites("live");
    setActiveAction(null);
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
      description="Save titles you want to revisit and reserve them faster later."
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
        { label: "Suggestions", value: String(catalogSuggestions.length) }
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
      <section className="discover-section" aria-label="Saved favorites">
        <header className="discover-section-head">
          <h2>Saved Favorites</h2>
          <p className="discover-inline-meta">{favorites.length} saved books</p>
        </header>

        {favorites.length === 0 ? (
          <p className="empty-state">No favorite books yet. Add titles from suggestions below.</p>
        ) : (
          <div className="discover-results-grid">
            {favorites.map((entry) => {
              const authors = normalizeAuthors(entry.book.book_authors);
              return (
                <article key={entry.book.id} className="discover-result-card">
                  <div
                    className={`discover-result-cover ${getToneClass(entry.book.id)} ${entry.book.cover_image_url ? "has-image" : ""}`.trim()}
                    style={
                      entry.book.cover_image_url
                        ? {
                            backgroundImage: `linear-gradient(165deg, rgba(7, 66, 52, 0.42), rgba(7, 66, 52, 0.08)), url(${entry.book.cover_image_url})`
                          }
                        : undefined
                    }
                  >
                    {!entry.book.cover_image_url ? <span>{getBookMonogram(entry.book.title)}</span> : null}
                  </div>

                  <div className="discover-result-content">
                    <div className="discover-result-head">
                      <h3>{entry.book.title}</h3>
                      <span className="availability-pill available">Saved</span>
                    </div>

                    <div className="discover-book-meta-grid">
                      <p className="discover-result-meta"><strong>Author:</strong> {formatAuthorLine(authors)}</p>
                      <p className="discover-result-meta"><strong>Publish date:</strong> {formatPublicationLabel(entry.book.publication_date, entry.book.publication_year)}</p>
                      <p className="discover-result-meta"><strong>ISBN:</strong> {entry.book.isbn ?? "N/A"}</p>
                      <p className="discover-result-meta"><strong>Publisher:</strong> {entry.book.publisher ?? "N/A"}</p>
                      <p className="discover-result-meta"><strong>Language:</strong> {entry.book.language ?? "N/A"}</p>
                      <p className="discover-result-meta"><strong>Copies:</strong> {entry.book.available_copies} available / {entry.book.total_copies} total</p>
                      <p className="discover-result-meta"><strong>Subtitle:</strong> {entry.book.subtitle ?? "N/A"}</p>
                      <p className="discover-result-meta"><strong>Tags:</strong> {(entry.book.tags ?? []).length > 0 ? (entry.book.tags ?? []).join(", ") : "None"}</p>
                    </div>

                    <p className="discover-result-description">
                      <strong>Description:</strong> {entry.book.description ?? "No description provided."}
                    </p>

                    <p className="discover-result-meta">Saved on {formatDate(entry.bookmarkedAt)}</p>

                    <div className="discover-result-actions">
                      <button
                        type="button"
                        className="btn btn-soft btn-small"
                        onClick={() => {
                          void handleRemoveFavorite(entry.book.id);
                        }}
                        disabled={activeAction === `remove-${entry.book.id}`}
                      >
                        {activeAction === `remove-${entry.book.id}` ? "Removing..." : "Remove"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        onClick={() => navigate("/reservations")}
                        disabled={entry.book.available_copies <= 0}
                      >
                        {entry.book.available_copies <= 0 ? "Unavailable" : "Reserve"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="discover-section" aria-label="Catalog suggestions">
        <header className="discover-section-head">
          <h2>Add More Favorites</h2>
        </header>

        <label htmlFor="favorite-search" className="settings-field">
          <span>Search catalog suggestions</span>
          <input
            id="favorite-search"
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Type title, author, language, or year"
          />
        </label>

        {catalogSuggestions.length === 0 ? (
          <p className="empty-state">No suggestions available right now.</p>
        ) : (
          <div className="discover-recommend-grid">
            {catalogSuggestions.map((book) => (
              <article key={book.id} className="discover-recommend-card">
                <div
                  className={`discover-book-cover ${getToneClass(book.id)} ${book.cover_image_url ? "has-image" : ""}`.trim()}
                  style={
                    book.cover_image_url
                      ? {
                          backgroundImage: `linear-gradient(165deg, rgba(7, 66, 52, 0.42), rgba(7, 66, 52, 0.08)), url(${book.cover_image_url})`
                        }
                      : undefined
                  }
                >
                  {!book.cover_image_url ? <span>{getBookMonogram(book.title)}</span> : null}
                </div>
                <h3>{book.title}</h3>
                <p>{book.subtitle ?? formatAuthorLine(normalizeAuthors(book.book_authors))}</p>
                <div className="discover-recommend-meta">
                  <span className="availability-pill available">Catalog</span>
                  <button
                    type="button"
                    className="btn btn-soft btn-small"
                    onClick={() => {
                      void handleAddFavorite(book.id);
                    }}
                    disabled={activeAction === `add-${book.id}`}
                  >
                    {activeAction === `add-${book.id}` ? "Saving..." : "Add"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </LibraryWorkspaceLayout>
  );
}

