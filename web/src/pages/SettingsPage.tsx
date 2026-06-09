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
  theme: "system",
};

const DEFAULT_PROFILE: ProfileForm = {
  first_name: "",
  last_name: "",
  college: "",
  course: "",
};

const SETTINGS_BOOTSTRAP_TIMEOUT_MS = 6000;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timeoutId: ReturnType<typeof window.setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

function formatLastSync(value: string | null) {
  if (!value) return "Waiting for first sync";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waiting for first sync";
  return `Last sync ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
}

function SettingsAccordion({
  children,
  icon,
  summary,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  summary: string;
  title: string;
}) {
  return (
    <details
      open
      className="group rounded-[1.5rem] border border-slate-200 bg-white/95 p-5 shadow-[0_16px_36px_rgba(15,23,42,0.06)]"
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            {icon}
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              {title}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{summary}</p>
          </div>
        </div>
        <span className="mt-1 text-slate-400 transition group-open:rotate-180">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-5 w-5"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </summary>
      <div className="mt-5 border-t border-slate-100 pt-5">{children}</div>
    </details>
  );
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
  const [settingsForm, setSettingsForm] =
    useState<SettingsForm>(DEFAULT_SETTINGS);
  const [profileForm, setProfileForm] = useState<ProfileForm>(DEFAULT_PROFILE);
  const [initialSettings, setInitialSettings] =
    useState<SettingsForm>(DEFAULT_SETTINGS);
  const [initialProfile, setInitialProfile] =
    useState<ProfileForm>(DEFAULT_PROFILE);

  const isDirty = useMemo(
    () =>
      JSON.stringify(settingsForm) !== JSON.stringify(initialSettings) ||
      JSON.stringify(profileForm) !== JSON.stringify(initialProfile),
    [settingsForm, profileForm, initialSettings, initialProfile],
  );

  useEffect(() => {
    let isMounted = true;
    const bootstrap = async () => {
      if (!hasSupabaseEnv) {
        setIsBootstrapping(false);
        return;
      }
      const sessionResult = await withTimeout(
        supabase.auth.getSession(),
        SETTINGS_BOOTSTRAP_TIMEOUT_MS,
      );
      if (!isMounted) return;
      const currentSession = sessionResult?.data.session ?? null;
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

  const loadSettings = useCallback(
    async (source: LoadSource = "manual") => {
      if (!session?.user.id) return;
      if (source === "manual") {
        setIsFetching(true);
      } else {
        setIsLiveSyncing(true);
      }

      try {
        const [settingsResult, profileResult] = await Promise.all([
          supabase
            .from("user_settings")
            .select(
              "email_notifications_enabled,sms_notifications_enabled,push_notifications_enabled,preferred_language,timezone,theme",
            )
            .eq("user_id", session.user.id)
            .maybeSingle(),
          supabase
            .from("user_profiles")
            .select("first_name,last_name,college,course")
            .eq("id", session.user.id)
            .maybeSingle(),
        ]);

        if (settingsResult.error) {
          setNotice({ type: "error", text: settingsResult.error.message });
        } else {
          const nextSettings: SettingsForm = {
            ...DEFAULT_SETTINGS,
            ...(settingsResult.data ?? {}),
          };
          setSettingsForm(nextSettings);
          setInitialSettings(nextSettings);
        }

        if (profileResult.error) {
          setNotice({ type: "error", text: profileResult.error.message });
        } else {
          const nextProfile: ProfileForm = {
            ...DEFAULT_PROFILE,
            ...(profileResult.data ?? {}),
          };
          setProfileForm(nextProfile);
          setInitialProfile(nextProfile);
        }

        if (!settingsResult.error && !profileResult.error) setNotice(null);
        setLastSyncedAt(new Date().toISOString());
      } catch {
        setNotice({
          type: "error",
          text: "Settings could not be loaded. Please refresh and try again.",
        });
      } finally {
        if (source === "manual") {
          setIsFetching(false);
        } else {
          setIsLiveSyncing(false);
        }
      }
    },
    [session?.user.id],
  );

  useEffect(() => {
    if (!session?.user.id) return;
    void loadSettings("manual");
  }, [session?.user.id, loadSettings]);

  useEffect(() => {
    if (!session?.user.id || !hasSupabaseEnv) return;
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const queueLiveRefresh = () => {
      if (refreshTimeout) window.clearTimeout(refreshTimeout);
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
          filter: `user_id=eq.${session.user.id}`,
        },
        queueLiveRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_profiles",
          filter: `id=eq.${session.user.id}`,
        },
        queueLiveRefresh,
      )
      .subscribe();
    return () => {
      if (refreshTimeout) window.clearTimeout(refreshTimeout);
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id, loadSettings]);

  const handleToggle = (
    field: keyof Pick<
      SettingsForm,
      | "email_notifications_enabled"
      | "sms_notifications_enabled"
      | "push_notifications_enabled"
    >,
  ) => {
    setSettingsForm((previous) => ({ ...previous, [field]: !previous[field] }));
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.user.id) return;
    setIsSaving(true);
    setNotice(null);

    const settingsPayload = { user_id: session.user.id, ...settingsForm };
    const profilePayload = {
      id: session.user.id,
      email: session.user.email ?? null,
      first_name: profileForm.first_name || null,
      last_name: profileForm.last_name || null,
      college: profileForm.college || null,
      course: profileForm.course || null,
    };

    const [settingsResult, profileResult] = await Promise.all([
      supabase
        .from("user_settings")
        .upsert(settingsPayload, { onConflict: "user_id" }),
      supabase
        .from("user_profiles")
        .upsert(profilePayload, { onConflict: "id" }),
    ]);

    if (settingsResult.error || profileResult.error) {
      setNotice({
        type: "error",
        text:
          settingsResult.error?.message ??
          profileResult.error?.message ??
          "Failed to save settings.",
      });
      setIsSaving(false);
      return;
    }

    setNotice({ type: "success", text: "Settings updated successfully." });
    setInitialSettings({ ...settingsForm });
    setInitialProfile({ ...profileForm });
    setLastSyncedAt(new Date().toISOString());
    setIsSaving(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const userEmail = session?.user.email ?? "student@vsu.edu.ph";
  const notifier = useReservationNotifier(session?.user.id);
  const displayName =
    [profileForm.first_name.trim(), profileForm.last_name.trim()]
      .filter(Boolean)
      .join(" ") || userEmail.split("@")[0];
  const profileInitial = displayName.trim().charAt(0).toUpperCase() || "S";

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
      description="Profile details and notifications are organized into lighter, easier-to-scan modules."
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
        {
          label: "Alerts",
          value:
            settingsForm.email_notifications_enabled ||
            settingsForm.push_notifications_enabled
              ? "ON"
              : "OFF",
        },
      ]}
      sidebarAction={{
        label: isFetching ? "Refreshing..." : "Refresh Data",
        onClick: () => {
          void loadSettings("manual");
        },
        disabled: isFetching,
      }}
      statusBar={
        <PortalLiveIndicator
          isSyncing={isLiveSyncing || isSaving}
          text={`${isLiveSyncing ? "Syncing settings..." : isSaving ? "Saving settings..." : "Settings ready"} | ${formatLastSync(lastSyncedAt)}`}
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
      <form className="space-y-5" onSubmit={handleSave}>
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
          <aside className="space-y-5">
            <section className="rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                Profile Snapshot
              </p>
              <div className="mt-4 flex items-start gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.4rem] bg-emerald-700 text-2xl font-semibold text-white shadow-lg shadow-emerald-700/20">
                  {profileInitial}
                </div>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                    {displayName}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">{userEmail}</p>
                  <p className="mt-3 text-sm text-slate-500">
                    {[profileForm.college.trim(), profileForm.course.trim()]
                      .filter(Boolean)
                      .join(" / ") ||
                      "Add your college and course so your account profile feels complete."}
                  </p>
                </div>
              </div>
            </section>
          </aside>

          <div className="space-y-4">
            <SettingsAccordion
              title="Profile details"
              summary="Update your academic identity and display name without digging through a dense form."
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                >
                  <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
                  <path d="M5 20a7 7 0 0 1 14 0" />
                </svg>
              }
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-slate-700">
                    First name
                  </span>
                  <input
                    value={profileForm.first_name}
                    onChange={(e) =>
                      setProfileForm((p) => ({
                        ...p,
                        first_name: e.target.value,
                      }))
                    }
                    placeholder="Enter first name"
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-slate-700">
                    Last name
                  </span>
                  <input
                    value={profileForm.last_name}
                    onChange={(e) =>
                      setProfileForm((p) => ({
                        ...p,
                        last_name: e.target.value,
                      }))
                    }
                    placeholder="Enter last name"
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-slate-700">
                    College
                  </span>
                  <input
                    value={profileForm.college}
                    onChange={(e) =>
                      setProfileForm((p) => ({ ...p, college: e.target.value }))
                    }
                    placeholder="Enter college"
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-slate-700">
                    Course
                  </span>
                  <input
                    value={profileForm.course}
                    onChange={(e) =>
                      setProfileForm((p) => ({ ...p, course: e.target.value }))
                    }
                    placeholder="Enter course"
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white"
                  />
                </label>
              </div>
            </SettingsAccordion>

            <SettingsAccordion
              title="Notification channels"
              summary="Choose the channels you want for reminders, reservation changes, and follow-up alerts."
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                >
                  <path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
                  <path d="M10 20a2 2 0 0 0 4 0" />
                </svg>
              }
            >
              <div className="space-y-3">
                {[
                  {
                    field: "email_notifications_enabled" as const,
                    label: "Email notifications",
                    helper:
                      "Best for reservation confirmations and detailed updates.",
                  },
                  {
                    field: "push_notifications_enabled" as const,
                    label: "Push notifications",
                    helper:
                      "Useful for quicker reminders while browsing the workspace.",
                  },
                  {
                    field: "sms_notifications_enabled" as const,
                    label: "SMS notifications",
                    helper:
                      "Ideal for shorter alerts when you are away from the app.",
                  },
                ].map((item) => {
                  const enabled = settingsForm[item.field];
                  return (
                    <button
                      key={item.field}
                      type="button"
                      onClick={() => handleToggle(item.field)}
                      className={`flex w-full items-start justify-between gap-4 rounded-[1.2rem] border px-4 py-4 text-left transition ${enabled ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-slate-50/70 hover:border-emerald-200"}`}
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {item.label}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {item.helper}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${enabled ? "bg-emerald-700 text-white" : "bg-white text-slate-500"}`}
                      >
                        {enabled ? "Enabled" : "Off"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </SettingsAccordion>

            {isDirty ? (
              <div className="sticky bottom-4 z-20">
                <div className="rounded-2xl border border-emerald-200 bg-white/95 p-4 shadow-[0_-4px_24px_rgba(15,23,42,0.14)] flex items-center justify-between gap-4">
                  <p className="text-sm text-slate-500">
                    You have unsaved changes.
                  </p>
                  <button
                    type="submit"
                    className="rounded-2xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSaving}
                  >
                    {isSaving ? "Saving settings..." : "Save settings"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </form>
    </LibraryWorkspaceLayout>
  );
}
