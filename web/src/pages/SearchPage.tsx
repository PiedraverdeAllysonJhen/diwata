import { useCallback, useEffect, useMemo, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { hasSupabaseEnv, supabase } from "../lib/supabase";
import PortalLiveIndicator from "../components/PortalLiveIndicator";
import PortalSubhead from "../components/PortalSubhead";
import PortalSummaryStrip from "../components/PortalSummaryStrip";
import PortalTopbar from "../components/PortalTopbar";
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
  availableCopies: number;
  totalCopies: number;
  tags: string[];
  categories: string[];
};

type CategoryRow = {
  name: string;
};

type FilterAvailability = "all" | "available" | "low_stock" | "out_of_stock";
type LoadSource = "manual" | "live";

type CategoryCount = {
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

export default function SearchPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [books, setBooks] = useState<SearchBook[]>([]);
  const [allCategories, setAllCategories] = useState<string[]>([]);
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
          "id,title,subtitle,description,publisher,language,publication_year,available_copies,total_copies,tags,book_categories(category_id,categories(id,name))"
        )
        .order("title", { ascending: true })
        .limit(300),
      supabase.from("categories").select("name").order("name", { ascending: true })
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

    const normalizedBooks = ((booksResult.data ?? []) as RawBookRecord[]).map(normalizeBook);
    setBooks(normalizedBooks);

    const categoryNames = new Set<string>();

    for (const category of (categoriesResult.data ?? []) as CategoryRow[]) {
      if (category.name) categoryNames.add(category.name);
    }

    for (const book of normalizedBooks) {
      for (const category of book.categories) {
        categoryNames.add(category);
      }
    }

    setAllCategories(Array.from(categoryNames).sort((a, b) => a.localeCompare(b)));
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
        selectedCategory === "all" ||
        (selectedCategory === "Uncategorized" && book.categories.length === 0) ||
        book.categories.includes(selectedCategory);

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

    for (const book of books) {
      const sourceCategories = book.categories.length > 0 ? book.categories : ["Uncategorized"];
      const uniqueCategories = new Set(sourceCategories);

      for (const category of uniqueCategories) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [books]);

  const availableNowCount = useMemo(
    () => books.filter((book) => getAvailabilityState(book) !== "out_of_stock").length,
    [books]
  );

  const hasFilters =
    searchQuery.trim().length > 0 ||
    selectedCategory !== "all" ||
    selectedLanguage !== "all" ||
    availabilityFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory("all");
    setSelectedLanguage("all");
    setAvailabilityFilter("all");
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
            <h1>Loading search workspace...</h1>
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className="portal-page">
      <div className="portal-shell">
        <PortalTopbar
          activeRoute="search"
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
          onNavigate={(route) => navigate(`/${route}`)}
          onSignOut={async () => {
            await supabase.auth.signOut();
            navigate("/", { replace: true });
          }}
        />

        <PortalSubhead
          releaseCode="DW.010.003"
          title="Book Search and Categorization"
          description="Search the catalog by keyword, category, language, and availability to find the best book for your needs."
          className="search-subhead"
          actions={
            <>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => {
                  void loadCatalog("manual");
                }}
                disabled={isFetching}
              >
                {isFetching ? "Refreshing..." : "Refresh catalog"}
              </button>
              {hasFilters ? (
                <button type="button" className="btn btn-soft" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : null}
            </>
          }
        />

        <PortalLiveIndicator
          isSyncing={isLiveSyncing}
          text={`${isLiveSyncing ? "Syncing live updates..." : "Live availability active"} | ${formatLastSync(lastSyncedAt)}`}
        />

        {notice ? <p className="status error portal-notice">{notice}</p> : null}

        <PortalSummaryStrip
          ariaLabel="Search summary"
          className="search-summary-strip"
          metrics={[
            { label: "Total Catalog", value: books.length },
            { label: "Available Now", value: availableNowCount },
            { label: "Filtered Results", value: filteredBooks.length }
          ]}
        />

        <section className="search-toolbar">
          <label htmlFor="catalog-search" className="search-field">
            <span>Keyword search</span>
            <input
              id="catalog-search"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search title, description, category, language, tags, or year"
            />
          </label>

          <div className="search-filter-grid">
            <label htmlFor="category-filter" className="select-field">
              <span>Category</span>
              <select
                id="category-filter"
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
              >
                <option value="all">All categories</option>
                <option value="Uncategorized">Uncategorized</option>
                {allCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="language-filter" className="select-field">
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

            <label htmlFor="availability-filter" className="select-field">
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
          </div>
        </section>

        <section className="search-category-cloud" aria-label="Category overview">
          {categoryCounts.length === 0 ? (
            <p className="empty-state">No categories available yet.</p>
          ) : (
            categoryCounts.map((entry: CategoryCount) => {
              const isActive = selectedCategory === entry.name;
              return (
                <button
                  key={entry.name}
                  type="button"
                  className={`category-pill ${isActive ? "active" : ""}`}
                  onClick={() => setSelectedCategory(isActive ? "all" : entry.name)}
                >
                  <span>{entry.name}</span>
                  <strong>{entry.count}</strong>
                </button>
              );
            })
          )}
        </section>

        <section className="search-results-grid" aria-label="Filtered book list">
          {filteredBooks.length === 0 ? (
            <p className="empty-state">No books match the current filters.</p>
          ) : (
            filteredBooks.map((book) => {
              const availabilityState = getAvailabilityState(book);
              const availabilityLabel = getAvailabilityLabel(availabilityState);

              return (
                <article key={book.id} className="search-book-card">
                  <header className="search-book-head">
                    <h2>{book.title}</h2>
                    <span className={`availability-pill ${availabilityState}`}>{availabilityLabel}</span>
                  </header>

                  {book.subtitle ? <p className="search-book-subtitle">{book.subtitle}</p> : null}

                  <p className="search-book-meta">
                    {book.availableCopies} of {book.totalCopies} copies available
                    {book.language ? ` | ${book.language}` : ""}
                    {book.publicationYear ? ` | ${book.publicationYear}` : ""}
                  </p>

                  {book.description ? (
                    <p className="search-book-description">{book.description}</p>
                  ) : null}

                  <div className="search-book-tags" aria-label="Book categories">
                    {(book.categories.length > 0 ? book.categories : ["Uncategorized"]).map((category) => (
                      <span key={category} className="category-badge">
                        {category}
                      </span>
                    ))}
                  </div>

                  {book.tags.length > 0 ? (
                    <p className="search-book-meta">Tags: {book.tags.join(", ")}</p>
                  ) : null}

                  <div className="search-book-actions">
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
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}

