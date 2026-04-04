import { useCallback, useEffect, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { hasSupabaseEnv, supabase } from "../lib/supabase";
import PortalLiveIndicator from "../components/PortalLiveIndicator";
import LibraryWorkspaceLayout from "../components/LibraryWorkspaceLayout";
import { useReservationNotifier } from "../hooks/useReservationNotifier";

type HelpMetrics = {
  activeReservations: number;
  totalFavorites: number;
  unreadAlerts: number;
};

type LoadSource = "manual" | "live";

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

export default function HelpPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [metrics, setMetrics] = useState<HelpMetrics>({
    activeReservations: 0,
    totalFavorites: 0,
    unreadAlerts: 0
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

  const loadHelpData = useCallback(
    async (source: LoadSource = "manual") => {
      if (!session?.user.id) return;

      if (source === "manual") {
        setIsFetching(true);
      } else {
        setIsLiveSyncing(true);
      }

      const [reservationsResult, favoritesResult, notificationsResult] = await Promise.all([
        supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", session.user.id)
          .in("status", ["pending", "ready_for_pickup"]),
        supabase
          .from("bookmarks")
          .select("book_id", { count: "exact", head: true })
          .eq("user_id", session.user.id),
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", session.user.id)
          .eq("is_read", false)
      ]);

      const firstError = reservationsResult.error ?? favoritesResult.error ?? notificationsResult.error;

      if (firstError) {
        setNotice(firstError.message);
      } else {
        setNotice("");
      }

      setMetrics({
        activeReservations: reservationsResult.count ?? 0,
        totalFavorites: favoritesResult.count ?? 0,
        unreadAlerts: notificationsResult.count ?? 0
      });
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
    void loadHelpData("manual");
  }, [session?.user.id, loadHelpData]);

  useEffect(() => {
    if (!session?.user.id || !hasSupabaseEnv) return;

    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const queueLiveRefresh = () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }

      refreshTimeout = window.setTimeout(() => {
        void loadHelpData("live");
      }, 300);
    };

    const channel = supabase
      .channel(`help-realtime-${session.user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservations", filter: `user_id=eq.${session.user.id}` },
        queueLiveRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookmarks", filter: `user_id=eq.${session.user.id}` },
        queueLiveRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${session.user.id}` },
        queueLiveRefresh
      )
      .subscribe();

    return () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id, loadHelpData]);

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
            <p>Add your values in `web/.env` before using the help center.</p>
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
            <h1>Loading help center...</h1>
          </article>
        </section>
      </main>
    );
  }

  return (
    <LibraryWorkspaceLayout
      activeRoute="help"
      activeMenuKey="help"
      title="Help Center"
      description="Get support for reservations, account settings, and catalog navigation."
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
        { label: "Active Reservations", value: String(metrics.activeReservations) },
        { label: "Unread Alerts", value: String(metrics.unreadAlerts) }
      ]}
      sidebarAction={{
        label: isFetching ? "Refreshing..." : "Refresh Data",
        onClick: () => {
          void loadHelpData("manual");
        },
        disabled: isFetching
      }}
      headerActions={
        <div className="discover-inline-actions">
          <button type="button" className="btn btn-soft btn-small" onClick={() => navigate("/dashboard")}>
            Open Dashboard
          </button>
          <button type="button" className="btn btn-soft btn-small" onClick={() => navigate("/settings")}>
            Open Settings
          </button>
        </div>
      }
      statusBar={
        <PortalLiveIndicator
          isSyncing={isLiveSyncing}
          text={`${isLiveSyncing ? "Syncing help data..." : "Support data ready"} | ${formatLastSync(lastSyncedAt)}`}
        />
      }
      notice={notice ? <p className="status error portal-notice">{notice}</p> : undefined}
      onNavigate={(route) => navigate(`/${route}`)}
      onSignOut={handleSignOut}
    >
      <section className="help-grid" aria-label="Help summary cards">
        <article className="help-card">
          <span>Open Reservations</span>
          <strong>{metrics.activeReservations}</strong>
          <p>Active requests you can manage in Reservation workspace.</p>
          <button type="button" className="btn btn-soft btn-small" onClick={() => navigate("/reservations")}>
            Go to reservations
          </button>
        </article>

        <article className="help-card">
          <span>Saved Favorites</span>
          <strong>{metrics.totalFavorites}</strong>
          <p>Books you bookmarked for quick access and future reservation.</p>
          <button type="button" className="btn btn-soft btn-small" onClick={() => navigate("/favorites")}>
            Open favorites
          </button>
        </article>

        <article className="help-card">
          <span>Unread Alerts</span>
          <strong>{metrics.unreadAlerts}</strong>
          <p>Reservation updates and reminders from your notification feed.</p>
          <button type="button" className="btn btn-soft btn-small" onClick={notifier.toggleOpen}>
            Open alerts
          </button>
        </article>
      </section>

      <section className="discover-section" aria-label="Frequently asked questions">
        <header className="discover-section-head">
          <h2>Frequently Asked Questions</h2>
        </header>

        <div className="faq-list">
          <details>
            <summary>Why can I not reserve a book?</summary>
            <p>
              A book cannot be reserved when no copies are available or you already have an active reservation
              for the same title.
            </p>
          </details>

          <details>
            <summary>How do I receive reservation updates?</summary>
            <p>
              Enable email or push notifications on the Settings page. Reservation alerts will also appear in
              the notification bell.
            </p>
          </details>

          <details>
            <summary>Where can I update my profile details?</summary>
            <p>
              Open the Settings page and update your profile fields. Click Save settings to apply the changes.
            </p>
          </details>

          <details>
            <summary>How do I contact support?</summary>
            <p>
              Send a message to <a href="mailto:learningcommons@vsu.edu.ph">learningcommons@vsu.edu.ph</a>
              with your student email and a short issue description.
            </p>
          </details>
        </div>
      </section>
    </LibraryWorkspaceLayout>
  );
}
