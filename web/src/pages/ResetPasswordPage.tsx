import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { hasSupabaseEnv, supabase } from "../lib/supabase";

type NoticeType = "idle" | "success" | "error";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState<NoticeType>("idle");

  useEffect(() => {
    let isMounted = true;

    if (!hasSupabaseEnv) {
      setNotice("Supabase environment variables are not configured.");
      setNoticeType("error");
      return;
    }

    const bootstrap = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!isMounted) return;

      if (session) {
        setIsReady(true);
        setNotice("");
        setNoticeType("idle");
      } else {
        setNotice("Open this page from your Supabase recovery email link.");
        setNoticeType("error");
      }
    };

    void bootstrap();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      if (event === "PASSWORD_RECOVERY" || session) {
        setIsReady(true);
        setNotice("");
        setNoticeType("idle");
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password !== confirmPassword) {
      setNotice("Passwords do not match.");
      setNoticeType("error");
      return;
    }

    if (password.length < 8) {
      setNotice("Password must be at least 8 characters.");
      setNoticeType("error");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setNotice("Password updated successfully. Redirecting to login...");
      setNoticeType("success");

      setTimeout(() => {
        navigate("/", { replace: true });
      }, 1100);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update password.");
      setNoticeType("error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="reset-page">
      <section className="reset-card">
        <p className="eyebrow">Account Recovery</p>
        <h1>Create a new password</h1>
        <p>Use a strong password with letters, numbers, and symbols.</p>

        {isReady && (
          <form className="auth-form reset-form" onSubmit={handleSubmit}>
            <label htmlFor="reset-password">New password</label>
            <input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your new password"
            />

            <label htmlFor="reset-confirm-password">Confirm password</label>
            <input
              id="reset-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm your new password"
            />

            <button type="submit" className="btn btn-primary" disabled={isLoading}>
              {isLoading ? "Updating..." : "Update password"}
            </button>
          </form>
        )}

        <p className={`status ${noticeType}`}>{notice}</p>
      </section>
    </main>
  );
}

