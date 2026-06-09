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
import ReservationCalendarModal from "../components/ReservationCalendarModal";
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
  created_at: string;
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
  createdAt: string;
  tags: string[];
  copyStatuses: string[];
  categories: string[];
  authors: string[];
};

type ReservationHistoryRow = {
  book_id: string;
  status:
    | "pending"
    | "approved"
    | "ready_for_pickup"
    | "reserved"
    | "queued"
    | "picked_up"
    | "fulfilled"
    | "returned"
    | "expired";
};

type FilterAvailability = "all" | "available" | "borrowed" | "reserved";
type LoadSource = "manual" | "live";
type AvailabilityState = Exclude<FilterAvailability, "all">;

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
    createdAt: record.created_at,
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
  const [reservedBookIds, setReservedBookIds] = useState<Set<string>>(
    new Set(),
  );
  const [borrowedHistoryBookIds, setBorrowedHistoryBookIds] = useState<
    Set<string>
  >(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] =
    useState<FilterAvailability>("all");
  const [activeReserveBookId, setActiveReserveBookId] = useState<string | null>(
    null,
  );
  const [reservationBook, setReservationBook] = useState<SearchBook | null>(
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

      const [booksResult, historyResult] = await Promise.all([
        supabase
          .from("books")
          .select(
            "id,isbn,title,subtitle,description,publisher,language,publication_year,publication_date,cover_image_url,available_copies,total_copies,created_at,tags,book_copies(status),book_categories(category_id,categories(id,name)),book_authors(author_id,authors(id,name))",
          )
          .order("title", { ascending: true })
          .limit(300),
        supabase
          .from("reservations")
          .select("book_id,status")
          .eq("user_id", session.user.id)
          .in("status", [
            "pending",
            "approved",
            "ready_for_pickup",
            "reserved",
            "queued",
            "picked_up",
            "fulfilled",
            "returned",
            "expired",
          ]),
      ]);

      const firstError = booksResult.error ?? historyResult.error;
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
      setReservedBookIds(
        new Set(
          reservationHistory
            .filter(
              (e) =>
                e.status === "approved" ||
                e.status === "pending" ||
                e.status === "ready_for_pickup" ||
                e.status === "reserved" ||
                e.status === "queued" ||
                e.status === "picked_up",
            )
            .map((e) => e.book_id),
        ),
      );
      setBorrowedHistoryBookIds(
        new Set(
          reservationHistory
            .filter(
              (e) =>
                e.status === "fulfilled" ||
                e.status === "returned" ||
                e.status === "expired",
            )
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
    selectedLanguage,
  ]);

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

  const newBooks = useMemo(() => {
    return [...books]
      .sort((l, r) => {
        const timeL = new Date(l.createdAt).getTime();
        const timeR = new Date(r.createdAt).getTime();
        if (timeL !== timeR) return timeR - timeL;
        return l.title.localeCompare(r.title);
      })
      .slice(0, 4);
  }, [books]);

  const isFocusedBrowse =
    searchQuery.trim().length > 0 ||
    selectedLanguage !== "all" ||
    availabilityFilter !== "all";

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearchQuery(searchInput.trim());
  };

  const handleClearBrowse = () => {
    setSearchInput("");
    setSearchQuery("");
    setSelectedLanguage("all");
    setAvailabilityFilter("all");
  };

  const openReservationModal = (book: SearchBook) => {
    setNotice("");
    setReservationBook(book);
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
        { label: "Matches", value: String(filteredBooks.length) },
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
          description="Search, language, and availability filters move you straight into a focused browsing grid."
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
        </section>

        {!isFocusedBrowse ? (
          <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                  New Books
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                  Recently added titles
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                  Fresh catalog records appear here as soon as they are added by the library team.
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {newBooks.map((book) => {
                const availability = getAvailabilityState(book);
                const isReserved = reservedBookIds.has(book.id);
                const isSaving = activeReserveBookId === book.id;
                const canReserve = !isReserved && availability === "available";
                return (
                  <CatalogBookCard
                    key={book.id}
                    title={book.title}
                    subtitle={book.subtitle ?? book.publisher ?? "New catalog record"}
                    authorLine={`By ${formatAuthorLine(book.authors)}`}
                    coverImageUrl={book.coverImageUrl}
                    availabilityLabel={isReserved ? "Reserved" : getAvailabilityLabel(availability)}
                    availabilityTone={isReserved ? "reserved" : availability}
                    metaItems={[
                      formatPublicationLabel(book.publicationDate, book.publicationYear),
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
                      openReservationModal(book);
                    }}
                  />
                );
              })}
            </div>
          </section>
        ) : null}

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
                      openReservationModal(book);
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
                Browse matching titles
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Clean, badge-driven cards keep the catalog easy to scan.
              </p>
            </div>
            <p className="text-sm font-medium text-slate-500">
              {filteredBooks.length} books
            </p>
          </div>

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
                      openReservationModal(book);
                    }}
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>
      {reservationBook ? (
        <ReservationCalendarModal
          bookId={reservationBook.id}
          title={reservationBook.title}
          totalCopies={reservationBook.totalCopies}
          onClose={() => setReservationBook(null)}
          onError={setNotice}
          onComplete={async (bookId, _status, message) => {
            setReservedBookIds((previous) => new Set([...previous, bookId]));
            setReservationBook(null);
            await loadCatalog("live");
            setNotice(message);
          }}
        />
      ) : null}
    </LibraryWorkspaceLayout>
  );
}
