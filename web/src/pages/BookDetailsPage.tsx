import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { useNavigate, useParams } from "react-router-dom";
import { hasSupabaseEnv, supabase } from "../lib/supabase";
import LibraryWorkspaceLayout from "../components/LibraryWorkspaceLayout";
import PortalLiveIndicator from "../components/PortalLiveIndicator";
import { useReservationNotifier } from "../hooks/useReservationNotifier";
import {
  RawAuthorRelation,
  formatAuthorLine,
  formatPublicationLabel,
  normalizeAuthors,
  normalizeTags,
} from "../lib/bookMetadata";

type RawCategoryRelation = {
  category_id: string;
  categories:
    | { id: string; name: string }
    | { id: string; name: string }[]
    | null;
};

type RawBookRecord = {
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
  available_copies: number;
  total_copies: number;
  tags: string[] | null;
  book_categories: RawCategoryRelation[] | null;
  book_authors: RawAuthorRelation[] | null;
};

type BookDetails = {
  id: string;
  isbn: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  language: string | null;
  publicationYear: number | null;
  publicationDate: string | null;
  coverImageUrl: string | null;
  availableCopies: number;
  totalCopies: number;
  tags: string[];
  categories: string[];
  authors: string[];
};

type ReviewRow = {
  id: string;
  book_id: string;
  user_id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
  updated_at: string;
};

type CommentRow = {
  id: string;
  book_id: string;
  user_id: string;
  comment_text: string;
  created_at: string;
  updated_at: string;
};

type Notice = {
  type: "success" | "error";
  text: string;
};

type LoadSource = "manual" | "live";
type FeedbackMode = "review" | "comment";
type ActiveReservationStatus =
  | "pending"
  | "approved"
  | "ready_for_pickup"
  | "reserved"
  | "queued"
  | "picked_up"
  | null;

type AvailabilityDay = {
  start_date: string;
  end_date: string;
  available_copies: number;
  total_copies: number;
  is_available: boolean;
};

