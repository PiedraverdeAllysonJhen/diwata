import { useCallback, useEffect, useMemo, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { hasSupabaseEnv, supabase } from "../lib/supabase";

type BookRecord = {
  id: string;
  title: string;
  subtitle: string | null;
  available_copies: number;
  total_copies: number;
  publication_year: number | null;
  language: string | null;
};

type ReservationStatus = "pending" | "ready_for_pickup";

type ReservationRecord = {
  id: string;
  book_id: string;
  status: ReservationStatus;
  requested_at: string;
  expires_at: string | null;
  books: {
    title: string;
    subtitle: string | null;
  } | null;
};

type Notice = {
  type: "success" | "error";
  text: string;
};

const activeReservationStatuses: ReservationStatus[] = ["pending", "ready_for_pickup"];

function formatDate(dateValue: string | null) {
  if (!dateValue) return "No date";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatStatus(status: string) {
  return status
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

export default function ReservationsPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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

  const loadReservationData = useCallback(async () => {
    if (!session?.user.id) return;

    setIsFetching(true);

    const [booksResult, reservationsResult] = await Promise.all([
      supabase
        .from("books")
        .select("id,title,subtitle,available_copies,total_copies,publication_year,language")
        .gt("available_copies", 0)
        .order("title", { ascending: true })
        .limit(120),
      supabase
        .from("reservations")
        .select("id,book_id,status,requested_at,expires_at,books(title,subtitle)")
        .eq("user_id", session.user.id)
        .in("status", activeReservationStatuses)
        .order("requested_at", { ascending: false })
    ]);

    if (booksResult.error) {
      setNotice({
        type: "error",
        text: booksResult.error.message
      });
    } else {
      setBooks((booksResult.data ?? []) as BookRecord[]);
    }

    if (reservationsResult.error) {
      setNotice({
        type: "error",
        text: reservationsResult.error.message
      });
    } else {
      setReservations((reservationsResult.data ?? []) as ReservationRecord[]);
    }

    setIsFetching(false);
  }, [session?.user.id]);

  useEffect(() => {
    if (!session?.user.id) return;
    void loadReservationData();
  }, [session?.user.id, loadReservationData]);

  const reservedBookIds = useMemo(() => {
    return new Set(reservations.map((reservation) => reservation.book_id));
  }, [reservations]);

  const filteredBooks = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return books;

    return books.filter((book) => {
      const values = [
        book.title,
        book.subtitle ?? "",
        book.language ?? "",
        book.publication_year ? String(book.publication_year) : ""
      ];

      return values.some((value) => value.toLowerCase().includes(keyword));
    });
  }, [books, searchQuery]);

  const handleReserveBook = async (bookId: string) => {
    if (!session?.user.id) return;

    setActiveAction(`reserve-${bookId}`);
    setNotice(null);

    const { error } = await supabase.from("reservations").insert({
      user_id: session.user.id,
      book_id: bookId,
      status: "pending"
    });

    if (error) {
      if (error.code === "23505" || /duplicate/i.test(error.message)) {
        setNotice({
          type: "error",
          text: "You already have an active reservation for this book."
        });
      } else {
        setNotice({
          type: "error",
          text: error.message
        });
      }
      setActiveAction(null);
      return;
    }

    setNotice({
      type: "success",
      text: "Reservation created successfully."
    });
    await loadReservationData();
    setActiveAction(null);
  };

  const handleCancelReservation = async (reservationId: string) => {
    if (!session?.user.id) return;

    setActiveAction(`cancel-${reservationId}`);
    setNotice(null);

    const { error } = await supabase
      .from("reservations")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString()
      })
      .eq("id", reservationId)
      .eq("user_id", session.user.id)
      .in("status", activeReservationStatuses);

    if (error) {
      setNotice({
        type: "error",
        text: error.message
      });
      setActiveAction(null);
      return;
    }

    setNotice({
      type: "success",
      text: "Reservation cancelled successfully."
    });
    await loadReservationData();
    setActiveAction(null);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const userEmail = session?.user.email ?? "student@vsu.edu.ph";

  if (!hasSupabaseEnv) {
    return (
      <main className="portal-page">
        <section className="portal-shell portal-single">
          <article className="portal-panel">
            <h1>Supabase not configured</h1>
            <p>Add your values in `web/.env` before using reservation features.</p>
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
            <h1>Loading reservations...</h1>
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className="portal-page">
      <div className="portal-shell">
        <header className="portal-topbar">
          <button type="button" className="portal-brand" onClick={() => navigate("/dashboard")}> 
            <img src="/assets/bookitstudent-logo.jpg" alt="BookItStudent logo" />
            <span>
              <strong>BookItStudent</strong>
              <em>Visayas State University</em>
            </span>
          </button>

          <nav className="portal-nav" aria-label="Primary navigation">
            <button type="button" className="portal-nav-item" onClick={() => navigate("/dashboard")}> 
              Dashboard
            </button>
            <button
              type="button"
              className="portal-nav-item active"
              onClick={() => navigate("/reservations")}
            >
              Reservations
            </button>
          </nav>

          <div className="portal-user-controls">
            <p className="portal-user-email" title={userEmail}>
              {userEmail}
            </p>
            <button type="button" className="btn btn-primary btn-small" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </header>

        <section className="portal-subhead">
          <div>
            <p className="eyebrow">DW.010.003</p>
            <h1>Reservation Workspace</h1>
            <p>Reserve available books and manage your active reservation queue in one place.</p>
          </div>
          <div className="portal-hero-actions">
            <button
              type="button"
              className="btn btn-soft"
              onClick={() => {
                void loadReservationData();
              }}
              disabled={isFetching}
            >
              {isFetching ? "Refreshing..." : "Refresh list"}
            </button>
          </div>
        </section>

        {notice ? <p className={`status ${notice.type} portal-notice`}>{notice.text}</p> : null}

        <section className="reservation-summary-strip" aria-label="Reservation summary">
          <article className="summary-card">
            <span>Books Available</span>
            <strong>{books.length}</strong>
          </article>
          <article className="summary-card">
            <span>Active Reservations</span>
            <strong>{reservations.length}</strong>
          </article>
          <article className="summary-card">
            <span>Search Results</span>
            <strong>{filteredBooks.length}</strong>
          </article>
        </section>

        <section className="reservation-toolbar">
          <label htmlFor="book-search" className="search-field">
            <span>Search available books</span>
            <input
              id="book-search"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Type title, subtitle, language, or year"
            />
          </label>
          <p className="toolbar-hint">Showing {filteredBooks.length} matching books.</p>
        </section>

        <section className="reservation-layout">
          <article className="portal-panel">
            <header className="panel-heading">
              <h2>Available Books</h2>
              <p>Reserve books that currently have available copies.</p>
            </header>

            {filteredBooks.length === 0 ? (
              <p className="empty-state">No books match your search right now.</p>
            ) : (
              <ul className="reservation-list">
                {filteredBooks.map((book) => {
                  const isReserved = reservedBookIds.has(book.id);
                  const isActionLoading = activeAction === `reserve-${book.id}`;

                  return (
                    <li key={book.id} className="reservation-item">
                      <div className="reservation-item-content">
                        <p className="reservation-item-title">{book.title}</p>
                        {book.subtitle ? <p className="reservation-item-meta">{book.subtitle}</p> : null}
                        <p className="reservation-item-meta">
                          {book.available_copies} of {book.total_copies} copies available
                          {book.language ? ` • ${book.language}` : ""}
                          {book.publication_year ? ` • ${book.publication_year}` : ""}
                        </p>
                      </div>
                      <div className="reservation-item-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          disabled={isReserved || isActionLoading}
                          onClick={() => {
                            void handleReserveBook(book.id);
                          }}
                        >
                          {isReserved ? "Already reserved" : isActionLoading ? "Saving..." : "Reserve"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>

          <article className="portal-panel portal-panel-secondary">
            <header className="panel-heading">
              <h2>Your Active Reservations</h2>
              <p>Track pending requests and cancel when needed.</p>
            </header>

            {reservations.length === 0 ? (
              <p className="empty-state">You have no active reservations yet.</p>
            ) : (
              <ul className="reservation-list">
                {reservations.map((reservation) => {
                  const isActionLoading = activeAction === `cancel-${reservation.id}`;

                  return (
                    <li key={reservation.id} className="reservation-item">
                      <div className="reservation-item-content">
                        <div className="reservation-item-head">
                          <p className="reservation-item-title">
                            {reservation.books?.title ?? "Unknown book"}
                          </p>
                          <span className={`status-pill status-${reservation.status}`}>
                            {formatStatus(reservation.status)}
                          </span>
                        </div>
                        {reservation.books?.subtitle ? (
                          <p className="reservation-item-meta">{reservation.books.subtitle}</p>
                        ) : null}
                        <p className="reservation-item-meta">
                          Requested: {formatDate(reservation.requested_at)}
                        </p>
                        {reservation.expires_at ? (
                          <p className="reservation-item-meta">
                            Expires: {formatDate(reservation.expires_at)}
                          </p>
                        ) : null}
                      </div>
                      <div className="reservation-item-actions">
                        <button
                          type="button"
                          className="btn btn-soft btn-small"
                          disabled={isActionLoading}
                          onClick={() => {
                            void handleCancelReservation(reservation.id);
                          }}
                        >
                          {isActionLoading ? "Cancelling..." : "Cancel reservation"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        </section>
      </div>
    </main>
  );
}
