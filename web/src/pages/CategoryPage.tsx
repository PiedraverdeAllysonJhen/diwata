import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
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

type LoadSource = "manual" | "live";
type AvailabilityState = "available" | "borrowed" | "reserved";

type CategoryCount = {
  id: string;
  name: string;
  count: number;
  availableCount: number;
};

type Notice = {
  type: "success" | "error";
  text: string;
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
  return Array.from(values).sort((l, r) => l.localeCompare(r));
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
    authors: normalizeAuthors(record.book_authors),
  };
}

function getAvailabilityState(
  book: Pick<BookRecord, "copyStatuses" | "availableCopies" | "totalCopies">,
): AvailabilityState {
  const statusSet = new Set(book.copyStatuses);
  if (statusSet.has("available")) return "available";
  if (statusSet.has("borrowed")) return "borrowed";
  if (statusSet.has("reserved")) return "reserved";
  if (book.availableCopies > 0) return "available";
  if (book.totalCopies > 0) return "borrowed";
  return "reserved";
}

function getAvailabilityLabel(status: AvailabilityState) {
  if (status === "available") return "Available";
  if (status === "borrowed") return "Borrowed";
  return "Reserved";
}

function formatLastSync(value: string | null) {
  if (!value) return "Waiting for first sync";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waiting for first sync";
  return `Last sync ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
}

function CategoryIcon({ name }: { name: string }) {
  const normalized = name.toLowerCase();
  const cls = "h-5 w-5";
  if (normalized.includes("science") || normalized.includes("research"))
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={cls}
      >
        <path d="M9 3h6" />
        <path d="M10 3v5l-5.5 8.8A3 3 0 0 0 7 21h10a3 3 0 0 0 2.5-4.2L14 8V3" />
        <path d="M8.5 14h7" />
      </svg>
    );
  if (normalized.includes("history") || normalized.includes("culture"))
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={cls}
      >
        <path d="M6 4.5A2.5 2.5 0 0 1 8.5 2H20v16.5A2.5 2.5 0 0 0 17.5 16H6Z" />
        <path d="M6 4.5V22" />
        <path d="M10 7h6" />
        <path d="M10 11h6" />
      </svg>
    );
  if (normalized.includes("technology") || normalized.includes("computer"))
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={cls}
      >
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8" />
        <path d="M12 16v4" />
      </svg>
    );
  if (
    normalized.includes("art") ||
    normalized.includes("design") ||
    normalized.includes("literature")
  )
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={cls}
      >
        <path d="M12 3c4 0 7 3.4 7 7.4 0 5.2-7 10.6-7 10.6S5 15.6 5 10.4C5 6.4 8 3 12 3Z" />
        <circle cx="12" cy="10" r="2.2" />
      </svg>
    );
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={cls}
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
  children?: ReactNode;
}) {
  return (
    <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
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

export default function CategoryPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [reservedBookIds, setReservedBookIds] = useState<Set<string>>(
    new Set(),
  );
  const [borrowedHistoryBookIds, setBorrowedHistoryBookIds] = useState<
    Set<string>
  >(new Set());
  const [activeReserveBookId, setActiveReserveBookId] = useState<string | null>(
    null,
  );
  const [reservationBook, setReservationBook] = useState<BookRecord | null>(
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

  const loadData = useCallback(
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
            "reserved",
            "queued",
            "picked_up",
            "fulfilled",
            "returned",
            "expired",
          ]),
      ]);

      const firstError =
        booksResult.error ?? categoriesResult.error ?? historyResult.error;
      if (firstError) {
        setNotice({ type: "error", text: firstError.message });
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
      setNotice(null);
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
    void loadData("manual");
  }, [loadData, session?.user.id]);

  useEffect(() => {
    if (!session?.user.id || !hasSupabaseEnv) return;
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const queueLiveRefresh = () => {
      if (refreshTimeout) window.clearTimeout(refreshTimeout);
      refreshTimeout = window.setTimeout(() => {
        void loadData("live");
      }, 320);
    };
    const channel = supabase
      .channel(`category-realtime-${session.user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "books" },
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
  }, [loadData, session?.user.id]);

  useEffect(() => {
    if (selectedCategory === "all") return;
    if (!categories.some((c) => c.name === selectedCategory))
      setSelectedCategory("all");
  }, [categories, selectedCategory]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, { total: number; available: number }>();
    for (const category of categories)
      counts.set(category.name, { total: 0, available: 0 });
    for (const book of books) {
      for (const category of new Set(book.categories)) {
        const v = counts.get(category) ?? { total: 0, available: 0 };
        v.total += 1;
        if (getAvailabilityState(book) === "available") v.available += 1;
        counts.set(category, v);
      }
    }
    return Array.from(counts.entries())
      .filter(([, v]) => v.total > 0)
      .map(([name, v]) => ({
        id: categories.find((c) => c.name === name)?.id ?? name,
        name,
        count: v.total,
        availableCount: v.available,
      }))
      .sort((l, r) => r.count - l.count || l.name.localeCompare(r.name));
  }, [books, categories]);

  const filteredBooks = useMemo(() => {
    if (selectedCategory === "all") return books;
    return books.filter((book) => book.categories.includes(selectedCategory));
  }, [books, selectedCategory]);

  const selectedCategorySummary = useMemo(() => {
    if (selectedCategory === "all")
      return {
        title: "All category shelves",
        description:
          "Choose an icon to focus the grid, or keep the full institutional collection visible.",
      };
    const activeEntry = categoryCounts.find((e) => e.name === selectedCategory);
    return {
      title: selectedCategory,
      description: `${activeEntry?.availableCount ?? 0} available out of ${activeEntry?.count ?? 0} catalog titles.`,
    };
  }, [categoryCounts, selectedCategory]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const openReservationModal = (book: BookRecord) => {
    setNotice(null);
    setReservationBook(book);
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
      title="Category Browse"
      description="Icon-driven category navigation and a cleaner large-grid browsing experience."
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
          void loadData("manual");
        },
        disabled: isFetching,
      }}
      statusBar={
        <PortalLiveIndicator
          isSyncing={isLiveSyncing}
          text={`${isLiveSyncing ? "Syncing categories..." : "Category browse synced"} | ${formatLastSync(lastSyncedAt)}`}
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
        <SectionCard
          eyebrow="Category Navigation"
          title="Choose a shelf icon and go straight to the books"
          description="The category page now behaves like a focused browse studio instead of a text-heavy catalog dump."
        >
          <div className="text-xs text-slate-500">
            {filteredBooks.length} visible titles
          </div>
        </SectionCard>

        <section className="slider-card rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
          <div className="mobile-slider-rail category-slider-rail" aria-label="Category slider">
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

        <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                Filtered Shelf
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                {selectedCategorySummary.title}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {selectedCategorySummary.description}
              </p>
            </div>
            {selectedCategory !== "all" ? (
              <button
                type="button"
                onClick={() => setSelectedCategory("all")}
                className="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 transition hover:text-emerald-700"
              >
                Reset category
              </button>
            ) : null}
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
              No books are available for this category right now.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              {filteredBooks.map((book) => {
                const availability = getAvailabilityState(book);
                const isReserved = reservedBookIds.has(book.id);
                const isSaving = activeReserveBookId === book.id;
                const canReserve = availability === "available";
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
                      !canReserve
                        ? "Unavailable"
                        : isReserved
                          ? "Reserved"
                          : isSaving
                            ? "Saving..."
                            : "Reserve"
                    }
                    actionDisabled={!canReserve || isReserved || isSaving}
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
          onError={(message) => setNotice({ type: "error", text: message })}
          onComplete={async (bookId, _status, message) => {
            setReservedBookIds((previous) => new Set([...previous, bookId]));
            setReservationBook(null);
            await loadData("live");
            setNotice({ type: "success", text: message });
          }}
        />
      ) : null}
    </LibraryWorkspaceLayout>
  );
}
