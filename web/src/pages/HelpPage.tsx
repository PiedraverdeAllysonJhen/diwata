import { ReactNode, useCallback, useEffect, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { hasSupabaseEnv, supabase } from "../lib/supabase";
import PortalLiveIndicator from "../components/PortalLiveIndicator";
import LibraryWorkspaceLayout from "../components/LibraryWorkspaceLayout";
import { useReservationNotifier } from "../hooks/useReservationNotifier";

type HelpMetrics = {
  activeReservations: number;
  totalFavorites: number;
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

function MetricCard({
  description,
  label,
  value
}: {
  description: string;
  label: string;
  value: string;
}) {
  return (
    <article className="rounded-[1.35rem] border border-slate-200 bg-white/95 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <strong className="mt-3 block text-3xl font-semibold tracking-tight text-slate-900">{value}</strong>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
    </article>
  );
}

function QuickLinkCard({
  actionLabel,
  children,
  icon,
  onClick,
  title
}: {
  actionLabel: string;
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <article className="rounded-[1.5rem] border border-slate-200 bg-white/95 p-5 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
        {icon}
      </span>
      <h2 className="mt-4 text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">{children}</p>
      <button
        type="button"
        className="mt-4 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-emerald-200 hover:text-emerald-700"
        onClick={onClick}
      >
        {actionLabel}
      </button>
    </article>
  );
}

function HelpAccordion({
  answer,
  title
}: {
  answer: string;
  title: string;
}) {
  return (
    <details className="group rounded-[1.25rem] border border-slate-200 bg-white/95 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <span className="text-slate-400 transition group-open:rotate-180">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </summary>
      <p className="mt-3 border-t border-slate-100 pt-3 text-sm leading-6 text-slate-500">{answer}</p>
    </details>
  );
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
    totalFavorites: 0
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

      // from the notifier hook which uses localStorage, matching how it actually works
      const [reservationsResult, favoritesResult] = await Promise.all([
        supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", session.user.id)
          .in("status", ["pending", "approved", "ready_for_pickup", "reserved", "queued"]),
        supabase
          .from("bookmarks")
          .select("book_id", { count: "exact", head: true })
          .eq("user_id", session.user.id)
      ]);

      const firstError = reservationsResult.error ?? favoritesResult.error;

      if (firstError) {
        setNotice(firstError.message);
      } else {
        setNotice("");
      }

      setMetrics({
        activeReservations: reservationsResult.count ?? 0,
        totalFavorites: favoritesResult.count ?? 0
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
      description="Support content is now split into quick actions and clean FAQ modules so answers stay easy to scan."
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
        { label: "Unread Alerts", value: String(notifier.unreadCount) }
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
      <div className="space-y-5">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Help overview">
          <MetricCard
            label="Open Reservations"
            value={String(metrics.activeReservations)}
            description="Requests that still need your attention in the reservations workspace."
          />
          <MetricCard
            label="Saved Favorites"
            value={String(metrics.totalFavorites)}
            description="Bookmarked titles you can revisit quickly from the favorites page."
          />
          <MetricCard
            label="Unread Alerts"
            value={String(notifier.unreadCount)}
            description="Unread reservation updates and reminders currently waiting in your feed."
          />
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">Quick Actions</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">Start from the right workspace</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                These entry points keep common support tasks short and predictable.
              </p>

              <div className="mt-5 grid grid-cols-1 gap-4">
                <QuickLinkCard
                  title="Manage reservations"
                  actionLabel="Open reservations"
                  onClick={() => navigate("/reservations")}
                  icon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                      <path d="M6 4h12a2 2 0 0 1 2 2v12l-4-2-4 2-4-2-4 2V6a2 2 0 0 1 2-2Z" />
                    </svg>
                  }
                >
                  Review active reservations, queue status, and whether a title can still be acted on.
                </QuickLinkCard>

                <QuickLinkCard
                  title="Check saved books"
                  actionLabel="Open favorites"
                  onClick={() => navigate("/favorites")}
                  icon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
                    </svg>
                  }
                >
                  Open category-grouped favorite shelves and remove titles that are no longer relevant.
                </QuickLinkCard>

                <QuickLinkCard
                  title="Review alerts"
                  actionLabel="Open alerts"
                  onClick={notifier.toggleOpen}
                  icon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
                      <path d="M10 20a2 2 0 0 0 4 0" />
                    </svg>
                  }
                >
                  Notification history is the fastest place to confirm reminders and reservation changes.
                </QuickLinkCard>
              </div>
            </section>
          </div>

          <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]" aria-label="Frequently asked questions">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">FAQ</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">Common support answers</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Expand a question to get the short answer without leaving this page.
            </p>

            <div className="mt-5 space-y-3">
              <HelpAccordion
                title="Why can I not reserve a book?"
                answer="A title cannot be reserved when there are no available copies or when you already have an active reservation for that same book."
              />
              <HelpAccordion
                title="How do I receive reservation updates?"
                answer="Enable email or push notifications from Settings. Reservation updates also appear in the notification bell for quick checking."
              />
              <HelpAccordion
                title="Where can I update my profile details?"
                answer="Open Settings, expand the profile module, update your details, and use the single save action to store profile and preference changes together."
              />
              <HelpAccordion
                title="How do I contact support?"
                answer="Email learningcommons@vsu.edu.ph using your student account and include a short description of the issue you are seeing."
              />
            </div>
          </section>
        </section>
      </div>
    </LibraryWorkspaceLayout>
  );
}
