import { useCallback, useEffect, useMemo, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { hasSupabaseEnv, supabase } from "../lib/supabase";
import PortalLiveIndicator from "../components/PortalLiveIndicator";
import LibraryWorkspaceLayout from "../components/LibraryWorkspaceLayout";
import { useReservationNotifier } from "../hooks/useReservationNotifier";
import {
  RawAuthorRelation,
  formatAuthorLine,
  formatPublicationLabel,
  normalizeAuthors
} from "../lib/bookMetadata";

type BookRecord = {
  id: string;
  isbn: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  language: string | null;
  publication_year: number | null;
  publication_date: string | null;
  cover_image_url: string | null;
  tags: string[] | null;
  available_copies: number;
  total_copies: number;
  book_authors: RawAuthorRelation[] | null;
};

type ReservationBook = {
  id: string;
  isbn: string | null;
  title: string;
  subtitle: string | null;
  publisher: string | null;
  language: string | null;
  publication_year: number | null;
  publication_date: string | null;
  cover_image_url: string | null;
  tags: string[] | null;
  available_copies: number;
  total_copies: number;
  book_authors: RawAuthorRelation[] | null;
};

type ReservationStatus = "pending" | "ready_for_pickup";

type ReservationRecord = {
  id: string;
  book_id: string;
  status: ReservationStatus;
  requested_at: string;
  expires_at: string | null;
  books: ReservationBook | ReservationBook[] | null;
};

type Notice = {
  type: "success" | "error";
  text: string;
};

type LoadSource = "manual" | "live";

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

function normalizeReservationBook(book: ReservationRecord["books"]): ReservationBook | null {
  if (!book) return null;
  return Array.isArray(book) ? book[0] ?? null : book;
}

function getBookMonogram(title: string): string {
  const letters = title
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return letters || "BK";
}

function getToneClass(seed: string): string {
  const hash = Array.from(seed).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return `tone-${(hash % 5) + 1}`;
}

export default function ReservationsPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
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

  const loadReservationData = useCallback(
    async (source: LoadSource = "manual") => {
      if (!session?.user.id) return;

      if (source === "manual") {
        setIsFetching(true);
      } else {
        setIsLiveSyncing(true);
      }

      const [booksResult, reservationsResult] = await Promise.all([
        supabase
          .from("books")
          .select(
            "id,isbn,title,subtitle,description,publisher,language,publication_year,publication_date,cover_image_url,tags,available_copies,total_copies,book_authors(author_id,authors(id,name))"
          )
          .gt("available_copies", 0)
          .order("title", { ascending: true })
          .limit(120),
        supabase
          .from("reservations")
          .select(
            "id,book_id,status,requested_at,expires_at,books(id,isbn,title,subtitle,publisher,language,publication_year,publication_date,cover_image_url,tags,available_copies,total_copies,book_authors(author_id,authors(id,name)))"
          )
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

      if (!booksResult.error && !reservationsResult.error) {
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
    void loadReservationData("manual");
  }, [session?.user.id, loadReservationData]);

  useEffect(() => {
    if (!session?.user.id || !hasSupabaseEnv) return;

    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const queueLiveRefresh = () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }

      refreshTimeout = window.setTimeout(() => {
        void loadReservationData("live");
      }, 320);
    };

    const channel = supabase
      .channel(`reservations-realtime-${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "books" }, queueLiveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_authors" }, queueLiveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "authors" }, queueLiveRefresh)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `user_id=eq.${session.user.id}`
        },
        queueLiveRefresh
      )
      .subscribe();

    return () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }
      void supabase.removeChannel(channel);
    };
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
        book.publication_year ? String(book.publication_year) : "",
        book.publication_date ?? "",
        book.isbn ?? "",
        book.publisher ?? "",
        (book.tags ?? []).join(" "),
        normalizeAuthors(book.book_authors).join(" ")
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
    await loadReservationData("live");
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
    await loadReservationData("live");
    setActiveAction(null);
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
    <LibraryWorkspaceLayout
      activeRoute="reservations"
      activeMenuKey="reservation"
      title="Reservation Workspace"
      description="Reserve available books and manage your active reservation queue in one place."
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
        { label: "Books Available", value: String(books.length) },
        { label: "Active Queue", value: String(reservations.length) }
      ]}
      sidebarAction={{
        label: isFetching ? "Refreshing..." : "Refresh List",
        onClick: () => {
          void loadReservationData("manual");
        },
        disabled: isFetching
      }}
      headerActions={
        <div className="discover-inline-actions">
          <button type="button" className="btn btn-soft btn-small" onClick={() => navigate("/search")}>
            Open Discover
          </button>
          <button type="button" className="btn btn-soft btn-small" onClick={() => navigate("/dashboard")}>
            Open Dashboard
          </button>
        </div>
      }
      statusBar={
        <PortalLiveIndicator
          isSyncing={isLiveSyncing}
          text={`${isLiveSyncing ? "Syncing live updates..." : "Live availability active"} | ${formatLastSync(lastSyncedAt)}`}
        />
      }
      notice={notice ? <p className={`status ${notice.type} portal-notice`}>{notice.text}</p> : undefined}
      onNavigate={(route) => navigate(`/${route}`)}
      onSignOut={handleSignOut}
    >
      <section className="discover-stat-strip" aria-label="Reservation summary">
        <article className="discover-stat-card">
          <span>Books Available</span>
          <strong>{books.length}</strong>
        </article>
        <article className="discover-stat-card">
          <span>Active Reservations</span>
          <strong>{reservations.length}</strong>
        </article>
        <article className="discover-stat-card">
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
            placeholder="Type title, author, ISBN, language, or year"
          />
        </label>
        <p className="toolbar-hint">Showing {filteredBooks.length} matching books.</p>
      </section>

      <section className="discover-grid-two reservation-workspace-grid">
        <article className="discover-section">
          <header className="discover-section-head">
            <h2>Available Books</h2>
          </header>

          {filteredBooks.length === 0 ? (
            <p className="empty-state">No books match your search right now.</p>
          ) : (
            <ul className="reservation-list reservation-list-available">
              {filteredBooks.map((book) => {
                const isReserved = reservedBookIds.has(book.id);
                const isActionLoading = activeAction === `reserve-${book.id}`;
                const authors = normalizeAuthors(book.book_authors);

                return (
                  <li key={book.id} className="reservation-item">
                    <div
                      className={`discover-result-cover ${getToneClass(book.id)} ${book.cover_image_url ? "has-image" : ""}`.trim()}
                      style={
                        book.cover_image_url
                          ? {
                              backgroundImage: `linear-gradient(165deg, rgba(7, 66, 52, 0.42), rgba(7, 66, 52, 0.08)), url(${book.cover_image_url})`
                            }
                          : undefined
                      }
                    >
                      {!book.cover_image_url ? <span>{getBookMonogram(book.title)}</span> : null}
                    </div>
                    <div className="reservation-item-content">
                      <p className="reservation-item-title">{book.title}</p>
                      <div className="reservation-meta-grid">
                        <p className="reservation-item-meta"><strong>Author:</strong> {formatAuthorLine(authors)}</p>
                        <p className="reservation-item-meta"><strong>Publish date:</strong> {formatPublicationLabel(book.publication_date, book.publication_year)}</p>
                        <p className="reservation-item-meta"><strong>ISBN:</strong> {book.isbn ?? "N/A"}</p>
                        <p className="reservation-item-meta"><strong>Subtitle:</strong> {book.subtitle ?? "N/A"}</p>
                        <p className="reservation-item-meta"><strong>Publisher:</strong> {book.publisher ?? "N/A"}</p>
                        <p className="reservation-item-meta"><strong>Language:</strong> {book.language ?? "N/A"}</p>
                        <p className="reservation-item-meta"><strong>Copies:</strong> {book.available_copies} available / {book.total_copies} total</p>
                        <p className="reservation-item-meta"><strong>Tags:</strong> {(book.tags ?? []).length > 0 ? (book.tags ?? []).join(", ") : "None"}</p>
                      </div>
                      <p className="reservation-item-meta reservation-description"><strong>Description:</strong> {book.description ?? "No description provided."}</p>
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

        <article className="discover-section">
          <header className="discover-section-head">
            <h2>Your Active Reservations</h2>
          </header>

          {reservations.length === 0 ? (
            <p className="empty-state">You have no active reservations yet.</p>
          ) : (
            <ul className="reservation-list reservation-list-active">
              {reservations.map((reservation) => {
                const isActionLoading = activeAction === `cancel-${reservation.id}`;
                const reservationBook = normalizeReservationBook(reservation.books);
                const authors = normalizeAuthors(reservationBook?.book_authors ?? null);

                return (
                  <li key={reservation.id} className="reservation-item">
                    <div
                      className={`discover-result-cover ${getToneClass(reservationBook?.id ?? reservation.id)} ${reservationBook?.cover_image_url ? "has-image" : ""}`.trim()}
                      style={
                        reservationBook?.cover_image_url
                          ? {
                              backgroundImage: `linear-gradient(165deg, rgba(7, 66, 52, 0.42), rgba(7, 66, 52, 0.08)), url(${reservationBook.cover_image_url})`
                            }
                          : undefined
                      }
                    >
                      {!reservationBook?.cover_image_url ? <span>{getBookMonogram(reservationBook?.title ?? "Book")}</span> : null}
                    </div>
                    <div className="reservation-item-content">
                      <div className="reservation-item-head">
                        <p className="reservation-item-title">{reservationBook?.title ?? "Unknown book"}</p>
                        <span className={`status-pill status-${reservation.status}`}>
                          {formatStatus(reservation.status)}
                        </span>
                      </div>
                      <div className="reservation-meta-grid">
                        <p className="reservation-item-meta"><strong>Author:</strong> {formatAuthorLine(authors)}</p>
                        <p className="reservation-item-meta"><strong>Publish date:</strong> {formatPublicationLabel(reservationBook?.publication_date, reservationBook?.publication_year)}</p>
                        <p className="reservation-item-meta"><strong>ISBN:</strong> {reservationBook?.isbn ?? "N/A"}</p>
                        <p className="reservation-item-meta"><strong>Subtitle:</strong> {reservationBook?.subtitle ?? "N/A"}</p>
                        <p className="reservation-item-meta"><strong>Publisher:</strong> {reservationBook?.publisher ?? "N/A"}</p>
                        <p className="reservation-item-meta"><strong>Language:</strong> {reservationBook?.language ?? "N/A"}</p>
                        <p className="reservation-item-meta"><strong>Copies:</strong> {reservationBook?.available_copies ?? 0} available / {reservationBook?.total_copies ?? 0} total</p>
                        <p className="reservation-item-meta"><strong>Tags:</strong> {(reservationBook?.tags ?? []).length > 0 ? (reservationBook?.tags ?? []).join(", ") : "None"}</p>
                        <p className="reservation-item-meta"><strong>Requested:</strong> {formatDate(reservation.requested_at)}</p>
                        <p className="reservation-item-meta"><strong>Expires:</strong> {reservation.expires_at ? formatDate(reservation.expires_at) : "No expiry"}</p>
                      </div>
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
    </LibraryWorkspaceLayout>
  );
}









