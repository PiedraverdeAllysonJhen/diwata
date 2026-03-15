import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
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
  normalizeTags
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

type SearchBook = {
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

type FilterAvailability = "all" | "available" | "borrowed" | "reserved";
type LoadSource = "manual" | "live";
type AvailabilityState = Exclude<FilterAvailability, "all">;

type CategoryCount = {
  id: string;
  name: string;
  count: number;
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

function normalizeBook(record: RawBookRecord): SearchBook {
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
    tags: normalizeTags(record.tags),
    copyStatuses: normalizeCopyStatuses(record.book_copies),
    categories: normalizeCategories(record.book_categories),
    authors: normalizeAuthors(record.book_authors)
  };
}

function getAvailabilityState(book: SearchBook): AvailabilityState {
  const statusSet = new Set(book.copyStatuses);

  if (statusSet.has("available")) return "available";
  if (statusSet.has("borrowed")) return "borrowed";
  if (statusSet.has("reserved")) return "reserved";

  // Fallback for incomplete copy rows: infer from copy counters.
  if (book.availableCopies > 0) return "available";
  if (book.totalCopies > 0 && book.availableCopies <= 0) return "borrowed";

  return "reserved";
}

function getAvailabilityLabel(status: AvailabilityState): string {
  if (status === "available") return "Available";
  if (status === "borrowed") return "Borrowed";
  return "Reserved";
}

function matchesAvailability(filter: FilterAvailability, status: AvailabilityState) {
  if (filter === "all") return true;
  return filter === status;
}

function canReserveFromSearch(status: AvailabilityState) {
  // Reservation workspace currently accepts direct reserve from available inventory.
  return status === "available";
}

function getAvailabilityRank(status: AvailabilityState) {
  if (status === "available") return 3;
  if (status === "reserved") return 2;
  return 1;
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

export default function SearchPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [books, setBooks] = useState<SearchBook[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedLanguage, setSelectedLanguage] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<FilterAvailability>("all");

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

  const loadCatalog = useCallback(async (source: LoadSource = "manual") => {
    if (source === "manual") {
      setIsFetching(true);
    } else {
      setIsLiveSyncing(true);
    }

    const [booksResult, categoriesResult] = await Promise.all([
      supabase
        .from("books")
        .select(
          "id,isbn,title,subtitle,description,publisher,language,publication_year,publication_date,cover_image_url,available_copies,total_copies,tags,book_copies(status),book_categories(category_id,categories(id,name)),book_authors(author_id,authors(id,name))"
        )
        .order("title", { ascending: true })
        .limit(300),
      supabase.from("categories").select("id,name").order("name", { ascending: true })
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

    setBooks(((booksResult.data ?? []) as RawBookRecord[]).map(normalizeBook));
    setCategories((categoriesResult.data ?? []) as CategoryRow[]);
    setNotice("");
    setLastSyncedAt(new Date().toISOString());

    if (source === "manual") {
      setIsFetching(false);
    } else {
      setIsLiveSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (!session?.user.id) return;
    void loadCatalog("manual");
  }, [session?.user.id, loadCatalog]);

  useEffect(() => {
    if (!session?.user.id || !hasSupabaseEnv) return;

    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const queueLiveRefresh = () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }

      refreshTimeout = window.setTimeout(() => {
        void loadCatalog("live");
      }, 320);
    };

    const channel = supabase
      .channel(`search-realtime-${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "books" }, queueLiveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_copies" }, queueLiveRefresh)
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
  }, [session?.user.id, loadCatalog]);

  useEffect(() => {
    if (selectedCategory === "all") return;
    const categoryStillExists = categories.some((category) => category.name === selectedCategory);
    if (!categoryStillExists) {
      setSelectedCategory("all");
    }
  }, [categories, selectedCategory]);

  const allLanguages = useMemo(() => {
    const values = new Set<string>();
    for (const book of books) {
      if (book.language) values.add(book.language);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [books]);

  const filteredBooks = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();

    return books.filter((book) => {
      const bookAvailability = getAvailabilityState(book);
      const matchesCategory = selectedCategory === "all" || book.categories.includes(selectedCategory);

      if (!matchesCategory) return false;
      if (selectedLanguage !== "all" && book.language !== selectedLanguage) return false;
      if (!matchesAvailability(availabilityFilter, bookAvailability)) return false;

      if (!keyword) return true;

      const searchableValues = [
        book.title,
        book.subtitle ?? "",
        book.description ?? "",
        book.publisher ?? "",
        book.language ?? "",
        book.publicationDate ?? "",
        book.publicationYear ? String(book.publicationYear) : "",
        book.isbn ?? "",
        book.tags.join(" "),
        book.categories.join(" "),
        book.authors.join(" ")
      ];

      return searchableValues.some((value) => value.toLowerCase().includes(keyword));
    });
  }, [books, searchQuery, selectedCategory, selectedLanguage, availabilityFilter]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const category of categories) {
      counts.set(category.name, 0);
    }

    for (const book of books) {
      const uniqueCategories = new Set(book.categories);
      for (const category of uniqueCategories) {
        if (!counts.has(category)) {
          counts.set(category, 0);
        }
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([name, count]) => {
        const category = categories.find((entry) => entry.name === name);
        return {
          id: category?.id ?? name,
          name,
          count
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [books, categories]);

  const featuredBooks = useMemo(() => {
    return [...filteredBooks]
      .sort((a, b) => {
        const availabilityRankA =
          getAvailabilityRank(getAvailabilityState(a));
        const availabilityRankB =
          getAvailabilityRank(getAvailabilityState(b));

        if (availabilityRankA !== availabilityRankB) {
          return availabilityRankB - availabilityRankA;
        }

        if (a.availableCopies !== b.availableCopies) {
          return b.availableCopies - a.availableCopies;
        }

        return a.title.localeCompare(b.title);
      })
      .slice(0, 8);
  }, [filteredBooks]);

  const hasFilters =
    searchQuery.trim().length > 0 ||
    selectedCategory !== "all" ||
    selectedLanguage !== "all" ||
    availabilityFilter !== "all";

  const shouldShowResultsSection = hasFilters;

  const clearFilters = () => {
    setSearchInput("");
    setSearchQuery("");
    setSelectedCategory("all");
    setSelectedLanguage("all");
    setAvailabilityFilter("all");
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearchQuery(searchInput.trim());
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
            <p>Add your values in `web/.env` before using catalog search features.</p>
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
            <h1>Loading discover workspace...</h1>
          </article>
        </section>
      </main>
    );
  }

  return (
    <LibraryWorkspaceLayout
      activeRoute="search"
      activeMenuKey="discover"
      title="Discover"
      description="Find books from live catalog data, filter by category, and reserve available titles."
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
        { label: "Categories", value: String(categories.length) }
      ]}
      sidebarAction={{
        label: isFetching ? "Refreshing..." : "Refresh Data",
        onClick: () => {
          void loadCatalog("manual");
        },
        disabled: isFetching
      }}
      statusBar={
        <PortalLiveIndicator
          isSyncing={isLiveSyncing}
          text={`${isLiveSyncing ? "Syncing live updates..." : "Live availability active"} | ${formatLastSync(lastSyncedAt)}`}
        />
      }
      notice={notice ? <p className="status error portal-notice">{notice}</p> : undefined}
      onNavigate={(route) => navigate(`/${route}`)}
      onSignOut={handleSignOut}
    >
      <form className="discover-searchbar" onSubmit={handleSearchSubmit}>
        <label htmlFor="category-filter" className="discover-field discover-field-select">
          <span>Category</span>
          <select
            id="category-filter"
            value={selectedCategory}
            onChange={(event) => setSelectedCategory(event.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.name}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="catalog-search" className="discover-field discover-field-search">
          <span>Search books</span>
          <input
            id="catalog-search"
            type="search"
            value={searchInput}
            onChange={(event) => {
              const nextValue = event.target.value;
              setSearchInput(nextValue);
              if (!nextValue.trim()) {
                setSearchQuery("");
              }
            }}
            placeholder="Find title, author, ISBN, tags, or year"
          />
        </label>

        <button type="submit" className="btn btn-primary discover-search-btn">
          Search
        </button>
      </form>

      <section className="discover-filter-toolbar" aria-label="Search filters and status">
        <div className="discover-filter-controls">
          <label htmlFor="language-filter" className="discover-inline-filter">
            <span>Language</span>
            <select
              id="language-filter"
              value={selectedLanguage}
              onChange={(event) => setSelectedLanguage(event.target.value)}
            >
              <option value="all">All languages</option>
              {allLanguages.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="availability-filter" className="discover-inline-filter">
            <span>Availability</span>
            <select
              id="availability-filter"
              value={availabilityFilter}
              onChange={(event) => setAvailabilityFilter(event.target.value as FilterAvailability)}
            >
              <option value="all">All statuses</option>
              <option value="available">Available</option>
              <option value="borrowed">Borrowed</option>
              <option value="reserved">Reserved</option>
            </select>
          </label>

          {hasFilters ? (
            <button type="button" className="btn btn-soft btn-small" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>
      </section>

      <section className="discover-section" aria-label="Book recommendations">
        <header className="discover-section-head">
          <h2>Book Recommendation</h2>
          <button
            type="button"
            className="discover-view-link"
            onClick={() => {
              clearFilters();
            }}
          >
            View all
          </button>
        </header>

        {featuredBooks.length === 0 ? (
          <p className="empty-state">No books found for the current filters.</p>
        ) : (
          <div className="discover-recommend-grid">
            {featuredBooks.map((book) => {
              const availability = getAvailabilityState(book);
              return (
                <article
                  key={`featured-${book.id}`}
                  className="discover-recommend-card book-card-link"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/books/${book.id}`)}
                  onKeyDown={(event) => onCardKeyDown(event, () => navigate(`/books/${book.id}`))}
                >
                  <div
                    className={`discover-book-cover ${getToneClass(book.id)} ${book.coverImageUrl ? "has-image" : ""}`.trim()}
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

                  <h3 title={book.title}>{book.title}</h3>
                  <p>{book.subtitle ?? book.publisher ?? "Catalog record"}</p>
                  <p className="discover-recommend-byline">By {formatAuthorLine(book.authors)}</p>

                  <div className="discover-recommend-meta">
                    <span className={`availability-pill ${availability}`}>{getAvailabilityLabel(availability)}</span>
                    <button
                      type="button"
                      className="btn btn-soft btn-small"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate("/reservations");
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                      disabled={!canReserveFromSearch(availability)}
                    >
                      {!canReserveFromSearch(availability) ? "Unavailable" : "Reserve"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="discover-section" aria-label="Book categories">
        <header className="discover-section-head">
          <h2>Book Category</h2>
        </header>

        {categoryCounts.length === 0 ? (
          <p className="empty-state">No categories found in the database yet.</p>
        ) : (
          <div className="discover-category-grid">
            {categoryCounts.map((entry: CategoryCount) => {
              const isActive = selectedCategory === entry.name;

              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`discover-category-card ${isActive ? "active" : ""}`.trim()}
                  onClick={() => setSelectedCategory(isActive ? "all" : entry.name)}
                >
                  <strong>{entry.name}</strong>
                  <span>{entry.count} titles</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {shouldShowResultsSection ? (
        <section className="discover-section" aria-label="Search results">
          <header className="discover-section-head">
            <h2>Search Results</h2>
          </header>

          {filteredBooks.length === 0 ? (
            <p className="empty-state">No books match the current filters.</p>
          ) : (
            <div className="discover-results-grid">
              {filteredBooks.map((book) => {
                const availabilityState = getAvailabilityState(book);

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
                        <span className={`availability-pill ${availabilityState}`}>
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

                      {book.categories.length > 0 ? (
                        <div className="search-book-tags">
                          {book.categories.map((category) => (
                            <span key={`${book.id}-${category}`} className="category-badge">
                              {category}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className="discover-result-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate("/reservations");
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                          disabled={!canReserveFromSearch(availabilityState)}
                        >
                          {!canReserveFromSearch(availabilityState) ? "Unavailable right now" : "Reserve from reservations"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}
    </LibraryWorkspaceLayout>
  );
}






