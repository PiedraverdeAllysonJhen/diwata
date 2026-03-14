import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Session } from "@supabase/supabase-js";
import { hasSupabaseEnv, supabase } from "../lib/supabase";

type DashboardMetrics = {
  availableBooks: number;
  activeReservations: number;
  readyForPickup: number;
  totalRequests: number;
};

type RecentReservation = {
  id: string;
  status: string;
  requested_at: string;
  books: {
    title: string;
    subtitle: string | null;
  } | null;
};

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

export default function DashboardPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    availableBooks: 0,
    activeReservations: 0,
    readyForPickup: 0,
    totalRequests: 0
  });
  const [recentReservations, setRecentReservations] = useState<RecentReservation[]>([]);

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

  const loadDashboardData = useCallback(async () => {
    if (!session?.user.id) return;

    setIsDataLoading(true);

    const [availableBooksResult, activeResult, readyResult, totalResult, recentResult] =
      await Promise.all([
        supabase.from("books").select("id", { count: "exact", head: true }).gt("available_copies", 0),
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
          .select("id,status,requested_at,books(title,subtitle)")
          .eq("user_id", session.user.id)
          .order("requested_at", { ascending: false })
          .limit(5)
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
    setIsDataLoading(false);
  }, [session?.user.id]);

  useEffect(() => {
    if (!session?.user.id) return;
    void loadDashboardData();
  }, [session?.user.id, loadDashboardData]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const userEmail = session?.user.email ?? "student@vsu.edu.ph";

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
    <main className="portal-page">
      <div className="portal-shell">
        <header className="portal-topbar">
          <button type="button" className="portal-brand" onClick={() => navigate("/dashboard")}> 
            <img src="/assets/bookitstudent-logo.jpg" alt="BookItStudent logo" />
            <span>
              <strong>BookItStudent</strong>
              <em>Visayas State University</em>
            </span>
          </button>

          <nav className="portal-nav" aria-label="Primary navigation">
            <button type="button" className="portal-nav-item active" onClick={() => navigate("/dashboard")}> 
              Dashboard
            </button>
            <button
              type="button"
              className="portal-nav-item"
              onClick={() => navigate("/reservations")}
            >
              Reservations
            </button>
          </nav>

          <div className="portal-user-controls">
            <p className="portal-user-email" title={userEmail}>
              {userEmail}
            </p>
            <button type="button" className="btn btn-primary btn-small" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </header>

        <section className="portal-hero">
          <div className="portal-hero-copy">
            <p className="eyebrow">Learning Commons Portal</p>
            <h1>Student Dashboard</h1>
            <p>
              Check your reservation progress, monitor available books, and jump directly to the
              reservation workspace.
            </p>
            <div className="portal-hero-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate("/reservations")}
              >
                Open reservation workspace
              </button>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => {
                  void loadDashboardData();
                }}
                disabled={isDataLoading}
              >
                {isDataLoading ? "Refreshing..." : "Refresh data"}
              </button>
            </div>
            {dataError ? <p className="status error portal-notice">{dataError}</p> : null}
          </div>

          <div className="portal-kpis" aria-label="Dashboard metrics">
            <article className="kpi-card">
              <span>Available Books</span>
              <strong>{metrics.availableBooks}</strong>
            </article>
            <article className="kpi-card">
              <span>Active Reservations</span>
              <strong>{metrics.activeReservations}</strong>
            </article>
            <article className="kpi-card">
              <span>Ready for Pickup</span>
              <strong>{metrics.readyForPickup}</strong>
            </article>
            <article className="kpi-card">
              <span>Total Requests</span>
              <strong>{metrics.totalRequests}</strong>
            </article>
          </div>
        </section>

        <section className="portal-content-grid">
          <article className="portal-panel">
            <header className="panel-heading">
              <h2>Recent Reservation Activity</h2>
              <p>Latest reservation requests under your account.</p>
            </header>

            {recentReservations.length === 0 ? (
              <p className="empty-state">No reservation activity yet. Start by reserving a book.</p>
            ) : (
              <ul className="activity-list">
                {recentReservations.map((item) => (
                  <li key={item.id} className="activity-item">
                    <div>
                      <p className="activity-title">{item.books?.title ?? "Unknown book"}</p>
                      <p className="activity-meta">Requested: {formatDate(item.requested_at)}</p>
                    </div>
                    <span className={`status-pill status-${item.status}`}>{formatStatus(item.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="portal-panel portal-panel-secondary">
            <header className="panel-heading">
              <h2>Quick Actions</h2>
              <p>Common tasks for faster workflows.</p>
            </header>

            <div className="quick-actions-grid">
              <button
                type="button"
                className="quick-action"
                onClick={() => navigate("/reservations")}
              >
                <strong>Reserve a Book</strong>
                <span>Browse available titles and request copies.</span>
              </button>
              <button
                type="button"
                className="quick-action"
                onClick={() => navigate("/reservations")}
              >
                <strong>Manage Queue</strong>
                <span>Cancel active reservations or track pickup readiness.</span>
              </button>
              <button
                type="button"
                className="quick-action"
                onClick={() => {
                  void loadDashboardData();
                }}
              >
                <strong>Sync Data</strong>
                <span>Refresh availability and reservation status.</span>
              </button>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
