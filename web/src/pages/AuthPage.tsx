import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authRedirectBase, hasSupabaseEnv, supabase } from "../lib/supabase";

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

function getLoginErrorMessage(error: unknown): string {
  const fallback = getFriendlyError(error);
  const message = fallback.toLowerCase();
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? ((error as { code?: string }).code ?? "").toLowerCase()
      : "";

  if (code === "email_not_confirmed" || /email\s+(address\s+)?not\s+confirmed/i.test(message)) {
    return "Email not confirmed. Please verify your email before logging in.";
  }

  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return "Invalid email or password. Please try again or use Forgot password.";
  }

  return fallback;
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

  const dashboardRedirect = `${authRedirectBase}/dashboard`;
  const resetPasswordRedirect = `${authRedirectBase}/reset-password`;

  const passwordScore = useMemo(() => getPasswordScore(password), [password]);
  const renderVisibilityIcon = (isVisible: boolean) =>
    isVisible ? (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M3 3L21 21M10.58 10.58a2 2 0 102.83 2.83"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9.88 5.09A10.94 10.94 0 0112 5c5 0 9.27 3.11 11 7.5a11.81 11.81 0 01-4.21 5.29M6.61 6.61A11.84 11.84 0 001 12.5 11.82 11.82 0 004.13 16"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M1 12.5C2.73 8.11 7 5 12 5s9.27 3.11 11 7.5c-1.73 4.39-6 7.5-11 7.5s-9.27-3.11-11-7.5z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12.5" r="3" stroke="currentColor" strokeWidth="2" />
      </svg>
    );

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
          emailRedirectTo: dashboardRedirect
        }
      });

      if (error) throw error;

      const isExistingAccountAttempt =
        Array.isArray(data.user?.identities) && data.user?.identities.length === 0;

      if (isExistingAccountAttempt) {
        setFeedback("This email is already registered. Use Forgot password to recover access.", "error");
        return;
      }

      if (data.session) {
        setFeedback("Account created. Redirecting...", "success");
        navigate("/dashboard", { replace: true });
      } else {
        setFeedback("Account created. Check your email to confirm your account.", "success");
      }
    } catch (error) {
      if (mode === "login") {
        setFeedback(getLoginErrorMessage(error), "error");
      } else {
        setFeedback(getFriendlyError(error), "error");
      }
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
          emailRedirectTo: dashboardRedirect
        }
      });

      if (error) throw error;
      setFeedback("Magic link sent. Open your email to continue.", "success");
    } catch (error) {
      if (mode === "login") {
        setFeedback(getLoginErrorMessage(error), "error");
      } else {
        setFeedback(getFriendlyError(error), "error");
      }
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
        redirectTo: resetPasswordRedirect
      });

      if (error) throw error;
      setFeedback("Password reset link sent to your email.", "success");
    } catch (error) {
      if (mode === "login") {
        setFeedback(getLoginErrorMessage(error), "error");
      } else {
        setFeedback(getFriendlyError(error), "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!hasSupabaseEnv) {
      setFeedback("Supabase environment variables are not configured.", "error");
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFieldError("email", "Please fill all fields.");
      setFeedback("Enter your email first to resend confirmation.", "error");
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setFieldError("email", "Please enter a valid email address.");
      setFeedback("Please enter a valid email address.", "error");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: trimmedEmail,
        options: {
          emailRedirectTo: dashboardRedirect
        }
      });

      if (error) throw error;
      setFeedback("Confirmation email resent. Check inbox and spam folder.", "success");
    } catch (error) {
      if (mode === "login") {
        setFeedback(getLoginErrorMessage(error), "error");
      } else {
        setFeedback(getFriendlyError(error), "error");
      }
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
                <div className="password-field">
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
                    className="password-visibility"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {renderVisibilityIcon(showPassword)}
                  </button>
                </div>
              </div>
              <p className={`field-feedback ${errors.password ? "show" : ""}`}>
                {errors.password ?? "\u00a0"}
              </p>

              {mode === "signup" && (
                <>
                  <label htmlFor="confirm-password">Confirm password</label>
                  <div className="password-row">
                    <div className="password-field">
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
                      <button
                        type="button"
                        className="password-visibility"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword((value) => !value)}
                      >
                        {renderVisibilityIcon(showPassword)}
                      </button>
                    </div>
                  </div>
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

              <div className="auth-links">
                {mode === "login" && (
                  <button
                    type="button"
                    className="btn btn-link"
                    onClick={handleForgotPassword}
                    disabled={isLoading}
                  >
                    Forgot password?
                  </button>
                )}
                {mode === "signup" && (
                  <button
                    type="button"
                    className="btn btn-link link-muted"
                    onClick={handleResendConfirmation}
                    disabled={isLoading}
                  >
                    Resend confirmation email
                  </button>
                )}
              </div>

              <p className={`status ${noticeType}`}>{notice}</p>
            </form>
          </div>
        </section>
      </section>
    </main>
  );
}

