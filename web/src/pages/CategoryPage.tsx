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

type RawCopyStatusRelation = {
  status: string | null;
};

type RawBookRecord = {
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
  book_copies: RawCopyStatusRelation[] | null;
  book_categories: RawCategoryRelation[] | null;
  book_authors: RawAuthorRelation[] | null;
};

type BookRecord = {
  id: string;
  isbn: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  language: string | null;
  publicationYear: number | null;
  publicationDate: string | null;
  coverImageUrl: string | null;
  availableCopies: number;
  totalCopies: number;
  tags: string[];
  copyStatuses: string[];
  categories: string[];
  authors: string[];
};

type CategoryRow = {
  id: string;
  name: string;
};

type LoadSource = "manual" | "live";
type AvailabilityState = "available" | "borrowed" | "reserved";

type CategoryCount = {
  id: string;
  name: string;
  count: number;
  availableCount: number;
};
type ActiveReservation = {
  id: string;
  book_id: string;
  status: "pending" | "ready_for_pickup";
};

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

  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function normalizeCopyStatuses(relations: RawCopyStatusRelation[] | null): string[] {
  if (!relations || relations.length === 0) return [];

  const values = new Set<AvailabilityState>();

  for (const relation of relations) {
    const status = relation.status?.toLowerCase();
    if (status === "available" || status === "borrowed" || status === "reserved") {
      values.add(status);
    }
  }

  return Array.from(values);
}

function normalizeBook(record: RawBookRecord): BookRecord {
  return {
    id: record.id,
    isbn: record.isbn,
    title: record.title,
    subtitle: record.subtitle,
    description: record.description,
    publisher: record.publisher,
    language: record.language,
    publicationYear: record.publication_year,
    publicationDate: record.publication_date,
    coverImageUrl: record.cover_image_url,
    availableCopies: record.available_copies,
    totalCopies: record.total_copies,
    tags: record.tags ?? [],
    copyStatuses: normalizeCopyStatuses(record.book_copies),
    categories: normalizeCategories(record.book_categories),
    authors: normalizeAuthors(record.book_authors)
  };
}

function getAvailabilityState(book: Pick<BookRecord, "copyStatuses" | "availableCopies" | "totalCopies">): AvailabilityState {
  const statusSet = new Set(book.copyStatuses);

  if (statusSet.has("available")) return "available";
  if (statusSet.has("borrowed")) return "borrowed";
  if (statusSet.has("reserved")) return "reserved";

  if (book.availableCopies > 0) return "available";
  if (book.totalCopies > 0 && book.availableCopies <= 0) return "borrowed";

  return "reserved";
}

function getAvailabilityLabel(status: AvailabilityState) {
  if (status === "available") return "Available";
  if (status === "borrowed") return "Borrowed";
  return "Reserved";
}

function getAvailabilityClass(status: AvailabilityState) {
  return status;
}

function canReserveFromCategory(status: AvailabilityState) {
  return status === "available";
}

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

function onCardKeyDown(event: KeyboardEvent<HTMLElement>, onActivate: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate();
  }
}

