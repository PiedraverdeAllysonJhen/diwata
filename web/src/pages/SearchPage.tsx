import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { hasSupabaseEnv, supabase } from "../lib/supabase";
import PortalLiveIndicator from "../components/PortalLiveIndicator";
import LibraryWorkspaceLayout from "../components/LibraryWorkspaceLayout";
import { useReservationNotifier } from "../hooks/useReservationNotifier";

type RawCategoryRelation = {
  category_id: string;
  categories: { id: string; name: string } | { id: string; name: string }[] | null;
};

type RawBookRecord = {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  language: string | null;
  publication_year: number | null;
  cover_image_url: string | null;
  available_copies: number;
  total_copies: number;
  tags: string[] | null;
  book_categories: RawCategoryRelation[] | null;
};

type SearchBook = {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  language: string | null;
  publicationYear: number | null;
  coverImageUrl: string | null;
  availableCopies: number;
  totalCopies: number;
  tags: string[];
  categories: string[];
};

type CategoryRow = {
  id: string;
  name: string;
};

type FilterAvailability = "all" | "available" | "low_stock" | "out_of_stock";
type LoadSource = "manual" | "live";

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

function normalizeBook(record: RawBookRecord): SearchBook {
  return {
    id: record.id,
    title: record.title,
    subtitle: record.subtitle,
    description: record.description,
    publisher: record.publisher,
    language: record.language,
    publicationYear: record.publication_year,
    coverImageUrl: record.cover_image_url,
    availableCopies: record.available_copies,
    totalCopies: record.total_copies,
    tags: record.tags ?? [],
    categories: normalizeCategories(record.book_categories)
  };
}

function getAvailabilityState(book: SearchBook): Exclude<FilterAvailability, "all"> {
  if (book.availableCopies <= 0) return "out_of_stock";
  if (book.availableCopies <= 2) return "low_stock";
  return "available";
}

function getAvailabilityLabel(status: Exclude<FilterAvailability, "all">): string {
  if (status === "available") return "Available";
  if (status === "low_stock") return "Low stock";
  return "Out of stock";
}

function matchesAvailability(filter: FilterAvailability, status: Exclude<FilterAvailability, "all">) {
  if (filter === "all") return true;
  return filter === status;
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
          "id,title,subtitle,description,publisher,language,publication_year,cover_image_url,available_copies,total_copies,tags,book_categories(category_id,categories(id,name))"
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "books" },
        queueLiveRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "book_copies" },
        queueLiveRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "book_categories" },
        queueLiveRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "categories" },
        queueLiveRefresh
      )
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
      const matchesCategory =
        selectedCategory === "all" || book.categories.includes(selectedCategory);

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
        book.publicationYear ? String(book.publicationYear) : "",
        book.tags.join(" "),
        book.categories.join(" ")
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

  const categoryPreviewBook = useMemo(() => {
    const previews = new Map<string, SearchBook>();

    for (const book of books) {
      for (const category of book.categories) {
        if (!previews.has(category)) {
          previews.set(category, book);
        }
      }
    }

    return previews;
  }, [books]);

  const featuredBooks = useMemo(() => {
    return [...filteredBooks]
      .sort((a, b) => {
        const availabilityRankA =
          getAvailabilityState(a) === "available"
            ? 2
            : getAvailabilityState(a) === "low_stock"
              ? 1
              : 0;
        const availabilityRankB =
          getAvailabilityState(b) === "available"
            ? 2
            : getAvailabilityState(b) === "low_stock"
              ? 1
              : 0;

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

  const availableNowCount = useMemo(
    () => books.filter((book) => getAvailabilityState(book) !== "out_of_stock").length,
    [books]
  );

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
            placeholder="Find title, description, publisher, tags, or year"
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
              <option value="low_stock">Low stock</option>
              <option value="out_of_stock">Out of stock</option>
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
                <article key={`featured-${book.id}`} className="discover-recommend-card">
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

                  <div className="discover-recommend-meta">
                    <span className={`availability-pill ${availability}`}>{getAvailabilityLabel(availability)}</span>
                    <button
                      type="button"
                      className="btn btn-soft btn-small"
                      onClick={() => navigate("/reservations")}
                      disabled={availability === "out_of_stock"}
                    >
                      {availability === "out_of_stock" ? "Unavailable" : "Reserve"}
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
              const previewBook = categoryPreviewBook.get(entry.name);
              const isActive = selectedCategory === entry.name;

              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`discover-category-card ${isActive ? "active" : ""}`.trim()}
                  onClick={() => setSelectedCategory(isActive ? "all" : entry.name)}
                >
                  <div
                    className={`discover-mini-cover ${previewBook ? getToneClass(previewBook.id) : "tone-1"} ${previewBook?.coverImageUrl ? "has-image" : ""}`.trim()}
                    style={
                      previewBook?.coverImageUrl
                        ? {
                            backgroundImage: `linear-gradient(165deg, rgba(7, 66, 52, 0.42), rgba(7, 66, 52, 0.08)), url(${previewBook.coverImageUrl})`
                          }
                        : undefined
                    }
                  >
                    {!previewBook?.coverImageUrl ? (
                      <span>{getBookMonogram(previewBook?.title ?? entry.name)}</span>
                    ) : null}
                  </div>
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
                  <article key={book.id} className="discover-result-card">
                    <div
                      className={`discover-mini-cover ${getToneClass(book.id)} ${book.coverImageUrl ? "has-image" : ""}`.trim()}
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

                      <p className="discover-result-meta">
                        {book.availableCopies} of {book.totalCopies} copies available
                        {book.language ? ` | ${book.language}` : ""}
                        {book.publicationYear ? ` | ${book.publicationYear}` : ""}
                      </p>

                      {book.description ? (
                        <p className="discover-result-description">{book.description}</p>
                      ) : null}

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
                          onClick={() => navigate("/reservations")}
                          disabled={availabilityState === "out_of_stock"}
                        >
                          {availabilityState === "out_of_stock"
                            ? "Unavailable right now"
                            : "Reserve from reservations"}
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







