import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { authRedirectBase, hasSupabaseEnv, supabase } from "../lib/supabase";

type NoticeType = "idle" | "success" | "error";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState<NoticeType>("idle");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!hasSupabaseEnv) {
      setNotice("Supabase environment variables are not configured.");
      setNoticeType("error");
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
      setNotice("Enter a valid email address to receive a reset link.");
      setNoticeType("error");
      return;
    }

    setIsLoading(true);
    setNotice("");
    setNoticeType("idle");

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        trimmedEmail,
        {
          redirectTo: `${authRedirectBase}/reset-password`,
        },
      );

      if (error) throw error;

      setNotice("Password reset email sent. Check your inbox and spam folder.");
      setNoticeType("success");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to send password reset email.",
      );
      setNoticeType("error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="reset-page">
      <section className="reset-card">
        <p className="eyebrow">Account Recovery</p>
        <h1>Forgot password?</h1>
        <p>
          Enter your BookItStudent email and we will send a secure reset link.
        </p>

        <form className="auth-form reset-form" onSubmit={handleSubmit} noValidate>
          <label htmlFor="forgot-email">Email</label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="student@vsu.edu.ph"
          />

          <button type="submit" className="btn btn-primary" disabled={isLoading}>
            {isLoading ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <Link className="btn btn-link reset-back-link" to="/">
          Back to login
        </Link>
        <p className={`status ${noticeType}`}>{notice}</p>
      </section>
    </main>
  );
}
