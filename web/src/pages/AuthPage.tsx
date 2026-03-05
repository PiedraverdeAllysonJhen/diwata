import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { hasSupabaseEnv, supabase } from "../lib/supabase";

type AuthMode = "login" | "signup";
type NoticeType = "idle" | "success" | "error";
type FieldKey = "email" | "password" | "confirmPassword";
type FieldErrors = Partial<Record<FieldKey, string>>;

const floatingBooks = [
  { id: "eng-1", label: "Engineering", title: "Strength of Materials", className: "chip-1" },
  { id: "lang-1", label: "Language", title: "Technical Writing", className: "chip-2" },
  { id: "sci-1", label: "Science", title: "Applied Physics", className: "chip-3" },
  { id: "tech-1", label: "Technology", title: "Database Systems", className: "chip-4" },
  { id: "agri-1", label: "Agriculture", title: "Sustainable Farming", className: "chip-5" },
  { id: "eng-2", label: "Engineering", title: "Fluid Mechanics", className: "chip-6" },
  { id: "sci-2", label: "Science", title: "Organic Chemistry", className: "chip-7" },
  { id: "tech-2", label: "Technology", title: "Software Design", className: "chip-8" },
  { id: "agri-2", label: "Agriculture", title: "Crop Science", className: "chip-9" },
  { id: "lang-2", label: "Language", title: "Communication Skills", className: "chip-10" },
  { id: "sci-3", label: "Science", title: "Biostatistics", className: "chip-11" },
  { id: "tech-3", label: "Technology", title: "Cloud Computing", className: "chip-12" }
];

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getPasswordScore(value: string): number {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (/[A-Z]/.test(value)) score += 1;
  if (/[0-9]/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return score;
}

function getFriendlyError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

export default function AuthPage() {
  const navigate = useNavigate();

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState<NoticeType>("idle");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submittedOnce, setSubmittedOnce] = useState(false);

  const passwordScore = useMemo(() => getPasswordScore(password), [password]);

  const validateFields = (
    values: { email: string; password: string; confirmPassword: string } = { email, password, confirmPassword }
  ): FieldErrors => {
    const nextErrors: FieldErrors = {};
    const normalizedEmail = values.email.trim();

    if (!normalizedEmail) {
      nextErrors.email = "Please fill all fields.";
    } else if (!isValidEmail(normalizedEmail)) {
      nextErrors.email = "Please enter a valid email address.";
    }

    if (!values.password) {
      nextErrors.password = "Please fill all fields.";
    }

    if (mode === "signup") {
      if (!values.confirmPassword) {
        nextErrors.confirmPassword = "Please fill all fields.";
      } else if (values.password !== values.confirmPassword) {
        nextErrors.confirmPassword = "Passwords do not match.";
      }
    }

    return nextErrors;
  };

  const setFieldError = (field: FieldKey, message?: string) => {
    setErrors((previous) => {
      const next = { ...previous };
      if (message) {
        next[field] = message;
      } else {
        delete next[field];
      }
      return next;
    });
  };

  useEffect(() => {
    if (!hasSupabaseEnv) {
      setNotice("Supabase config is missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      setNoticeType("error");
      return;
    }

    const checkExistingSession = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (session) {
        navigate("/dashboard", { replace: true });
      }
    };

    void checkExistingSession();
  }, [navigate]);

  useEffect(() => {
    if (mode === "login") {
      setConfirmPassword("");
      setFieldError("confirmPassword");
    }
  }, [mode]);

  const setFeedback = (message: string, type: NoticeType) => {
    setNotice(message);
    setNoticeType(type);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!hasSupabaseEnv) {
      setFeedback("Supabase environment variables are not configured.", "error");
      return;
    }

    setSubmittedOnce(true);
    const validationErrors = validateFields();
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      setFeedback("Please fill all required fields.", "error");
      return;
    }

    setIsLoading(true);
    setFeedback("", "idle");

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;

        setFeedback("Logged in successfully. Redirecting...", "success");
        navigate("/dashboard", { replace: true });
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`
        }
      });

      if (error) throw error;

      if (data.session) {
        setFeedback("Account created. Redirecting...", "success");
        navigate("/dashboard", { replace: true });
      } else {
        setFeedback("Account created. Check your email to confirm your account.", "success");
      }
    } catch (error) {
      setFeedback(getFriendlyError(error), "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicLink = async () => {
    if (!hasSupabaseEnv) {
      setFeedback("Supabase environment variables are not configured.", "error");
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFieldError("email", "Please fill all fields.");
      setFeedback("Please fill all required fields.", "error");
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setFieldError("email", "Please enter a valid email address.");
      setFeedback("Please enter a valid email address.", "error");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`
        }
      });

      if (error) throw error;
      setFeedback("Magic link sent. Open your email to continue.", "success");
    } catch (error) {
      setFeedback(getFriendlyError(error), "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!hasSupabaseEnv) {
      setFeedback("Supabase environment variables are not configured.", "error");
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFieldError("email", "Please fill all fields.");
      setFeedback("Please fill all required fields.", "error");
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setFieldError("email", "Please enter a valid email address.");
      setFeedback("Please enter a valid email address.", "error");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/reset-password`
      });

      if (error) throw error;
      setFeedback("Password reset link sent to your email.", "success");
    } catch (error) {
      setFeedback(getFriendlyError(error), "error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />

      <ul className="book-cloud" aria-hidden="true">
        {floatingBooks.map((book) => (
          <li key={book.id} className={`book-chip ${book.className}`}>
            <span className="book-chip-tag">{book.label}</span>
            <strong>{book.title}</strong>
          </li>
        ))}
      </ul>

      <section className="auth-shell">
        <aside className="brand-pane">
          <header className="brand-header">
            <img
              src="/assets/bookitstudent-logo.jpg"
              alt="BookItStudent - Visayas State University"
              className="brand-logo"
            />
            <span className="brand-divider" aria-hidden="true" />
            <div className="brand-heading">
              <h1 className="brand-title">BookItStudent</h1>
              <p className="brand-university">Visayas State University</p>
            </div>
          </header>

          <p className="brand-subtitle">
            Reserve books faster, track requests in real time, and keep your learning workflow on
            one secure platform.
          </p>

          <div className="brand-badges">
            <span>Secure Auth</span>
            <span>Supabase Powered</span>
            <span>Mobile First</span>
          </div>

          <div className="brand-highlights" aria-label="Collection highlights">
            <article className="highlight-card">
              <h3>Collection Focus</h3>
              <p>Engineering, science, technology, language, and agriculture resources.</p>
            </article>
            <article className="highlight-card">
              <h3>Ready for Students</h3>
              <p>Reserve and track books from one secure, mobile-friendly portal.</p>
            </article>
          </div>
        </aside>

        <section className="form-pane" aria-label="Authentication form">
          <div className="form-shell">
            <div className="mode-toggle" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={`mode-button ${mode === "login" ? "active" : ""}`}
                onClick={() => {
                  setMode("login");
                  setSubmittedOnce(false);
                }}
              >
                Login
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={`mode-button ${mode === "signup" ? "active" : ""}`}
                onClick={() => {
                  setMode("signup");
                  setSubmittedOnce(false);
                }}
              >
                Sign Up
              </button>
            </div>

            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                aria-invalid={Boolean(errors.email)}
                className={errors.email ? "field-error" : ""}
                onBlur={() => setFieldError("email", validateFields().email)}
                onChange={(event) => {
                  const nextEmail = event.target.value;
                  setEmail(nextEmail);
                  if (submittedOnce || errors.email) {
                    setFieldError(
                      "email",
                      validateFields({ email: nextEmail, password, confirmPassword }).email
                    );
                  }
                }}
                placeholder="student@vsu.edu.ph"
              />
              <p className={`field-feedback ${errors.email ? "show" : ""}`}>
                {errors.email ?? "\u00a0"}
              </p>

              <label htmlFor="password">Password</label>
              <div className="password-row">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  aria-invalid={Boolean(errors.password)}
                  className={errors.password ? "field-error" : ""}
                  onBlur={() => setFieldError("password", validateFields().password)}
                  onChange={(event) => {
                    const nextPassword = event.target.value;
                    setPassword(nextPassword);
                    if (submittedOnce || errors.password || errors.confirmPassword) {
                      const nextErrors = validateFields({
                        email,
                        password: nextPassword,
                        confirmPassword
                      });
                      setFieldError("password", nextErrors.password);
                      if (mode === "signup") {
                        setFieldError("confirmPassword", nextErrors.confirmPassword);
                      }
                    }
                  }}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <p className={`field-feedback ${errors.password ? "show" : ""}`}>
                {errors.password ?? "\u00a0"}
              </p>

              {mode === "signup" && (
                <>
                  <label htmlFor="confirm-password">Confirm password</label>
                  <input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    aria-invalid={Boolean(errors.confirmPassword)}
                    className={errors.confirmPassword ? "field-error" : ""}
                    onBlur={() => setFieldError("confirmPassword", validateFields().confirmPassword)}
                    onChange={(event) => {
                      const nextConfirm = event.target.value;
                      setConfirmPassword(nextConfirm);
                      if (submittedOnce || errors.confirmPassword) {
                        setFieldError(
                          "confirmPassword",
                          validateFields({ email, password, confirmPassword: nextConfirm })
                            .confirmPassword
                        );
                      }
                    }}
                    placeholder="Confirm your password"
                  />
                  <p className={`field-feedback ${errors.confirmPassword ? "show" : ""}`}>
                    {errors.confirmPassword ?? "\u00a0"}
                  </p>

                  <div className="password-meter" aria-live="polite">
                    <span>Password strength</span>
                    <div className="meter-track" aria-hidden="true">
                      <span className={`meter-fill score-${passwordScore}`} />
                    </div>
                  </div>
                </>
              )}

              <div className="action-group">
                <button type="submit" className="btn btn-primary" disabled={isLoading}>
                  {isLoading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
                </button>

                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={handleMagicLink}
                  disabled={isLoading}
                >
                  Send Magic Link
                </button>
              </div>

              <button
                type="button"
                className="btn btn-link"
                onClick={handleForgotPassword}
                disabled={isLoading}
              >
                Forgot password?
              </button>

              <p className={`status ${noticeType}`}>{notice}</p>
            </form>
          </div>
        </section>
      </section>
    </main>
  );
}