export default function CategoryPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [reservedBookIds, setReservedBookIds] = useState<Set<string>>(new Set());
  const [activeReserveBookId, setActiveReserveBookId] = useState<string | null>(null);

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

  const loadData = useCallback(async (source: LoadSource = "manual") => {
    if (source === "manual") {
      setIsFetching(true);
    } else {
      setIsLiveSyncing(true);
    }

    const [booksResult, categoriesResult, reservationsResult] = await Promise.all([
      supabase
        .from("books")
        .select(
          "id,isbn,title,subtitle,description,publisher,language,publication_year,publication_date,cover_image_url,available_copies,total_copies,tags,book_copies(status),book_categories(category_id,categories(id,name)),book_authors(author_id,authors(id,name))"
        )
        .order("title", { ascending: true })
        .limit(300),
      supabase.from("categories").select("id,name").order("name", { ascending: true }),
      supabase
        .from("reservations")
        .select("id,book_id,status")
        .eq("user_id", session?.user.id ?? "")
        .in("status", ["pending", "ready_for_pickup"])
    ]);

    if (booksResult.error) {
      setNotice(booksResult.error.message);
      if (source === "manual") {
        setIsFetching(false);
      } else {
        setIsLiveSyncing(false);
      }
      return;
    }

    if (categoriesResult.error) {
      setNotice(categoriesResult.error.message);
      if (source === "manual") {
        setIsFetching(false);
      } else {
        setIsLiveSyncing(false);
      }
      return;
    }

    if (reservationsResult.error) {
      setNotice(reservationsResult.error.message);
      if (source === "manual") {
        setIsFetching(false);
      } else {
        setIsLiveSyncing(false);
      }
      return;
    }

    setBooks(((booksResult.data ?? []) as RawBookRecord[]).map(normalizeBook));
    setCategories((categoriesResult.data ?? []) as CategoryRow[]);
    const activeReservations = (reservationsResult.data ?? []) as ActiveReservation[];
    setReservedBookIds(new Set(activeReservations.map((reservation) => reservation.book_id)));
    setNotice("");
    setLastSyncedAt(new Date().toISOString());

    if (source === "manual") {
      setIsFetching(false);
    } else {
      setIsLiveSyncing(false);
    }
  }, [session?.user.id]);

  useEffect(() => {
    if (!session?.user.id) return;
    void loadData("manual");
  }, [session?.user.id, loadData]);

  useEffect(() => {
    if (!session?.user.id || !hasSupabaseEnv) return;

    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const queueLiveRefresh = () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }

      refreshTimeout = window.setTimeout(() => {
        void loadData("live");
      }, 320);
    };

    const channel = supabase
      .channel(`category-realtime-${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "books" }, queueLiveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_categories" }, queueLiveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_authors" }, queueLiveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, queueLiveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "authors" }, queueLiveRefresh)
      .subscribe();

    return () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id, loadData]);

  useEffect(() => {
    if (selectedCategory === "all") return;
    const categoryStillExists = categories.some((category) => category.name === selectedCategory);
    if (!categoryStillExists) {
      setSelectedCategory("all");
    }
  }, [categories, selectedCategory]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, { total: number; available: number }>();

    for (const category of categories) {
      counts.set(category.name, { total: 0, available: 0 });
    }

    for (const book of books) {
      for (const category of new Set(book.categories)) {
        if (!counts.has(category)) {
          counts.set(category, { total: 0, available: 0 });
        }
        const current = counts.get(category);
        if (!current) continue;

        current.total += 1;
        if (getAvailabilityState(book) === "available") {
          current.available += 1;
        }
      }
    }

    return Array.from(counts.entries())
      .map(([name, value]) => {
        const category = categories.find((item) => item.name === name);
        return {
          id: category?.id ?? name,
          name,
          count: value.total,
          availableCount: value.available
        };
      })
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [categories, books]);

  const filteredBooks = useMemo(() => {
    if (selectedCategory === "all") return books;
    return books.filter((book) => book.categories.includes(selectedCategory));
  }, [books, selectedCategory]);

  const featuredCategories = useMemo(() => categoryCounts.slice(0, 12), [categoryCounts]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const handleReserveBook = async (bookId: string) => {
    if (!session?.user.id) return;

    setActiveReserveBookId(bookId);
    setNotice("");

    const { error } = await supabase.from("reservations").insert({
      user_id: session.user.id,
      book_id: bookId,
      status: "pending"
    });

    if (error) {
      if (error.code === "23505" || /duplicate/i.test(error.message)) {
        setReservedBookIds((previous) => new Set([...previous, bookId]));
        setNotice("You already have an active reservation for this book.");
      } else {
        setNotice(error.message);
      }
      setActiveReserveBookId(null);
      return;
    }

    setReservedBookIds((previous) => new Set([...previous, bookId]));
    setNotice("");
    setActiveReserveBookId(null);
  };

  const userEmail = session?.user.email ?? "student@vsu.edu.ph";
  const notifier = useReservationNotifier(session?.user.id);

  if (!hasSupabaseEnv) {
    return (
      <main className="portal-page">
        <section className="portal-shell portal-single">
          <article className="portal-panel">
            <h1>Supabase not configured</h1>
            <p>Add your values in `web/.env` before using category features.</p>
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
            <h1>Loading categories...</h1>
          </article>
        </section>
      </main>
    );
  }

  return (
    <LibraryWorkspaceLayout
      activeRoute="category"
      activeMenuKey="category"
      title="Book Categories"
      description="Browse your full category collection and jump to available titles faster."
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
        { label: "Books", value: String(books.length) },
        { label: "Categories", value: String(categoryCounts.length) }
      ]}
      sidebarAction={{
        label: isFetching ? "Refreshing..." : "Refresh Data",
        onClick: () => {
          void loadData("manual");
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
          text={`${isLiveSyncing ? "Syncing live updates..." : "Live categories active"} | ${formatLastSync(lastSyncedAt)}`}
        />
      }
      notice={notice ? <p className="status error portal-notice">{notice}</p> : undefined}
      onNavigate={(route) => navigate(`/${route}`)}
      onSignOut={handleSignOut}
    >
      <section className="discover-section" aria-label="Category overview">
        <header className="discover-section-head">
          <h2>Category Collection</h2>
          <button type="button" className="discover-view-link" onClick={() => setSelectedCategory("all")}>
            Show all
          </button>
        </header>

        {featuredCategories.length === 0 ? (
          <p className="empty-state">No categories found in the database yet.</p>
        ) : (
          <div className="discover-category-grid">
            {featuredCategories.map((entry: CategoryCount) => {
              const active = selectedCategory === entry.name;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`discover-category-card ${active ? "active" : ""}`.trim()}
                  onClick={() => setSelectedCategory(active ? "all" : entry.name)}
                >
                  <strong>{entry.name}</strong>
                  <span>
                    {entry.count} titles | {entry.availableCount} available
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="discover-section" aria-label="Books in selected category">
        <header className="discover-section-head">
          <h2>{selectedCategory === "all" ? "All Catalog Titles" : `${selectedCategory} Titles`}</h2>
          <p className="discover-inline-meta">{filteredBooks.length} books</p>
        </header>

        {filteredBooks.length === 0 ? (
          <p className="empty-state">No books are available for this category yet.</p>
        ) : (
          <div className="discover-results-grid">
            {filteredBooks.map((book) => {
              const availabilityState = getAvailabilityState(book);
              const availabilityClass = getAvailabilityClass(availabilityState);
              return (
                <article
                  key={book.id}
                  className="discover-result-card book-card-link"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/books/${book.id}`)}
                  onKeyDown={(event) => onCardKeyDown(event, () => navigate(`/books/${book.id}`))}
                >
                  <div
                    className={`discover-result-cover ${getToneClass(book.id)} ${book.coverImageUrl ? "has-image" : ""}`.trim()}
                    style={
                      book.coverImageUrl
                        ? {
                            backgroundImage: `linear-gradient(165deg, rgba(7, 66, 52, 0.42), rgba(7, 66, 52, 0.08)), url(${book.coverImageUrl})`
                          }
                        : undefined
                    }
                  >
                    {!book.coverImageUrl ? <span>{getBookMonogram(book.title)}</span> : null}
                  </div>

                  <div className="discover-result-content">
                    <div className="discover-result-head">
                      <h3>{book.title}</h3>
                      <span className={`availability-pill ${availabilityClass}`}>
                        {getAvailabilityLabel(availabilityState)}
                      </span>
                    </div>

                    <div className="discover-book-meta-grid">
                      <p className="discover-result-meta"><strong>Author:</strong> {formatAuthorLine(book.authors)}</p>
                      <p className="discover-result-meta"><strong>Publish date:</strong> {formatPublicationLabel(book.publicationDate, book.publicationYear)}</p>
                      <p className="discover-result-meta"><strong>ISBN:</strong> {book.isbn ?? "N/A"}</p>
                      <p className="discover-result-meta"><strong>Publisher:</strong> {book.publisher ?? "N/A"}</p>
                      <p className="discover-result-meta"><strong>Language:</strong> {book.language ?? "N/A"}</p>
                      <p className="discover-result-meta"><strong>Copies:</strong> {book.availableCopies} available / {book.totalCopies} total</p>
                      <p className="discover-result-meta"><strong>Subtitle:</strong> {book.subtitle ?? "N/A"}</p>
                      <p className="discover-result-meta"><strong>Tags:</strong> {book.tags.length > 0 ? book.tags.join(", ") : "None"}</p>
                    </div>

                    <p className="discover-result-description">
                      <strong>Description:</strong> {book.description ?? "No description provided."}
                    </p>

                    <div className="discover-result-actions">
                      {(() => {
                        const isReserved = reservedBookIds.has(book.id);
                        const canReserve = canReserveFromCategory(availabilityState);
                        const isSaving = activeReserveBookId === book.id;

                        return (
                          <button
                            type="button"
                            className="btn btn-primary btn-small"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleReserveBook(book.id);
                            }}
                            onKeyDown={(event) => event.stopPropagation()}
                            disabled={!canReserve || isReserved || isSaving}
                          >
                            {!canReserve
                              ? "Unavailable right now"
                              : isReserved
                              ? "Reserved"
                              : isSaving
                              ? "Saving..."
                              : "Reserve"}
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </LibraryWorkspaceLayout>
  );
}




