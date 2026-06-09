import { ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getPostLoginPath, isStaffUser } from "../lib/authRouting";
import { hasSupabaseEnv, supabase } from "../lib/supabase";

type GuardMode = "guest" | "auth" | "student" | "admin";

type GuardState = {
  isLoading: boolean;
  isAuthenticated: boolean;
  isStaff: boolean;
  redirectTo: string | null;
};

const ACCESS_CHECK_TIMEOUT_MS = 6000;

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

function LoadingScreen({ label }: { label: string }) {
  return (
    <main className="portal-page">
      <section className="portal-shell portal-single">
        <article className="portal-panel">
          <h1>{label}</h1>
        </article>
      </section>
    </main>
  );
}

export default function AuthRouteGuard({
  children,
  mode,
}: {
  children: ReactNode;
  mode: GuardMode;
}) {
  const [state, setState] = useState<GuardState>({
    isLoading: true,
    isAuthenticated: false,
    isStaff: false,
    redirectTo: null,
  });

  useEffect(() => {
    let isMounted = true;

    const verify = async () => {
      if (!hasSupabaseEnv) {
        if (isMounted) {
          setState({
            isLoading: false,
            isAuthenticated: false,
            isStaff: false,
            redirectTo: null,
          });
        }
        return;
      }

      const sessionResult = await withTimeout(
        supabase.auth.getSession(),
        ACCESS_CHECK_TIMEOUT_MS,
      );

      if (!isMounted) return;

      const session = sessionResult?.data.session ?? null;

      if (!session) {
        setState({
          isLoading: false,
          isAuthenticated: false,
          isStaff: false,
          redirectTo: mode === "guest" ? null : "/",
        });
        return;
      }

      const staff = Boolean(
        await withTimeout(
          isStaffUser(session.user.id),
          ACCESS_CHECK_TIMEOUT_MS,
        ),
      );
      if (!isMounted) return;

      const guestRedirect =
        mode === "guest"
          ? ((await withTimeout(
              getPostLoginPath(session.user.id),
              ACCESS_CHECK_TIMEOUT_MS,
            )) ?? "/dashboard")
          : null;

      setState({
        isLoading: false,
        isAuthenticated: true,
        isStaff: staff,
        redirectTo:
          guestRedirect
            ? guestRedirect
            : mode === "admin" && !staff
              ? "/dashboard"
              : mode === "student" && staff
                ? "/admin"
                : null,
      });
    };

    void verify();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void verify();
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [mode]);

  if (state.isLoading) {
    return <LoadingScreen label="Checking access..." />;
  }

  if (state.redirectTo) {
    return <Navigate to={state.redirectTo} replace />;
  }

  if (mode !== "guest" && !state.isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (mode === "admin" && !state.isStaff) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
