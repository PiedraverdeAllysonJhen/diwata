import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import CatalogBookCard from "../components/CatalogBookCard";
import PortalLiveIndicator from "../components/PortalLiveIndicator";
import LibraryWorkspaceLayout from "../components/LibraryWorkspaceLayout";
import { useReservationNotifier } from "../hooks/useReservationNotifier";
import { hasSupabaseEnv, supabase } from "../lib/supabase";
import {
  RawAuthorRelation,
  formatAuthorLine,
  formatPublicationLabel,
  normalizeAuthors,
  normalizeTags,
} from "../lib/bookMetadata";

type RawCategoryRelation = {
  category_id: string;
  categories:
    | { id: string; name: string }
    | { id: string; name: string }[]
    | null;
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

type ReservationHistoryRow = {
  book_id: string;
  status: "pending" | "approved" | "ready_for_pickup" | "fulfilled" | "expired";
};

type FilterAvailability = "all" | "available" | "borrowed" | "reserved";
type LoadSource = "manual" | "live";
type AvailabilityState = Exclude<FilterAvailability, "all">;

type CategoryCount = {
  id: string;
  name: string;
  count: number;
};

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
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function normalizeCopyStatuses(
  relations: RawCopyStatusRelation[] | null,
): string[] {
  if (!relations || relations.length === 0) return [];
  const values = new Set<AvailabilityState>();
  for (const relation of relations) {
    const status = relation.status?.toLowerCase();
    if (
      status === "available" ||
      status === "borrowed" ||
      status === "reserved"
    )
      values.add(status);
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
    authors: normalizeAuthors(record.book_authors),
  };
}

function getAvailabilityState(book: SearchBook): AvailabilityState {
  const statusSet = new Set(book.copyStatuses);
  if (statusSet.has("available")) return "available";
  if (statusSet.has("borrowed")) return "borrowed";
  if (statusSet.has("reserved")) return "reserved";
  if (book.availableCopies > 0) return "available";
  if (book.totalCopies > 0) return "borrowed";
  return "reserved";
}

function getAvailabilityLabel(status: AvailabilityState): string {
  if (status === "available") return "Available";
  if (status === "borrowed") return "Borrowed";
  return "Reserved";
}

function matchesAvailability(
  filter: FilterAvailability,
  status: AvailabilityState,
) {
  if (filter === "all") return true;
  return filter === status;
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
  return `Last sync ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
}

function CategoryIcon({ name }: { name: string }) {
  const normalized = name.toLowerCase();
  const iconClassName = "h-5 w-5";
  if (normalized.includes("science") || normalized.includes("research")) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={iconClassName}
      >
        <path d="M9 3h6" />
        <path d="M10 3v5l-5.5 8.8A3 3 0 0 0 7 21h10a3 3 0 0 0 2.5-4.2L14 8V3" />
        <path d="M8.5 14h7" />
      </svg>
    );
  }
  if (normalized.includes("history") || normalized.includes("culture")) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={iconClassName}
      >
        <path d="M6 4.5A2.5 2.5 0 0 1 8.5 2H20v16.5A2.5 2.5 0 0 0 17.5 16H6Z" />
        <path d="M6 4.5V22" />
        <path d="M10 7h6" />
        <path d="M10 11h6" />
      </svg>
    );
  }
  if (normalized.includes("technology") || normalized.includes("computer")) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={iconClassName}
      >
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8" />
        <path d="M12 16v4" />
      </svg>
    );
  }
  if (
    normalized.includes("art") ||
    normalized.includes("design") ||
    normalized.includes("literature")
  ) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={iconClassName}
      >
        <path d="M12 3c4 0 7 3.4 7 7.4 0 5.2-7 10.6-7 10.6S5 15.6 5 10.4C5 6.4 8 3 12 3Z" />
        <circle cx="12" cy="10" r="2.2" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={iconClassName}
    >
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v13.5A2.5 2.5 0 0 0 17.5 15H4Z" />
      <path d="M4 6.5V20" />
      <path d="M9 8h6" />
      <path d="M9 12h4" />
    </svg>
  );
}

function CategoryIconButton({
  active,
  count,
  name,
  onClick,
}: {
  active: boolean;
  count: number;
  name: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={name}
      title={name}
      className={`relative flex min-h-[112px] w-[100px] flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 py-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500/25 ${
        active ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
      }`}
    >
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-2xl transition ${active ? "bg-emerald-700 text-white shadow-lg shadow-emerald-700/25" : "bg-slate-50 text-slate-600"}`}
      >
        <CategoryIcon name={name} />
      </span>
      <span
        className={`line-clamp-2 text-xs font-medium ${active ? "text-emerald-700" : "text-slate-600"}`}
      >
        {name}
      </span>
      <span className="text-[11px] text-slate-400">{count}</span>
      <span className="sr-only">{name}</span>
    </button>
  );
}

function SectionCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
      <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-700">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            {description}
          </p>
        </div>
        {children}
      </div>
    </section>
  );
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
  const [reservedBookIds, setReservedBookIds] = useState<Set<string>>(
    new Set(),
  );
  const [borrowedHistoryBookIds, setBorrowedHistoryBookIds] = useState<
    Set<string>
  >(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedLanguage, setSelectedLanguage] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] =
    useState<FilterAvailability>("all");
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
        data: { session: currentSession },
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
      data: { subscription },
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

  const loadCatalog = useCallback(
    async (source: LoadSource = "manual") => {
      if (!session?.user.id) return;
      if (source === "manual") {
        setIsFetching(true);
      } else {
        setIsLiveSyncing(true);
      }

      const [booksResult, categoriesResult, historyResult] = await Promise.all([
        supabase
          .from("books")
          .select(
            "id,isbn,title,subtitle,description,publisher,language,publication_year,publication_date,cover_image_url,available_copies,total_copies,tags,book_copies(status),book_categories(category_id,categories(id,name)),book_authors(author_id,authors(id,name))",
          )
          .order("title", { ascending: true })
          .limit(300),
        supabase
          .from("categories")
          .select("id,name")
          .order("name", { ascending: true }),
        supabase
          .from("reservations")
          .select("book_id,status")
          .eq("user_id", session.user.id)
          .in("status", [
            "pending",
            "approved",
            "ready_for_pickup",
            "fulfilled",
            "expired",
          ]),
      ]);

      const firstError =
        booksResult.error ?? categoriesResult.error ?? historyResult.error;
      if (firstError) {
        setNotice(firstError.message);
        if (source === "manual") {
          setIsFetching(false);
        } else {
          setIsLiveSyncing(false);
        }
        return;
      }

      const reservationHistory = (historyResult.data ??
        []) as ReservationHistoryRow[];
      setBooks(
        ((booksResult.data ?? []) as RawBookRecord[]).map(normalizeBook),
      );
      setCategories((categoriesResult.data ?? []) as CategoryRow[]);
      setReservedBookIds(
        new Set(
          reservationHistory
            .filter(
              (e) => e.status === "pending" || e.status === "approved" || e.status === "ready_for_pickup",
            )
            .map((e) => e.book_id),
        ),
      );
      setBorrowedHistoryBookIds(
        new Set(
          reservationHistory
            .filter((e) => e.status === "fulfilled" || e.status === "expired")
            .map((e) => e.book_id),
        ),
      );
      setNotice("");
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
    void loadCatalog("manual");
  }, [loadCatalog, session?.user.id]);

  useEffect(() => {
    if (!session?.user.id || !hasSupabaseEnv) return;
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const queueLiveRefresh = () => {
      if (refreshTimeout) window.clearTimeout(refreshTimeout);
      refreshTimeout = window.setTimeout(() => {
        void loadCatalog("live");
      }, 320);
    };
    const channel = supabase
      .channel(`search-realtime-${session.user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "books" },
        queueLiveRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "book_copies" },
        queueLiveRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "book_categories" },
        queueLiveRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "book_authors" },
        queueLiveRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "categories" },
        queueLiveRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "authors" },
        queueLiveRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `user_id=eq.${session.user.id}`,
        },
        queueLiveRefresh,
      )
      .subscribe();
    return () => {
      if (refreshTimeout) window.clearTimeout(refreshTimeout);
      void supabase.removeChannel(channel);
    };
  }, [loadCatalog, session?.user.id]);

  useEffect(() => {
    if (selectedCategory === "all") return;
    if (!categories.some((c) => c.name === selectedCategory))
      setSelectedCategory("all");
  }, [categories, selectedCategory]);

  const allLanguages = useMemo(() => {
    const values = new Set<string>();
    for (const book of books) {
      if (book.language) values.add(book.language);
    }
    return Array.from(values).sort((l, r) => l.localeCompare(r));
  }, [books]);

  const filteredBooks = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    return books.filter((book) => {
      const availability = getAvailabilityState(book);
      if (
        selectedCategory !== "all" &&
        !book.categories.includes(selectedCategory)
      )
        return false;
      if (selectedLanguage !== "all" && book.language !== selectedLanguage)
        return false;
      if (!matchesAvailability(availabilityFilter, availability)) return false;
      if (!keyword) return true;
      return [
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
        book.authors.join(" "),
      ].some((v) => v.toLowerCase().includes(keyword));
    });
  }, [
    availabilityFilter,
    books,
    searchQuery,
    selectedCategory,
    selectedLanguage,
  ]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const category of categories) counts.set(category.name, 0);
    for (const book of books) {
      for (const category of new Set(book.categories))
        counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count > 0)
      .map(([name, count]) => ({
        id: categories.find((c) => c.name === name)?.id ?? name,
        name,
        count,
      }))
      .sort((l, r) => r.count - l.count || l.name.localeCompare(r.name));
  }, [books, categories]);

  const featuredBooks = useMemo(() => {
    return [...books]
      .sort((l, r) => {
        const rankL = getAvailabilityRank(getAvailabilityState(l));
        const rankR = getAvailabilityRank(getAvailabilityState(r));
        if (rankL !== rankR) return rankR - rankL;
        if (l.availableCopies !== r.availableCopies)
          return r.availableCopies - l.availableCopies;
        return l.title.localeCompare(r.title);
      })
      .slice(0, 8);
  }, [books]);

  const isFocusedBrowse =
    searchQuery.trim().length > 0 ||
    selectedCategory !== "all" ||
    selectedLanguage !== "all" ||
    availabilityFilter !== "all";

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearchQuery(searchInput.trim());
  };

  const handleClearBrowse = () => {
    setSearchInput("");
    setSearchQuery("");
    setSelectedCategory("all");
    setSelectedLanguage("all");
    setAvailabilityFilter("all");
  };

  const handleReserveBook = async (bookId: string) => {
    if (!session?.user.id) return;
    setActiveReserveBookId(bookId);
    setNotice("");
    const { error } = await supabase
      .from("reservations")
      .insert({ user_id: session.user.id, book_id: bookId, status: "pending" });
    if (error) {
      setNotice(
        error.code === "23505" || /duplicate/i.test(error.message)
          ? "You already have an active reservation for this book."
          : error.message,
      );
      setActiveReserveBookId(null);
      return;
    }
    setReservedBookIds((previous) => new Set([...previous, bookId]));
    setActiveReserveBookId(null);
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
            <p>
              Add your values in `web/.env` before using catalog search
              features.
            </p>
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
      description="A cleaner academic browsing flow for finding, comparing, and reserving catalog titles."
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
        { label: "Books", value: String(books.length) },
        { label: "Categories", value: String(categoryCounts.length) },
      ]}
      sidebarAction={{
        label: isFetching ? "Refreshing..." : "Refresh Data",
        onClick: () => {
          void loadCatalog("manual");
        },
        disabled: isFetching,
      }}
      statusBar={
        <PortalLiveIndicator
          isSyncing={isLiveSyncing}
          text={`${isLiveSyncing ? "Syncing catalog..." : "Catalog synced"} | ${formatLastSync(lastSyncedAt)}`}
        />
      }
      notice={
        notice ? (
          <p className="status error portal-notice">{notice}</p>
        ) : undefined
      }
      onNavigate={(route) => navigate(`/${route}`)}
      onSignOut={handleSignOut}
    >
      <div className="space-y-5">
        <SectionCard
          eyebrow="Library Search"
          title="Browse the collection with less clutter"
          description="Search and category selection now move you straight into a focused browsing grid."
        >
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>{filteredBooks.length} matching titles</span>
            {isFocusedBrowse ? (
              <button
                type="button"
                onClick={handleClearBrowse}
                className="rounded-full border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 transition hover:border-emerald-200 hover:text-emerald-700"
              >
                Clear focus
              </button>
            ) : null}
          </div>
        </SectionCard>

        <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
          <form
            className="grid items-end gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto]"
            onSubmit={handleSearchSubmit}
          >
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Search
              </span>
              <input
                type="search"
                value={searchInput}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearchInput(v);
                  if (!v.trim()) setSearchQuery("");
                }}
                placeholder="Find title, author, ISBN, tags, or year"
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Language
              </span>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white"
              >
                <option value="all">All languages</option>
                {allLanguages.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Availability
              </span>
              <select
                value={availabilityFilter}
                onChange={(e) =>
                  setAvailabilityFilter(e.target.value as FilterAvailability)
                }
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white"
              >
                <option value="all">All statuses</option>
                <option value="available">Available</option>
                <option value="borrowed">Borrowed</option>
                <option value="reserved">Reserved</option>
              </select>
            </label>
            <button
              type="submit"
              className="w-auto self-end rounded-2xl bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              Search collection
            </button>
          </form>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setSelectedCategory("all")}
              aria-label="All categories"
              title="All categories"
              className={`flex min-h-[112px] w-[100px] flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 py-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500/25 ${
                selectedCategory === "all" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
              }`}
            >
              <span
                className={`flex h-14 w-14 items-center justify-center rounded-2xl transition ${selectedCategory === "all" ? "bg-emerald-700 text-white shadow-lg shadow-emerald-700/25" : "bg-slate-50 text-slate-600"}`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                >
                  <path d="M4 6h16" />
                  <path d="M4 12h16" />
                  <path d="M4 18h16" />
                </svg>
              </span>
              <span
                className={`text-xs font-medium ${selectedCategory === "all" ? "text-emerald-700" : "text-slate-600"}`}
              >
                All
              </span>
              <span className="text-[11px] text-slate-400">{books.length}</span>
              <span className="sr-only">All categories</span>
            </button>
            {categoryCounts.map((entry) => (
              <CategoryIconButton
                key={entry.id}
                active={selectedCategory === entry.name}
                count={entry.count}
                name={entry.name}
                onClick={() => setSelectedCategory(entry.name)}
              />
            ))}
          </div>
        </section>

        {!isFocusedBrowse ? (
          <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                  Recommendations
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                  Featured reading picks
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                  These cards stay visible only while the browse view is broad.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/category")}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-emerald-200 hover:text-emerald-700"
              >
                Open category page
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {featuredBooks.map((book) => {
                const availability = getAvailabilityState(book);
                const isReserved = reservedBookIds.has(book.id);
                const isSaving = activeReserveBookId === book.id;
                const canReserve = !isReserved && availability === "available";
                return (
                  <CatalogBookCard
                    key={book.id}
                    title={book.title}
                    subtitle={
                      book.subtitle ?? book.publisher ?? "Catalog record"
                    }
                    authorLine={`By ${formatAuthorLine(book.authors)}`}
                    coverImageUrl={book.coverImageUrl}
                    availabilityLabel={
                      isReserved
                        ? "Reserved"
                        : getAvailabilityLabel(availability)
                    }
                    availabilityTone={isReserved ? "reserved" : availability}
                    metaItems={[
                      formatPublicationLabel(
                        book.publicationDate,
                        book.publicationYear,
                      ),
                      `${book.availableCopies} available of ${book.totalCopies}`,
                      book.language ?? "Language not set",
                    ]}
                    actionLabel={
                      isSaving
                        ? "Saving..."
                        : canReserve
                          ? "Reserve"
                          : isReserved
                            ? "Reserved"
                            : "Unavailable"
                    }
                    actionDisabled={!canReserve || isSaving}
                    hasBorrowedBefore={borrowedHistoryBookIds.has(book.id)}
                    onOpenDetails={() => navigate(`/books/${book.id}`)}
                    onAction={() => {
                      void handleReserveBook(book.id);
                    }}
                  />
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                Focused Results
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                {selectedCategory === "all"
                  ? "Browse matching titles"
                  : `${selectedCategory} collection`}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Clean, badge-driven cards keep the catalog easy to scan.
              </p>
            </div>
            <p className="text-sm font-medium text-slate-500">
              {filteredBooks.length} books
            </p>
          </div>

          {/* ADDED: skeleton when first loading — condition guards against empty-filter false positives */}
          {isFetching && books.length === 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }, (_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-[1.35rem] border border-slate-100 bg-slate-100 h-72"
                />
              ))}
            </div>
          ) : filteredBooks.length === 0 ? (
            <div className="rounded-[1.6rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
              No books match the current search and filter combination.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              {filteredBooks.map((book) => {
                const availability = getAvailabilityState(book);
                const isReserved = reservedBookIds.has(book.id);
                const isSaving = activeReserveBookId === book.id;
                const canReserve = !isReserved && availability === "available";
                return (
                  <CatalogBookCard
                    key={book.id}
                    title={book.title}
                    subtitle={
                      book.subtitle ?? book.publisher ?? "Catalog record"
                    }
                    authorLine={`By ${formatAuthorLine(book.authors)}`}
                    coverImageUrl={book.coverImageUrl}
                    availabilityLabel={
                      isReserved
                        ? "Reserved"
                        : getAvailabilityLabel(availability)
                    }
                    availabilityTone={isReserved ? "reserved" : availability}
                    metaItems={[
                      formatPublicationLabel(
                        book.publicationDate,
                        book.publicationYear,
                      ),
                      `${book.availableCopies} available of ${book.totalCopies}`,
                      book.categories.slice(0, 2).join(" / ") ||
                        "Uncategorized",
                    ]}
                    actionLabel={
                      isSaving
                        ? "Saving..."
                        : canReserve
                          ? "Reserve"
                          : isReserved
                            ? "Reserved"
                            : "Unavailable"
                    }
                    actionDisabled={!canReserve || isSaving}
                    hasBorrowedBefore={borrowedHistoryBookIds.has(book.id)}
                    onOpenDetails={() => navigate(`/books/${book.id}`)}
                    onAction={() => {
                      void handleReserveBook(book.id);
                    }}
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>
    </LibraryWorkspaceLayout>
  );
}
