import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Session } from "@supabase/supabase-js";
import { hasSupabaseEnv, supabase } from "../lib/supabase";
import PortalLiveIndicator from "../components/PortalLiveIndicator";
import LibraryWorkspaceLayout from "../components/LibraryWorkspaceLayout";
import { useReservationNotifier } from "../hooks/useReservationNotifier";

type DashboardMetrics = {
  availableBooks: number;
  activeReservations: number;
  readyForPickup: number;
  totalRequests: number;
};

type ReservationBook = {
  id: string;
  title: string;
  subtitle: string | null;
  isbn: string | null;
  cover_image_url: string | null;
};

type RecentReservation = {
  id: string;
  status: string;
  requested_at: string;
  updated_at: string;
  expires_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  queue_position: number | null;
  notes: string | null;
  books: ReservationBook | ReservationBook[] | null;
};

type LoadSource = "manual" | "live";
type ActivityFilter = "all" | "pending" | "ready_for_pickup" | "cancelled" | "fulfilled";

const activeReservationStatuses = ["pending", "ready_for_pickup"];

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

function formatStatus(status: string) {
  return status
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function normalizeReservationBook(book: RecentReservation["books"]): ReservationBook | null {
  if (!book) return null;
  return Array.isArray(book) ? book[0] ?? null : book;
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

export default function DashboardPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [dataError, setDataError] = useState("");
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    availableBooks: 0,
    activeReservations: 0,
    readyForPickup: 0,
    totalRequests: 0
  });
  const [recentReservations, setRecentReservations] = useState<RecentReservation[]>([]);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      if (!hasSupabaseEnv) {
        setIsLoading(false);
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
      setIsLoading(false);
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

  const loadDashboardData = useCallback(
    async (source: LoadSource = "manual") => {
      if (!session?.user.id) return;

      if (source === "manual") {
        setIsDataLoading(true);
      } else {
        setIsLiveSyncing(true);
      }

      const [availableBooksResult, activeResult, readyResult, totalResult, recentResult] =
        await Promise.all([
          supabase
            .from("books")
            .select("id", { count: "exact", head: true })
            .gt("available_copies", 0),
          supabase
            .from("reservations")
            .select("id", { count: "exact", head: true })
            .eq("user_id", session.user.id)
            .in("status", activeReservationStatuses),
          supabase
            .from("reservations")
            .select("id", { count: "exact", head: true })
            .eq("user_id", session.user.id)
            .eq("status", "ready_for_pickup"),
          supabase
            .from("reservations")
            .select("id", { count: "exact", head: true })
            .eq("user_id", session.user.id),
          supabase
            .from("reservations")
            .select(
              "id,status,requested_at,updated_at,expires_at,fulfilled_at,cancelled_at,queue_position,notes,books(id,title,subtitle,isbn,cover_image_url)"
            )
            .eq("user_id", session.user.id)
            .order("requested_at", { ascending: false })
            .limit(8)
        ]);

      const firstError =
        availableBooksResult.error ??
        activeResult.error ??
        readyResult.error ??
        totalResult.error ??
        recentResult.error;

      if (firstError) {
        setDataError(firstError.message);
      } else {
        setDataError("");
      }

      setMetrics({
        availableBooks: availableBooksResult.count ?? 0,
        activeReservations: activeResult.count ?? 0,
        readyForPickup: readyResult.count ?? 0,
        totalRequests: totalResult.count ?? 0
      });

      setRecentReservations((recentResult.data ?? []) as RecentReservation[]);
      setLastSyncedAt(new Date().toISOString());

      if (source === "manual") {
        setIsDataLoading(false);
      } else {
        setIsLiveSyncing(false);
      }
    },
    [session?.user.id]
  );

  useEffect(() => {
    if (!session?.user.id) return;
    void loadDashboardData("manual");
  }, [session?.user.id, loadDashboardData]);

  useEffect(() => {
    if (!session?.user.id || !hasSupabaseEnv) return;

    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const queueLiveRefresh = () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }

      refreshTimeout = window.setTimeout(() => {
        void loadDashboardData("live");
      }, 320);
    };

    const channel = supabase
      .channel(`dashboard-realtime-${session.user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "books" },
        queueLiveRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `user_id=eq.${session.user.id}`
        },
        queueLiveRefresh
      )
      .subscribe();

    return () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id, loadDashboardData]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const userEmail = session?.user.email ?? "student@vsu.edu.ph";
  const notifier = useReservationNotifier(session?.user.id);

  const filteredRecentReservations = useMemo(() => {
    if (activityFilter === "all") return recentReservations;
    return recentReservations.filter((entry) => entry.status === activityFilter);
  }, [recentReservations, activityFilter]);

  const activityCounts = useMemo(() => {
    return {
      all: recentReservations.length,
      pending: recentReservations.filter((entry) => entry.status === "pending").length,
      ready_for_pickup: recentReservations.filter((entry) => entry.status === "ready_for_pickup").length,
      cancelled: recentReservations.filter((entry) => entry.status === "cancelled").length,
      fulfilled: recentReservations.filter((entry) => entry.status === "fulfilled").length
    };
  }, [recentReservations]);

  if (!hasSupabaseEnv) {
    return (
      <main className="portal-page">
        <section className="portal-shell portal-single">
          <article className="portal-panel">
            <h1>Supabase not configured</h1>
            <p>Add your values in `web/.env` before using authentication features.</p>
          </article>
        </section>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="portal-page">
        <section className="portal-shell portal-single">
          <article className="portal-panel">
            <h1>Loading dashboard...</h1>
          </article>
        </section>
      </main>
    );
  }

  return (
    <LibraryWorkspaceLayout
      activeRoute="dashboard"
      activeMenuKey="library"
      title="Student Dashboard"
      description="Track reservations, monitor availability, and jump quickly into search or reservation actions."
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
        { label: "Available Books", value: String(metrics.availableBooks) },
        { label: "Active Reservations", value: String(metrics.activeReservations) }
      ]}
      sidebarAction={{
        label: isDataLoading ? "Refreshing..." : "Refresh Data",
        onClick: () => {
          void loadDashboardData("manual");
        },
        disabled: isDataLoading
      }}
      headerActions={
        <div className="discover-inline-actions">
          <button type="button" className="btn btn-soft btn-small" onClick={() => navigate("/search")}>
            Open Discover
          </button>
          <button
            type="button"
            className="btn btn-soft btn-small"
            onClick={() => navigate("/reservations")}
          >
            Open Reservations
          </button>
        </div>
      }
      statusBar={
        <PortalLiveIndicator
          isSyncing={isLiveSyncing}
          text={`${isLiveSyncing ? "Syncing live updates..." : "Live availability active"} | ${formatLastSync(lastSyncedAt)}`}
        />
      }
      notice={dataError ? <p className="status error portal-notice">{dataError}</p> : undefined}
      onNavigate={(route) => navigate(`/${route}`)}
      onSignOut={handleSignOut}
    >
      <section className="discover-stat-strip" aria-label="Dashboard metrics">
        <article className="discover-stat-card">
          <span>Available Books</span>
          <strong>{metrics.availableBooks}</strong>
        </article>
        <article className="discover-stat-card">
          <span>Active Reservations</span>
          <strong>{metrics.activeReservations}</strong>
        </article>
        <article className="discover-stat-card">
          <span>Ready For Pickup</span>
          <strong>{metrics.readyForPickup}</strong>
        </article>
      </section>

      <section className="discover-section" aria-label="Recent reservation activity">
        <header className="discover-section-head">
          <h2>Recent Reservation Activity</h2>
          <div className="activity-filter" role="tablist" aria-label="Transaction status filter">
            <button
              type="button"
              role="tab"
              aria-selected={activityFilter === "all"}
              className={`activity-filter-btn ${activityFilter === "all" ? "active" : ""}`.trim()}
              onClick={() => setActivityFilter("all")}
            >
              All ({activityCounts.all})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activityFilter === "pending"}
              className={`activity-filter-btn ${activityFilter === "pending" ? "active" : ""}`.trim()}
              onClick={() => setActivityFilter("pending")}
            >
              Pending ({activityCounts.pending})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activityFilter === "ready_for_pickup"}
              className={`activity-filter-btn ${activityFilter === "ready_for_pickup" ? "active" : ""}`.trim()}
              onClick={() => setActivityFilter("ready_for_pickup")}
            >
              Ready for pickup ({activityCounts.ready_for_pickup})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activityFilter === "cancelled"}
              className={`activity-filter-btn ${activityFilter === "cancelled" ? "active" : ""}`.trim()}
              onClick={() => setActivityFilter("cancelled")}
            >
              Cancelled ({activityCounts.cancelled})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activityFilter === "fulfilled"}
              className={`activity-filter-btn ${activityFilter === "fulfilled" ? "active" : ""}`.trim()}
              onClick={() => setActivityFilter("fulfilled")}
            >
              Fulfilled ({activityCounts.fulfilled})
            </button>
          </div>
        </header>

        {filteredRecentReservations.length === 0 ? (
          <p className="empty-state">No reservation activity yet. Start by reserving a book.</p>
        ) : (
          <ul className="activity-list">
            {filteredRecentReservations.map((item) => {
              const linkedBook = normalizeReservationBook(item.books);

              return (
                <li key={item.id} className="activity-item activity-item-transaction">
                  <div
                    className={`activity-book-cover ${getToneClass(item.id)} ${linkedBook?.cover_image_url ? "has-image" : ""}`.trim()}
                    style={
                      linkedBook?.cover_image_url
                        ? {
                            backgroundImage: `linear-gradient(165deg, rgba(7, 66, 52, 0.42), rgba(7, 66, 52, 0.08)), url(${linkedBook.cover_image_url})`
                          }
                        : undefined
                    }
                    aria-hidden="true"
                  >
                    {!linkedBook?.cover_image_url ? <span>{getBookMonogram(linkedBook?.title ?? "Book")}</span> : null}
                  </div>

                  <div className="activity-transaction-main">
                    <div className="activity-transaction-head">
                      <div>
                        <p className="activity-title">{linkedBook?.title ?? "Unknown book"}</p>
                        <p className="activity-subtitle">{linkedBook?.subtitle ?? "No subtitle"}</p>
                      </div>
                      <span className={`status-pill status-${item.status}`}>{formatStatus(item.status)}</span>
                    </div>

                    <div className="activity-meta-grid">
                      <p className="activity-meta"><strong>Transaction ID:</strong> {item.id.slice(0, 8).toUpperCase()}</p>
                      <p className="activity-meta"><strong>ISBN:</strong> {linkedBook?.isbn ?? "N/A"}</p>
                      <p className="activity-meta"><strong>Requested:</strong> {formatDate(item.requested_at)}</p>
                      <p className="activity-meta"><strong>Last update:</strong> {formatDate(item.updated_at)}</p>
                      <p className="activity-meta">
                        <strong>Queue position:</strong> {item.queue_position ?? "Not assigned"}
                      </p>
                      <p className="activity-meta">
                        <strong>Expires:</strong> {item.expires_at ? formatDate(item.expires_at) : "No expiry"}
                      </p>
                      <p className="activity-meta">
                        <strong>Fulfilled:</strong> {item.fulfilled_at ? formatDate(item.fulfilled_at) : "Not yet"}
                      </p>
                      <p className="activity-meta">
                        <strong>Cancelled:</strong> {item.cancelled_at ? formatDate(item.cancelled_at) : "No"}
                      </p>
                    </div>

                    {item.notes ? <p className="activity-meta"><strong>Notes:</strong> {item.notes}</p> : null}

                    <div className="activity-actions">
                      <button
                        type="button"
                        className="btn btn-soft btn-small"
                        onClick={() => {
                          if (linkedBook?.id) {
                            navigate(`/books/${linkedBook.id}`);
                          }
                        }}
                        disabled={!linkedBook?.id}
                      >
                        View book details
                      </button>
                      <button type="button" className="btn btn-soft btn-small" onClick={() => navigate("/reservations")}>
                        Open reservations
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="discover-section" aria-label="Quick actions">
        <header className="discover-section-head">
          <h2>Quick Actions</h2>
        </header>

        <div className="quick-actions-grid">
          <button type="button" className="quick-action" onClick={() => navigate("/search")}>
            <strong>Search Catalog</strong>
            <span>Filter by category, language, and availability.</span>
          </button>
          <button type="button" className="quick-action" onClick={() => navigate("/reservations")}>
            <strong>Reserve a Book</strong>
            <span>Browse available titles and request copies.</span>
          </button>
          <button
            type="button"
            className="quick-action"
            onClick={() => {
              void loadDashboardData("manual");
            }}
          >
            <strong>Sync Data</strong>
            <span>Refresh availability and reservation status.</span>
          </button>
        </div>
      </section>
    </LibraryWorkspaceLayout>
  );
}


