import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Session } from "@supabase/supabase-js";
import { hasSupabaseEnv, supabase } from "../lib/supabase";

export default function DashboardPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  if (!hasSupabaseEnv) {
    return (
      <main className="dashboard-page">
        <section className="dash-card">
          <h1>Supabase not configured</h1>
          <p>Add your values in `web/.env` before using authentication features.</p>
        </section>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="dashboard-page">
        <section className="dash-card">
          <h1>Loading dashboard...</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-page">
      <section className="dash-card">
        <p className="eyebrow">Authenticated Session</p>
        <h1>Welcome, {session?.user.email}</h1>
        <p>
          You are now signed in to BookItStudent. This is your secured area where your book
          reservation features can be added next.
        </p>

        <div className="dashboard-grid">
          <article className="mini-card">
            <h2>Realtime Ready</h2>
            <p>Supabase sessions are persistent and refresh automatically.</p>
          </article>
          <article className="mini-card">
            <h2>Scalable Deploy</h2>
            <p>Frontend + API are ready for Vercel deployment.</p>
          </article>
        </div>

        <button type="button" className="btn btn-primary" onClick={handleSignOut}>
          Sign out
        </button>
      </section>
    </main>
  );
}
