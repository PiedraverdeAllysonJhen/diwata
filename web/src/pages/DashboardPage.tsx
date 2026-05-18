import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import LibraryWorkspaceLayout from "../components/LibraryWorkspaceLayout";
import PortalLiveIndicator from "../components/PortalLiveIndicator";
import { useReservationNotifier } from "../hooks/useReservationNotifier";
import { hasSupabaseEnv, supabase } from "../lib/supabase";
import { BookStatus } from "../types/library";

type ReservationBook = {
  id: string;
  title: string;
  subtitle: string | null;
  cover_image_url: string | null;
};

type LibraryReservationStatus = "pending" | "ready_for_pickup" | "fulfilled" | "cancelled" | "expired";

type ReservationRecord = {
  id: string;
  status: LibraryReservationStatus;
  requested_at: string;
  expires_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  books: ReservationBook | ReservationBook[] | null;
};

type LibraryBookItem = {
  id: string;
  bookId: string;
  title: string;
  coverImageUrl: string | null;
  borrowDate: string | null;
  returnDate: string | null;
  status: BookStatus;
};

type LoadSource = "manual" | "live";

const INITIAL_VISIBLE_ITEMS = 5;

function normalizeReservationBook(book: ReservationRecord["books"]): ReservationBook | null {
  if (!book) return null;
  return Array.isArray(book) ? book[0] ?? null : book;
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

function formatDate(value: string | null) {
  if (!value) return "Not available";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function getBookMonogram(title: string) {
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

function mapReservationStatusToBookStatus(status: LibraryReservationStatus): BookStatus {
  if (status === "pending" || status === "ready_for_pickup") return "pending";
  if (status === "cancelled") return "cancelled";
  if (status === "expired") return "overdue";
  return "returned";
}

function normalizeReservationRecord(record: ReservationRecord): LibraryBookItem | null {
  const linkedBook = normalizeReservationBook(record.books);
  if (!linkedBook?.id) return null;

  const status = mapReservationStatusToBookStatus(record.status);

  return {
    id: record.id,
    bookId: linkedBook.id,
    title: linkedBook.title,
    coverImageUrl: linkedBook.cover_image_url,
    borrowDate: record.requested_at,
    returnDate:
      status === "pending"
        ? record.expires_at
        : status === "cancelled"
        ? record.cancelled_at
        : status === "returned"
        ? record.fulfilled_at
        : record.expires_at,
    status
  };
}

function StatusIcon({ status }: { status: BookStatus }) {
  const shared = "h-5 w-5";

  if (status === "pending") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={shared}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2.5" />
      </svg>
    );
  }

  if (status === "cancelled") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={shared}>
        <circle cx="12" cy="12" r="8" />
        <path d="m9 9 6 6" />
        <path d="m15 9-6 6" />
      </svg>
    );
  }

  if (status === "returned") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={shared}>
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12.5 2.2 2.2 4.8-5.2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={shared}>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.8 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

function getStatusColors(status: BookStatus) {
  if (status === "pending") {
    return "border-emerald-200 bg-emerald-700 text-white shadow-lg shadow-emerald-700/20";
  }

  if (status === "cancelled") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  if (status === "returned") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  return "border-amber-200 bg-amber-50 text-amber-700";
}

function getStatusLabel(status: BookStatus) {
  if (status === "pending") return "Pending";
  if (status === "cancelled") return "Cancelled";
  if (status === "returned") return "Returned";
  return "Overdue";
}

