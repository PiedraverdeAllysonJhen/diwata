import { FormEvent, useCallback, useEffect, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { hasSupabaseEnv, supabase } from "../lib/supabase";
import PortalLiveIndicator from "../components/PortalLiveIndicator";
import LibraryWorkspaceLayout from "../components/LibraryWorkspaceLayout";
import { useReservationNotifier } from "../hooks/useReservationNotifier";

type SettingsForm = {
  email_notifications_enabled: boolean;
  sms_notifications_enabled: boolean;
  push_notifications_enabled: boolean;
  preferred_language: string;
  timezone: string;
  theme: string;
};

type ProfileForm = {
  first_name: string;
  last_name: string;
  college: string;
  course: string;
};

type Notice = {
  type: "success" | "error";
  text: string;
};

type LoadSource = "manual" | "live";

const DEFAULT_SETTINGS: SettingsForm = {
  email_notifications_enabled: true,
  sms_notifications_enabled: false,
  push_notifications_enabled: true,
  preferred_language: "en",
  timezone: "Asia/Manila",
  theme: "system"
};

const DEFAULT_PROFILE: ProfileForm = {
  first_name: "",
  last_name: "",
  college: "",
  course: ""
};

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

export default function SettingsPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(DEFAULT_SETTINGS);
  const [profileForm, setProfileForm] = useState<ProfileForm>(DEFAULT_PROFILE);

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

  const loadSettings = useCallback(
    async (source: LoadSource = "manual") => {
      if (!session?.user.id) return;

      if (source === "manual") {
        setIsFetching(true);
      } else {
        setIsLiveSyncing(true);
      }

      const [settingsResult, profileResult] = await Promise.all([
        supabase
          .from("user_settings")
          .select(
            "email_notifications_enabled,sms_notifications_enabled,push_notifications_enabled,preferred_language,timezone,theme"
          )
          .eq("user_id", session.user.id)
          .maybeSingle(),
        supabase
          .from("user_profiles")
          .select("first_name,last_name,college,course")
          .eq("id", session.user.id)
          .maybeSingle()
      ]);

      if (settingsResult.error) {
        setNotice({ type: "error", text: settingsResult.error.message });
      } else {
        setSettingsForm({
          ...DEFAULT_SETTINGS,
          ...(settingsResult.data ?? {})
        });
      }

      if (profileResult.error) {
        setNotice({ type: "error", text: profileResult.error.message });
      } else {
        setProfileForm({
          ...DEFAULT_PROFILE,
          ...(profileResult.data ?? {})
        });
      }

      if (!settingsResult.error && !profileResult.error) {
        setNotice(null);
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
    void loadSettings("manual");
  }, [session?.user.id, loadSettings]);

  useEffect(() => {
    if (!session?.user.id || !hasSupabaseEnv) return;

    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const queueLiveRefresh = () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }

      refreshTimeout = window.setTimeout(() => {
        void loadSettings("live");
      }, 300);
    };

    const channel = supabase
      .channel(`settings-realtime-${session.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_settings",
          filter: `user_id=eq.${session.user.id}`
        },
        queueLiveRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_profiles", filter: `id=eq.${session.user.id}` },
        queueLiveRefresh
      )
      .subscribe();

    return () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id, loadSettings]);

  const handleToggle = (field: keyof Pick<
    SettingsForm,
    "email_notifications_enabled" | "sms_notifications_enabled" | "push_notifications_enabled"
  >) => {
    setSettingsForm((previous) => ({
      ...previous,
      [field]: !previous[field]
    }));
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session?.user.id) return;

    setIsSaving(true);
    setNotice(null);

    const settingsPayload = {
      user_id: session.user.id,
      ...settingsForm
    };

    const profilePayload = {
      first_name: profileForm.first_name || null,
      last_name: profileForm.last_name || null,
      college: profileForm.college || null,
      course: profileForm.course || null
    };

    const [settingsResult, profileResult] = await Promise.all([
      supabase.from("user_settings").upsert(settingsPayload, { onConflict: "user_id" }),
      supabase.from("user_profiles").update(profilePayload).eq("id", session.user.id)
    ]);

    if (settingsResult.error || profileResult.error) {
      setNotice({
        type: "error",
        text: settingsResult.error?.message ?? profileResult.error?.message ?? "Failed to save settings."
      });
      setIsSaving(false);
      return;
    }

    setNotice({ type: "success", text: "Settings updated successfully." });
    setLastSyncedAt(new Date().toISOString());
    setIsSaving(false);
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
            <p>Add your values in `web/.env` before using settings.</p>
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
            <h1>Loading settings...</h1>
          </article>
        </section>
      </main>
    );
  }

  return (
    <LibraryWorkspaceLayout
      activeRoute="settings"
      activeMenuKey="setting"
      title="Account Settings"
      description="Manage your profile, notification preferences, and interface behavior."
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
        { label: "Theme", value: settingsForm.theme.toUpperCase() },
        {
          label: "Alerts",
          value: settingsForm.email_notifications_enabled || settingsForm.push_notifications_enabled ? "ON" : "OFF"
        }
      ]}
      sidebarAction={{
        label: isFetching ? "Refreshing..." : "Refresh Data",
        onClick: () => {
          void loadSettings("manual");
        },
        disabled: isFetching
      }}
      headerActions={
        <div className="discover-inline-actions">
          <button type="button" className="btn btn-soft btn-small" onClick={() => navigate("/dashboard")}>
            Open Dashboard
          </button>
          <button type="button" className="btn btn-soft btn-small" onClick={() => navigate("/help")}>
            Open Help
          </button>
        </div>
      }
      statusBar={
        <PortalLiveIndicator
          isSyncing={isLiveSyncing || isSaving}
          text={`${isLiveSyncing ? "Syncing settings..." : isSaving ? "Saving settings..." : "Settings ready"} | ${formatLastSync(lastSyncedAt)}`}
        />
      }
      notice={notice ? <p className={`status ${notice.type} portal-notice`}>{notice.text}</p> : undefined}
      onNavigate={(route) => navigate(`/${route}`)}
      onSignOut={handleSignOut}
    >
      <form className="settings-grid" onSubmit={handleSave}>
        <section className="discover-section settings-card" aria-label="Profile information">
          <header className="discover-section-head">
            <h2>Profile</h2>
          </header>

          <label htmlFor="first-name" className="settings-field">
            <span>First name</span>
            <input
              id="first-name"
              value={profileForm.first_name}
              onChange={(event) =>
                setProfileForm((previous) => ({ ...previous, first_name: event.target.value }))
              }
              placeholder="Enter first name"
            />
          </label>

          <label htmlFor="last-name" className="settings-field">
            <span>Last name</span>
            <input
              id="last-name"
              value={profileForm.last_name}
              onChange={(event) =>
                setProfileForm((previous) => ({ ...previous, last_name: event.target.value }))
              }
              placeholder="Enter last name"
            />
          </label>

          <label htmlFor="college" className="settings-field">
            <span>College</span>
            <input
              id="college"
              value={profileForm.college}
              onChange={(event) =>
                setProfileForm((previous) => ({ ...previous, college: event.target.value }))
              }
              placeholder="Enter college"
            />
          </label>

          <label htmlFor="course" className="settings-field">
            <span>Course</span>
            <input
              id="course"
              value={profileForm.course}
              onChange={(event) =>
                setProfileForm((previous) => ({ ...previous, course: event.target.value }))
              }
              placeholder="Enter course"
            />
          </label>
        </section>

        <section className="discover-section settings-card" aria-label="Notification preferences">
          <header className="discover-section-head">
            <h2>Notifications</h2>
          </header>

          <button
            type="button"
            className={`settings-toggle ${settingsForm.email_notifications_enabled ? "active" : ""}`.trim()}
            onClick={() => handleToggle("email_notifications_enabled")}
          >
            <span>Email notifications</span>
            <strong>{settingsForm.email_notifications_enabled ? "Enabled" : "Disabled"}</strong>
          </button>

          <button
            type="button"
            className={`settings-toggle ${settingsForm.push_notifications_enabled ? "active" : ""}`.trim()}
            onClick={() => handleToggle("push_notifications_enabled")}
          >
            <span>Push notifications</span>
            <strong>{settingsForm.push_notifications_enabled ? "Enabled" : "Disabled"}</strong>
          </button>

          <button
            type="button"
            className={`settings-toggle ${settingsForm.sms_notifications_enabled ? "active" : ""}`.trim()}
            onClick={() => handleToggle("sms_notifications_enabled")}
          >
            <span>SMS notifications</span>
            <strong>{settingsForm.sms_notifications_enabled ? "Enabled" : "Disabled"}</strong>
          </button>
        </section>

        <section className="discover-section settings-card" aria-label="Interface preferences">
          <header className="discover-section-head">
            <h2>Preferences</h2>
          </header>

          <label htmlFor="preferred-language" className="settings-field">
            <span>Preferred language</span>
            <select
              id="preferred-language"
              value={settingsForm.preferred_language}
              onChange={(event) =>
                setSettingsForm((previous) => ({ ...previous, preferred_language: event.target.value }))
              }
            >
              <option value="en">English</option>
              <option value="fil">Filipino</option>
            </select>
          </label>

          <label htmlFor="timezone" className="settings-field">
            <span>Timezone</span>
            <select
              id="timezone"
              value={settingsForm.timezone}
              onChange={(event) =>
                setSettingsForm((previous) => ({ ...previous, timezone: event.target.value }))
              }
            >
              <option value="Asia/Manila">Asia/Manila</option>
              <option value="UTC">UTC</option>
            </select>
          </label>

          <label htmlFor="theme" className="settings-field">
            <span>Theme</span>
            <select
              id="theme"
              value={settingsForm.theme}
              onChange={(event) =>
                setSettingsForm((previous) => ({ ...previous, theme: event.target.value }))
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>

          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {isSaving ? "Saving settings..." : "Save settings"}
          </button>
        </section>
      </form>
    </LibraryWorkspaceLayout>
  );
}