function normalizeCategories(
  relations: RawCategoryRelation[] | null,
): string[] {
  if (!relations || relations.length === 0) return [];
  const values = new Set<string>();
  for (const relation of relations) {
    const categories = relation.categories;
    if (!categories) continue;
    if (Array.isArray(categories)) {
      for (const item of categories) {
        if (item.name) values.add(item.name);
      }
      continue;
    }
    if (categories.name) values.add(categories.name);
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function normalizeBook(record: RawBookRecord): BookDetails {
  return {
    id: record.id,
    isbn: record.isbn,
    title: record.title,
    subtitle: record.subtitle,
    description: record.description,
    publisher: record.publisher,
    language: record.language,
    publicationYear: record.publication_year,
    publicationDate: record.publication_date,
    coverImageUrl: record.cover_image_url,
    availableCopies: record.available_copies,
    totalCopies: record.total_copies,
    tags: normalizeTags(record.tags),
    categories: normalizeCategories(record.book_categories),
    authors: normalizeAuthors(record.book_authors),
  };
}

function getBookMonogram(title: string): string {
  const letters = title
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
  return letters || "BK";
}

function getToneClass(seed: string): string {
  const hash = Array.from(seed).reduce(
    (acc, char) => acc + char.charCodeAt(0),
    0,
  );
  return `tone-${(hash % 5) + 1}`;
}

function formatLastSync(value: string | null) {
  if (!value) return "Waiting for first sync";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waiting for first sync";
  return `Last sync ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateOnly(value: string | null | undefined) {
  if (!value) return "No date";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getAvailabilityLabel(
  book: Pick<BookDetails, "availableCopies" | "totalCopies">,
): string {
  if (book.availableCopies > 0) return "Available";
  if (book.totalCopies > 0) return "Borrowed";
  return "Reserved";
}

function mapReservationWriteError(message: string): string {
  if (
    message.includes("notification_delivery_status") ||
    message.includes("notification_dispatch_queue")
  ) {
    return "Reservation save failed due to a legacy notifier DB trigger. Run the latest migration SQL for this branch, then try again.";
  }
  return message;
}

export default function BookDetailsPage() {
  const navigate = useNavigate();
  const { bookId = "" } = useParams();
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [book, setBook] = useState<BookDetails | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [borrowCount, setBorrowCount] = useState(0);
  const [isFavorited, setIsFavorited] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState<FeedbackMode>("review");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [commentText, setCommentText] = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [activeReservationStatus, setActiveReservationStatus] =
    useState<ActiveReservationStatus>(null);
  const [isReservationModalOpen, setIsReservationModalOpen] = useState(false);
  const [availabilityDays, setAvailabilityDays] = useState<AvailabilityDay[]>(
    [],
  );
  const [selectedStartDate, setSelectedStartDate] = useState<string>("");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const bootstrap = async () => {
      if (!hasSupabaseEnv) {
        setIsBootstrapping(false);
        return;
      }
      const {
        data: { session: currentSession },
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

  const loadDetails = useCallback(
    async (source: LoadSource = "manual") => {
      if (!session?.user.id || !bookId) return;
      if (source === "manual") {
        setIsFetching(true);
      } else {
        setIsLiveSyncing(true);
      }

      const [
        bookResult,
        reviewsResult,
        commentsResult,
        favoritesResult,
        borrowResult,
        myBookmarkResult,
        myReservationResult,
      ] = await Promise.all([
        supabase
          .from("books")
          .select(
            "id,isbn,title,subtitle,description,publisher,language,publication_year,publication_date,cover_image_url,available_copies,total_copies,tags,book_categories(category_id,categories(id,name)),book_authors(author_id,authors(id,name))",
          )
          .eq("id", bookId)
          .maybeSingle(),
        supabase
          .from("book_reviews")
          .select("id,book_id,user_id,rating,review_text,created_at,updated_at")
          .eq("book_id", bookId)
          .order("updated_at", { ascending: false })
          .limit(150),
        supabase
          .from("book_comments")
          .select("id,book_id,user_id,comment_text,created_at,updated_at")
          .eq("book_id", bookId)
          .order("created_at", { ascending: false })
          .limit(250),
        supabase
          .from("bookmarks")
          .select("user_id", { count: "exact", head: true })
          .eq("book_id", bookId),
        supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .eq("book_id", bookId)
          .eq("status", "fulfilled"),
        supabase
          .from("bookmarks")
          .select("book_id")
          .eq("book_id", bookId)
          .eq("user_id", session.user.id)
          .maybeSingle(),
        supabase
          .from("reservations")
          .select("id,status")
          .eq("book_id", bookId)
          .eq("user_id", session.user.id)
          .in("status", [
            "pending",
            "approved",
            "ready_for_pickup",
            "reserved",
            "queued",
            "picked_up",
          ])
          .order("requested_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (bookResult.error) {
        setBook(null);
        setNotice({ type: "error", text: bookResult.error.message });
      } else if (!bookResult.data) {
        setBook(null);
        setNotice({ type: "error", text: "Book record not found." });
      } else {
        setBook(normalizeBook(bookResult.data as RawBookRecord));
      }

      if (reviewsResult.error) {
        setReviews([]);
        setNotice({
          type: "error",
          text:
            reviewsResult.error.code === "42P01"
              ? "book_reviews table is missing. Run the latest Supabase migration in this branch."
              : reviewsResult.error.message,
        });
      } else {
        setReviews((reviewsResult.data ?? []) as ReviewRow[]);
      }

      if (commentsResult.error) {
        setComments([]);
        setNotice({
          type: "error",
          text:
            commentsResult.error.code === "42P01"
              ? "book_comments table is missing. Run the latest Supabase migration in this branch."
              : commentsResult.error.message,
        });
      } else {
        setComments((commentsResult.data ?? []) as CommentRow[]);
      }

      if (!favoritesResult.error) setFavoriteCount(favoritesResult.count ?? 0);
      if (!borrowResult.error) setBorrowCount(borrowResult.count ?? 0);
      if (!myBookmarkResult.error)
        setIsFavorited(Boolean(myBookmarkResult.data));

      if (myReservationResult.error) {
        setNotice({ type: "error", text: myReservationResult.error.message });
        setActiveReservationStatus(null);
      } else {
        setActiveReservationStatus(
          (myReservationResult.data?.status as ActiveReservationStatus) ?? null,
        );
      }

      if (
        !bookResult.error &&
        !reviewsResult.error &&
        !commentsResult.error &&
        !favoritesResult.error &&
        !borrowResult.error &&
        !myBookmarkResult.error &&
        !myReservationResult.error
      ) {
        setNotice(null);
      }

      setLastSyncedAt(new Date().toISOString());
      if (source === "manual") {
        setIsFetching(false);
      } else {
        setIsLiveSyncing(false);
      }
    },
    [bookId, session?.user.id],
  );

  useEffect(() => {
    if (!session?.user.id || !bookId) return;
    void loadDetails("manual");
  }, [session?.user.id, bookId, loadDetails]);

  useEffect(() => {
    if (!session?.user.id || !hasSupabaseEnv || !bookId) return;
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const queueRefresh = () => {
      if (refreshTimeout) window.clearTimeout(refreshTimeout);
      refreshTimeout = window.setTimeout(() => {
        void loadDetails("live");
      }, 300);
    };
    const channel = supabase
      .channel(`book-details-realtime-${bookId}-${session.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "books",
          filter: `id=eq.${bookId}`,
        },
        queueRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "book_authors",
          filter: `book_id=eq.${bookId}`,
        },
        queueRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "book_categories",
          filter: `book_id=eq.${bookId}`,
        },
        queueRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "book_reviews",
          filter: `book_id=eq.${bookId}`,
        },
        queueRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "book_comments",
          filter: `book_id=eq.${bookId}`,
        },
        queueRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookmarks",
          filter: `book_id=eq.${bookId}`,
        },
        queueRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `book_id=eq.${bookId}`,
        },
        queueRefresh,
      )
      .subscribe();
    return () => {
      if (refreshTimeout) window.clearTimeout(refreshTimeout);
      void supabase.removeChannel(channel);
    };
  }, [bookId, session?.user.id, loadDetails]);

  const myReview = useMemo(() => {
    if (!session?.user.id) return null;
    return reviews.find((e) => e.user_id === session.user.id) ?? null;
  }, [reviews, session?.user.id]);

  const averageRating = useMemo(() => {
    if (reviews.length === 0) return 0;
    return reviews.reduce((sum, e) => sum + e.rating, 0) / reviews.length;
  }, [reviews]);

  const handleLoadMyReview = () => {
    if (!myReview) return;
    setFeedbackMode("review");
    setReviewRating(myReview.rating);
    setReviewText(myReview.review_text ?? "");
  };

  const loadReservationAvailability = useCallback(async () => {
    if (!book) return;
    setIsLoadingAvailability(true);
    setNotice(null);
    const windowStart = toDateInputValue(calendarMonth);
    const { data, error } = await supabase.rpc(
      "get_book_reservation_availability",
      {
        target_book_id: book.id,
        window_start: windowStart,
        days_to_check: 62,
      },
    );
    if (error) {
      setNotice({ type: "error", text: mapReservationWriteError(error.message) });
      setAvailabilityDays([]);
      setIsLoadingAvailability(false);
      return;
    }
    setAvailabilityDays((data ?? []) as AvailabilityDay[]);
    setIsLoadingAvailability(false);
  }, [book, calendarMonth]);

  useEffect(() => {
    if (!isReservationModalOpen) return;
    void loadReservationAvailability();
  }, [isReservationModalOpen, loadReservationAvailability]);

  const selectedAvailability = useMemo(
    () =>
      availabilityDays.find((day) => day.start_date === selectedStartDate) ??
      null,
    [availabilityDays, selectedStartDate],
  );

  const unavailableRanges = useMemo(
    () =>
      availabilityDays
        .filter((day) => !day.is_available)
        .slice(0, 8)
        .map((day) => `${formatDateOnly(day.start_date)} to ${formatDateOnly(day.end_date)}`),
    [availabilityDays],
  );

  const openReservationModal = () => {
    setSelectedStartDate("");
    setIsReservationModalOpen(true);
  };

  const handleReserve = async (joinQueueWhenFull = true) => {
    if (!session?.user.id || !book || !selectedStartDate) return;
    setActiveAction("reserve");
    setNotice(null);
    const { data, error } = await supabase.rpc("create_student_reservation", {
      target_book_id: book.id,
      desired_start: selectedStartDate,
      join_queue_when_full: joinQueueWhenFull,
    });
    if (error) {
      setNotice({
        type: "error",
        text:
          /already have/i.test(error.message)
            ? "You already have an active reservation for this book."
            : mapReservationWriteError(error.message),
      });
      setActiveAction(null);
      return;
    }
    const result = Array.isArray(data) ? data[0] : null;
    const status = String(result?.status ?? "reserved");
    if (!result?.reservation_id) {
      setNotice({
        type: "error",
        text: "Reservation did not finish. Please run the latest Supabase reservation migration, then try again.",
      });
      setActiveAction(null);
      return;
    }
    if (status === "pending") {
      setNotice({
        type: "error",
        text: "Your database is still using the old pending reservation flow. Run the latest Supabase reservation migration so reservations are saved as reserved and availability is decremented.",
      });
      setActiveAction(null);
      return;
    }
    setIsReservationModalOpen(false);
    setSelectedStartDate("");
    await loadDetails("live");
    setNotice({
      type: "success",
      text:
        status === "queued"
          ? "No copies are available for that week, so you were added to the waitlist."
          : "Reservation confirmed. You may pick it up starting on your selected date.",
    });
    setActiveAction(null);
  };

  const handleFavoriteToggle = async () => {
    if (!session?.user.id || !book) return;
    setActiveAction("favorite");
    setNotice(null);
    if (isFavorited) {
      const { error } = await supabase
        .from("bookmarks")
        .delete()
        .eq("user_id", session.user.id)
        .eq("book_id", book.id);
      if (error) {
        setNotice({ type: "error", text: error.message });
        setActiveAction(null);
        return;
      }
      setNotice({ type: "success", text: "Book removed from favorites." });
    } else {
      const { error } = await supabase
        .from("bookmarks")
        .insert({ user_id: session.user.id, book_id: book.id });
      if (error) {
        setNotice({ type: "error", text: error.message });
        setActiveAction(null);
        return;
      }
      setNotice({ type: "success", text: "Book added to favorites." });
    }
    await loadDetails("live");
    setActiveAction(null);
  };

  const handleReviewSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.user.id || !book) return;
    setActiveAction("review");
    setNotice(null);
    const trimmedReview = reviewText.trim();
    const { error } = await supabase.from("book_reviews").upsert(
      {
        book_id: book.id,
        user_id: session.user.id,
        rating: reviewRating,
        review_text: trimmedReview.length > 0 ? trimmedReview : null,
      },
      { onConflict: "book_id,user_id" },
    );
    if (error) {
      setNotice({ type: "error", text: error.message });
      setActiveAction(null);
      return;
    }
    setNotice({
      type: "success",
      text: myReview
        ? "Your review has been updated."
        : "Your review has been submitted.",
    });
    setReviewRating(5);
    setReviewText("");
    await loadDetails("live");
    setActiveAction(null);
  };

  const handleReviewDelete = async () => {
    if (!myReview) return;
    setActiveAction("delete-review");
    setNotice(null);
    const { error } = await supabase
      .from("book_reviews")
      .delete()
      .eq("id", myReview.id);
    if (error) {
      setNotice({ type: "error", text: error.message });
      setActiveAction(null);
      return;
    }
    setNotice({ type: "success", text: "Your review has been removed." });
    setReviewRating(5);
    setReviewText("");
    await loadDetails("live");
    setActiveAction(null);
  };

  const handleCommentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.user.id || !book) return;
    const trimmedComment = commentText.trim();
    if (!trimmedComment) {
      setNotice({
        type: "error",
        text: "Please enter a comment before posting.",
      });
      return;
    }
    setActiveAction("comment");
    setNotice(null);
    const { error } = await supabase.from("book_comments").insert({
      book_id: book.id,
      user_id: session.user.id,
      comment_text: trimmedComment,
    });
    if (error) {
      setNotice({ type: "error", text: error.message });
      setActiveAction(null);
      return;
    }
    setCommentText("");
    setNotice({ type: "success", text: "Comment posted." });
    await loadDetails("live");
    setActiveAction(null);
  };

  const handleDeleteComment = async (commentId: string) => {
    setActiveAction(`delete-comment-${commentId}`);
    setNotice(null);
    const { error } = await supabase
      .from("book_comments")
      .delete()
      .eq("id", commentId);
    if (error) {
      setNotice({ type: "error", text: error.message });
      setActiveAction(null);
      return;
    }
    setNotice({ type: "success", text: "Comment deleted." });
    await loadDetails("live");
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
            <p>Add your values in `web/.env` before using book details.</p>
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
            <h1>Loading book details...</h1>
          </article>
        </section>
      </main>
    );
  }
  if (!bookId) {
    return (
      <main className="portal-page">
        <section className="portal-shell portal-single">
          <article className="portal-panel">
            <h1>Invalid book link</h1>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate("/search")}
            >
              Return to discover
            </button>
          </article>
        </section>
      </main>
    );
  }

  return (
    <LibraryWorkspaceLayout
      activeRoute="search"
      activeMenuKey="discover"
      title={book?.title ?? "Book Details"}
      description="Review complete metadata, ratings, comments, and live engagement metrics for this catalog title."
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
        { label: "Borrowed", value: String(borrowCount) },
        { label: "Favorited", value: String(favoriteCount) },
      ]}
      sidebarAction={{
        label: isFetching ? "Refreshing..." : "Refresh Data",
        onClick: () => {
          void loadDetails("manual");
        },
        disabled: isFetching,
      }}
      statusBar={
        <PortalLiveIndicator
          isSyncing={isLiveSyncing}
          text={`${isLiveSyncing ? "Syncing live updates..." : "Book details live"} | ${formatLastSync(lastSyncedAt)}`}
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
      {!book ? (
        <section className="discover-section">
          <p className="empty-state">Book record not found.</p>
        </section>
      ) : (
        <>
          <section className="discover-section book-details-hero">
            <div
              className={`book-details-cover ${getToneClass(book.id)} ${book.coverImageUrl ? "has-image" : ""}`.trim()}
              style={
                book.coverImageUrl
                  ? {
                      backgroundImage: `linear-gradient(165deg, rgba(7, 66, 52, 0.42), rgba(7, 66, 52, 0.08)), url(${book.coverImageUrl})`,
                    }
                  : undefined
              }
            >
              {!book.coverImageUrl ? (
                <span>{getBookMonogram(book.title)}</span>
              ) : null}
            </div>

            <div className="book-details-meta">
              <div className="book-details-status-row">
                <span
                  className={`availability-pill ${book.availableCopies > 0 ? "available" : "borrowed"}`}
                >
                  {getAvailabilityLabel(book)}
                </span>
                <span className="availability-pill reserved">
                  {borrowCount} borrowed
                </span>
                <span className="availability-pill available">
                  {favoriteCount} favorites
                </span>
              </div>

              <div className="book-details-grid">
                <p>
                  <strong>Title:</strong> {book.title}
                </p>
                <p>
                  <strong>Author:</strong> {formatAuthorLine(book.authors)}
                </p>
                <p>
                  <strong>Publish date:</strong>{" "}
                  {formatPublicationLabel(
                    book.publicationDate,
                    book.publicationYear,
                  )}
                </p>
                <p>
                  <strong>ISBN:</strong> {book.isbn ?? "N/A"}
                </p>
                <p>
                  <strong>Subtitle:</strong> {book.subtitle ?? "N/A"}
                </p>
                <p>
                  <strong>Publisher:</strong> {book.publisher ?? "N/A"}
                </p>
                <p>
                  <strong>Language:</strong> {book.language ?? "N/A"}
                </p>
                <p>
                  <strong>Copies:</strong> {book.availableCopies} available /{" "}
                  {book.totalCopies} total
                </p>
                <p className="book-details-grid-span-2">
                  <strong>Tags:</strong>{" "}
                  {book.tags.length > 0 ? book.tags.join(", ") : "None"}
                </p>
              </div>

              <p className="book-details-description">
                <strong>Description:</strong>{" "}
                {book.description ?? "No description provided."}
              </p>

              <div className="book-details-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={() => {
                    openReservationModal();
                  }}
                  disabled={
                    activeAction === "reserve" ||
                    Boolean(activeReservationStatus)
                  }
                >
                  {activeReservationStatus
                      ? "Reserved"
                      : activeAction === "reserve"
                        ? "Saving..."
                        : "Reserve this book"}
                </button>
                <button
                  type="button"
                  className="btn btn-soft btn-small"
                  onClick={() => {
                    void handleFavoriteToggle();
                  }}
                  disabled={activeAction === "favorite"}
                >
                  {activeAction === "favorite"
                    ? "Saving..."
                    : isFavorited
                      ? "Remove from favorites"
                      : "Add to favorites"}
                </button>
              </div>
            </div>
          </section>
          <section className="discover-section book-feedback-composer">
            <header className="discover-section-head">
              <h2>Share Feedback</h2>
              <p className="discover-inline-meta">
                Switch between a review and a comment without stacking two
                textboxes on the page.
              </p>
            </header>

            <div
              className="book-feedback-toggle"
              role="tablist"
              aria-label="Feedback type"
            >
              <button
                type="button"
                role="tab"
                aria-selected={feedbackMode === "review"}
                className={`book-feedback-toggle-btn ${feedbackMode === "review" ? "active" : ""}`.trim()}
                onClick={() => setFeedbackMode("review")}
              >
                Write a review
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={feedbackMode === "comment"}
                className={`book-feedback-toggle-btn ${feedbackMode === "comment" ? "active" : ""}`.trim()}
                onClick={() => setFeedbackMode("comment")}
              >
                Add a comment
              </button>
            </div>

            {feedbackMode === "review" ? (
              <>
                <p className="book-feedback-note">
                  {myReview
                    ? "You already posted a review. Submit again to replace it, or reload your saved text into the form."
                    : "Choose a rating and add optional written feedback for other readers."}
                </p>
                <form
                  className="book-feedback-form"
                  onSubmit={handleReviewSubmit}
                >
                  <label className="settings-field">
                    <span>Rating</span>
                    <select
                      value={String(reviewRating)}
                      onChange={(e) => setReviewRating(Number(e.target.value))}
                    >
                      <option value="5">5 - Excellent</option>
                      <option value="4">4 - Very good</option>
                      <option value="3">3 - Good</option>
                      <option value="2">2 - Fair</option>
                      <option value="1">1 - Poor</option>
                    </select>
                  </label>
                  <label className="settings-field">
                    <span>Review</span>
                    <textarea
                      value={reviewText}
                      onChange={(e) => setReviewText(e.target.value)}
                      rows={4}
                      maxLength={2000}
                      placeholder="Write your review (optional if rating only)."
                    />
                  </label>
                  <div className="book-feedback-actions">
                    <button
                      type="submit"
                      className="btn btn-primary btn-small"
                      disabled={activeAction === "review"}
                    >
                      {activeAction === "review"
                        ? "Saving..."
                        : myReview
                          ? "Replace review"
                          : "Submit review"}
                    </button>
                    {myReview ? (
                      <button
                        type="button"
                        className="btn btn-soft btn-small"
                        onClick={handleLoadMyReview}
                        disabled={
                          activeAction === "review" ||
                          activeAction === "delete-review"
                        }
                      >
                        Use saved review
                      </button>
                    ) : null}
                    {myReview ? (
                      <button
                        type="button"
                        className="btn btn-soft btn-small"
                        disabled={activeAction === "delete-review"}
                        onClick={() => {
                          void handleReviewDelete();
                        }}
                      >
                        {activeAction === "delete-review"
                          ? "Removing..."
                          : "Delete my review"}
                      </button>
                    ) : null}
                  </div>
                </form>
              </>
            ) : (
              <>
                <p className="book-feedback-note">
                  Post a quick comment to join the discussion while keeping the
                  feedback area focused.
                </p>
                <form
                  className="book-feedback-form"
                  onSubmit={handleCommentSubmit}
                >
                  <label className="settings-field">
                    <span>Add comment</span>
                    <textarea
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      rows={4}
                      maxLength={2000}
                      placeholder="Write your comment."
                    />
                  </label>
                  <div className="book-feedback-actions">
                    <button
                      type="submit"
                      className="btn btn-primary btn-small"
                      disabled={activeAction === "comment"}
                    >
                      {activeAction === "comment"
                        ? "Posting..."
                        : "Post comment"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>

          <section
            className="workspace-summary-strip book-feedback-summary"
            aria-label="Feedback overview"
          >
            <article className="discover-stat-card">
              <span>Average Rating</span>
              <strong>{averageRating.toFixed(1)}</strong>
            </article>
            <article className="discover-stat-card">
              <span>Reviews</span>
              <strong>{reviews.length}</strong>
            </article>
            <article className="discover-stat-card">
              <span>Comments</span>
              <strong>{comments.length}</strong>
            </article>
            <article className="discover-stat-card">
              <span>Your Status</span>
              <strong>
                {activeReservationStatus
                  ? "Reserved"
                  : book.availableCopies > 0
                    ? "Can Reserve"
                    : "Unavailable"}
              </strong>
            </article>
          </section>

          <section className="discover-grid-two book-details-secondary">
            <article className="discover-section">
              <header className="discover-section-head">
                <h2>Ratings & Reviews</h2>
                <p className="discover-inline-meta">
                  {reviews.length} review(s) | Average{" "}
                  {averageRating.toFixed(1)} / 5
                </p>
              </header>
              {reviews.length === 0 ? (
                <p className="empty-state">
                  No reviews yet. Be the first to rate this book.
                </p>
              ) : (
                <ul className="book-feedback-list">
                  {reviews.map((entry) => (
                    <li
                      key={entry.id}
                      className={`book-feedback-item ${entry.user_id === session?.user.id ? "is-user" : ""}`.trim()}
                    >
                      <div className="book-feedback-head">
                        <p>
                          <strong>
                            {entry.user_id === session?.user.id
                              ? "You"
                              : "Reader"}
                          </strong>
                          <span>Rating: {entry.rating} / 5</span>
                        </p>
                        <time>{formatDateTime(entry.updated_at)}</time>
                      </div>
                      <p>
                        {entry.review_text ?? "No written review provided."}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="discover-section">
              <header className="discover-section-head">
                <h2>Comments</h2>
                <p className="discover-inline-meta">
                  {comments.length} comment(s)
                </p>
              </header>
              {comments.length === 0 ? (
                <p className="empty-state">
                  No comments yet. Start the discussion.
                </p>
              ) : (
                <ul className="book-feedback-list">
                  {comments.map((entry) => (
                    <li
                      key={entry.id}
                      className={`book-feedback-item ${entry.user_id === session?.user.id ? "is-user" : ""}`.trim()}
                    >
                      <div className="book-feedback-head">
                        <p>
                          <strong>
                            {entry.user_id === session?.user.id
                              ? "You"
                              : "Reader"}
                          </strong>
                        </p>
                        <time>{formatDateTime(entry.created_at)}</time>
                      </div>
                      <p>{entry.comment_text}</p>
                      {entry.user_id === session?.user.id ? (
                        <button
                          type="button"
                          className="btn btn-soft btn-small"
                          onClick={() => {
                            void handleDeleteComment(entry.id);
                          }}
                          disabled={
                            activeAction === `delete-comment-${entry.id}`
                          }
                        >
                          {activeAction === `delete-comment-${entry.id}`
                            ? "Deleting..."
                            : "Delete"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </section>
        </>
      )}
      {book && isReservationModalOpen ? (
        <div className="reservation-modal-backdrop" role="presentation">
          <section
            className="reservation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reservation-modal-title"
          >
            <header className="reservation-modal-header">
              <div>
                <p className="reservation-modal-eyebrow">Select pickup start</p>
                <h2 id="reservation-modal-title">{book.title}</h2>
                <p>
                  {book.totalCopies} total copies. Each reservation lasts 7 days
                  with a 1-day grace period after the due date.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-soft btn-small"
                onClick={() => setIsReservationModalOpen(false)}
              >
                Close
              </button>
            </header>

            <div className="reservation-calendar-toolbar">
              <button
                type="button"
                className="btn btn-soft btn-small"
                onClick={() =>
                  setCalendarMonth(
                    new Date(
                      calendarMonth.getFullYear(),
                      calendarMonth.getMonth() - 1,
                      1,
                    ),
                  )
                }
              >
                Previous
              </button>
              <strong>
                {calendarMonth.toLocaleDateString(undefined, {
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              <button
                type="button"
                className="btn btn-soft btn-small"
                onClick={() =>
                  setCalendarMonth(
                    new Date(
                      calendarMonth.getFullYear(),
                      calendarMonth.getMonth() + 1,
                      1,
                    ),
                  )
                }
              >
                Next
              </button>
            </div>

            {isLoadingAvailability ? (
              <p className="empty-state">Loading available reservation dates...</p>
            ) : (
              <div className="reservation-calendar-grid">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (label) => (
                    <span key={label} className="reservation-calendar-weekday">
                      {label}
                    </span>
                  ),
                )}
                {Array.from({
                  length:
                    new Date(
                      calendarMonth.getFullYear(),
                      calendarMonth.getMonth() + 1,
                      0,
                    ).getDate() + calendarMonth.getDay(),
                }).map((_, index) => {
                  const dayNumber = index - calendarMonth.getDay() + 1;
                  if (dayNumber < 1) {
                    return <span key={`blank-${index}`} />;
                  }
                  const cellDate = new Date(
                    calendarMonth.getFullYear(),
                    calendarMonth.getMonth(),
                    dayNumber,
                  );
                  const key = toDateInputValue(cellDate);
                  const availability =
                    availabilityDays.find((day) => day.start_date === key) ??
                    null;
                  const isPast = cellDate < addDays(new Date(), -1);
                  const isAvailable = Boolean(
                    availability?.is_available && !isPast,
                  );
                  const isSelected = selectedStartDate === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`reservation-calendar-day ${
                        isAvailable ? "available" : "unavailable"
                      } ${isSelected ? "selected" : ""}`.trim()}
                      disabled={isPast}
                      onClick={() => setSelectedStartDate(key)}
                    >
                      <span>{dayNumber}</span>
                      <small>
                        {availability
                          ? `${availability.available_copies} open`
                          : "No data"}
                      </small>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="reservation-modal-summary">
              {selectedStartDate ? (
                <>
                  <p>
                    <strong>Reservation period:</strong>{" "}
                    {formatDateOnly(selectedStartDate)} to{" "}
                    {formatDateOnly(selectedAvailability?.end_date)}
                  </p>
                  <p>
                    <strong>Availability:</strong>{" "}
                    {selectedAvailability?.is_available
                      ? `${selectedAvailability.available_copies} copy/copies available`
                      : "No stock for the full selected period"}
                  </p>
                </>
              ) : (
                <p>Select a start date to preview the 7-day reservation period.</p>
              )}
              {!selectedAvailability?.is_available && unavailableRanges.length > 0 ? (
                <p>
                  <strong>Currently full ranges:</strong>{" "}
                  {unavailableRanges.join("; ")}
                </p>
              ) : null}
            </div>

            <div className="reservation-modal-actions">
              <button
                type="button"
                className="btn btn-soft btn-small"
                onClick={() => setIsReservationModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={!selectedStartDate || activeAction === "reserve"}
                onClick={() => {
                  void handleReserve(true);
                }}
              >
                {activeAction === "reserve"
                  ? "Saving..."
                  : selectedAvailability && !selectedAvailability.is_available
                    ? "Join waitlist"
                    : "Confirm reservation"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </LibraryWorkspaceLayout>
  );
}