function StatusFilterButton({
  active,
  count,
  status,
  onClick
}: {
  active: boolean;
  count: number;
  status: BookStatus;
  onClick: () => void;
}) {
  const label = getStatusLabel(status);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex w-[88px] flex-col items-center gap-1.5 text-center"
    >
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-2xl border transition ${
          active
            ? "border-emerald-600 bg-emerald-700 text-white shadow-lg shadow-emerald-700/25"
            : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:text-emerald-700"
        }`}
      >
        <StatusIcon status={status} />
      </span>
      <span className={`text-xs font-medium ${active ? "text-emerald-700" : "text-slate-600"}`}>{label}</span>
      <span className="text-[11px] text-slate-400">{count} records</span>
    </button>
  );
}

function LibraryHistoryCard({ item }: { item: LibraryBookItem }) {
  return (
    <article className="flex h-full min-h-[168px] flex-row items-center gap-3 rounded-[1.25rem] border border-slate-200 bg-white p-3.5 shadow-[0_14px_38px_rgba(15,23,42,0.06)]">
      <div
        className={`relative flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br ${getToneClasses(
          item.bookId
        )} text-sm font-semibold tracking-[0.2em] text-white/90 shadow-sm ring-1 ring-slate-200/80`}
      >
        {item.coverImageUrl ? (
          <>
            <img
              src={item.coverImageUrl}
              alt={`${item.title} cover`}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-slate-950/5 via-slate-950/15 to-slate-950/35" />
          </>
        ) : (
          <span className="relative z-10">{getBookMonogram(item.title)}</span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 text-sm font-semibold tracking-tight text-slate-900">{item.title}</h3>
        <div className="mt-3 space-y-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Borrow date</p>
            <p className="text-sm text-slate-600">{formatDate(item.borrowDate)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Return date</p>
            <p className="text-sm text-slate-600">{formatDate(item.returnDate)}</p>
          </div>
        </div>
      </div>
    </article>
  );
}

function SectionCard({
  eyebrow,
  title,
  description,
  children
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">{eyebrow}</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [libraryItems, setLibraryItems] = useState<LibraryBookItem[]>([]);
  const [activeStatus, setActiveStatus] = useState<BookStatus>("pending");
  const [expandedSections, setExpandedSections] = useState<Record<BookStatus, boolean>>({
    pending: false,
    cancelled: false,
    returned: false,
    overdue: false
  });

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

  const loadLibraryData = useCallback(
    async (source: LoadSource = "manual") => {
      if (!session?.user.id) return;

      if (source === "manual") {
        setIsFetching(true);
      } else {
        setIsLiveSyncing(true);
      }

      const reservationsResult = await supabase
        .from("reservations")
        .select("id,status,requested_at,expires_at,fulfilled_at,cancelled_at,books(id,title,subtitle,cover_image_url)")
        .eq("user_id", session.user.id)
        .in("status", ["pending", "ready_for_pickup", "fulfilled", "cancelled", "expired"])
        .order("requested_at", { ascending: false });

      if (reservationsResult.error) {
        setNotice(reservationsResult.error.message);
      } else {
        const nextItems = ((reservationsResult.data ?? []) as ReservationRecord[])
          .map(normalizeReservationRecord)
          .filter((item): item is LibraryBookItem => item !== null);

        setLibraryItems(nextItems);
        setNotice("");
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
    void loadLibraryData("manual");
  }, [loadLibraryData, session?.user.id]);

  useEffect(() => {
    if (!session?.user.id || !hasSupabaseEnv) return;

    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const queueLiveRefresh = () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }

      refreshTimeout = window.setTimeout(() => {
        void loadLibraryData("live");
      }, 320);
    };

    const channel = supabase
      .channel(`dashboard-realtime-${session.user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservations", filter: `user_id=eq.${session.user.id}` },
        queueLiveRefresh
      )
      .subscribe();

    return () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }
      void supabase.removeChannel(channel);
    };
  }, [loadLibraryData, session?.user.id]);

  const groupedItems = useMemo(() => {
    return {
      pending: libraryItems.filter((item) => item.status === "pending"),
      cancelled: libraryItems.filter((item) => item.status === "cancelled"),
      returned: libraryItems.filter((item) => item.status === "returned"),
      overdue: libraryItems.filter((item) => item.status === "overdue")
    } satisfies Record<BookStatus, LibraryBookItem[]>;
  }, [libraryItems]);

  const activeItems = groupedItems[activeStatus];
  const isExpanded = expandedSections[activeStatus];
  const visibleItems = isExpanded ? activeItems : activeItems.slice(0, INITIAL_VISIBLE_ITEMS);
  const shouldShowViewMore = activeItems.length > INITIAL_VISIBLE_ITEMS;

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
            <p>Add your values in `web/.env` before using library history features.</p>
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
            <h1>Loading library history...</h1>
          </article>
        </section>
      </main>
    );
  }

  return (
    <LibraryWorkspaceLayout
      activeRoute="dashboard"
      activeMenuKey="library"
      title="My Library"
      description="A cleaner institutional history view with compact status-driven rows instead of bulky transaction blocks."
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
        { label: "Records", value: String(libraryItems.length) },
        { label: "Current Tab", value: getStatusLabel(activeStatus) }
      ]}
      sidebarAction={{
        label: isFetching ? "Refreshing..." : "Refresh Data",
        onClick: () => {
          void loadLibraryData("manual");
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
          text={`${isLiveSyncing ? "Syncing library history..." : "Library history synced"} | ${formatLastSync(lastSyncedAt)}`}
        />
      }
      notice={notice ? <p className="status error portal-notice">{notice}</p> : undefined}
      onNavigate={(route) => navigate(`/${route}`)}
      onSignOut={handleSignOut}
    >
      <div className="space-y-5">
        <SectionCard
          eyebrow="Institutional View"
          title="Compact transaction history"
          description="Borrowing history is now grouped into four clean status buckets and tuned for fast review on large screens."
        />

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {(Object.entries(groupedItems) as Array<[BookStatus, LibraryBookItem[]]>).map(([status, items]) => (
            <article
              key={status}
              className={`rounded-[1.6rem] border p-4 transition ${getStatusColors(status)}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="rounded-2xl border border-current/15 bg-white/10 p-2">
                  <StatusIcon status={status} />
                </div>
                <strong className="text-2xl font-semibold tracking-tight">{items.length}</strong>
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.24em] opacity-80">{getStatusLabel(status)}</p>
            </article>
          ))}
        </section>

        <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
          <div className="flex flex-wrap items-center gap-3">
            {(["pending", "cancelled", "returned", "overdue"] as BookStatus[]).map((status) => (
              <StatusFilterButton
                key={status}
                active={activeStatus === status}
                count={groupedItems[status].length}
                status={status}
                onClick={() => setActiveStatus(status)}
              />
            ))}
          </div>
        </section>

        <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">Status Shelf</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">{getStatusLabel(activeStatus)}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Six compact cards fit neatly across large screens, with the final slot reserved for expansion when more items exist.
              </p>
            </div>
            <p className="text-sm font-medium text-slate-500">{activeItems.length} records</p>
          </div>

          {activeItems.length === 0 ? (
            <div className="rounded-[1.6rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
              No records are available in this status right now.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
              {visibleItems.map((item) => (
                <LibraryHistoryCard key={item.id} item={item} />
              ))}

              {shouldShowViewMore ? (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedSections((previous) => ({
                      ...previous,
                      [activeStatus]: !previous[activeStatus]
                    }))
                  }
                  className="flex h-full min-h-[180px] items-center justify-center rounded-[1.4rem] border border-dashed border-emerald-200 bg-emerald-50/70 px-4 text-center text-sm font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50"
                >
                  {isExpanded ? "Show Less" : `View More (${activeItems.length - INITIAL_VISIBLE_ITEMS})`}
                </button>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </LibraryWorkspaceLayout>
  );
}
