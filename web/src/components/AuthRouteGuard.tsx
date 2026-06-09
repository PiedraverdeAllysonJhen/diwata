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

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!isMounted) return;

      if (!session) {
        setState({
          isLoading: false,
          isAuthenticated: false,
          isStaff: false,
          redirectTo: mode === "guest" ? null : "/",
        });
        return;
      }

      const staff = await isStaffUser(session.user.id);
      if (!isMounted) return;

      setState({
        isLoading: false,
        isAuthenticated: true,
        isStaff: staff,
        redirectTo:
          mode === "guest"
            ? await getPostLoginPath(session.user.id)
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
