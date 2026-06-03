import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import LibraryWorkspaceLayout, {
  WorkspaceRoute,
} from "../components/LibraryWorkspaceLayout";
import { useReservationNotifier } from "../hooks/useReservationNotifier";
import { getUserRole, isStaffUser } from "../lib/authRouting";
import { hasSupabaseEnv, supabase } from "../lib/supabase";

type TransactionStatus =
  | "approved"
  | "reserved"
  | "queued"
  | "picked_up"
  | "returned"
  | "overdue"
  | "cancelled";
type BookStatus = "Available" | "Reserved" | "Borrowed" | "Archived";
type FineStatus = "Unpaid" | "Paid" | "Waived";
type UserStatus = "Active" | "Restricted" | "Suspended";

type Transaction = {
  id: string;
  sourceId: string;
  book: string;
  patron: string;
  type: "Reservation" | "Loan" | "Return";
  status: TransactionStatus;
  date: string;
  occurredAt: string;
  dueAt?: string;
  reservationStart?: string;
  reservationEnd?: string;
  pickedUpAt?: string;
  returnedAt?: string;
  approvedAt?: string;
  fineAmount?: number;
  userId?: string;
  bookId?: string;
  copyId?: string | null;
};

type CatalogBook = {
  id: string;
  title: string;
  author: string;
  isbn: string;
  category: string;
  language: string;
  year: string;
  status: BookStatus;
  copies: number;
  availableCopies: number;
  coverImageUrl: string;
};

type PickupRecord = {
  id: string;
  reservationId: string;
  userId: string;
  bookId: string;
  copyId: string | null;
  status: string;
  student: string;
  email: string;
  studentId: string;
  book: string;
  reservedAt: string;
  startDate: string;
  startDateValue: string;
  endDate: string;
  endDateValue: string;
  deadline: string;
  approvedAt: string | null;
  fineAmount: number;
};

type OverdueLoan = {
  id: string;
  borrower: string;
  book: string;
  due: string;
  days: number;
  fine: string;
  status: FineStatus;
};

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  loans: number;
  penalties: string;
  status: UserStatus;
};

type UserHistoryEntry = {
  id: string;
  date: string;
  title: string;
  detail: string;
};

type AdminMetrics = {
  totalBooks: number;
  activeLoans: number;
  pickupQueueCount: number;
  overdueBooks: number;
  availableBooks: number;
  reservedBooks: number;
  borrowedBooks: number;
};

type MonthlyMetric = {
  label: string;
  value: number;
  classes: string;
};

type AdminData = {
  books: CatalogBook[];
  transactions: Transaction[];
  pickupQueue: PickupRecord[];
  overdueLoans: OverdueLoan[];
  users: AdminUser[];
  metrics: AdminMetrics;
  monthly: MonthlyMetric[];
  chartRows: ChartRow[];
  mostBorrowed: Array<{ title: string; count: number }>;
  isLoading: boolean;
  notice: string;
  refresh: () => Promise<void>;
  saveBook: (book: CatalogBook) => Promise<void>;
  deleteBook: (bookId: string) => Promise<void>;
  approveCheckout: (pickup: PickupRecord, pickupWindowHours: number) => Promise<void>;
  markPickedUp: (pickup: PickupRecord, loanDays: number) => Promise<void>;
  processReturn: (transaction: Transaction) => Promise<void>;
  cancelReservation: (pickup: PickupRecord, reason?: string) => Promise<void>;
};

type ChartRow = {
  date: string;
  label: string;
  borrowed: number;
  returned: number;
  overdue: number;
  reservations: number;
};

type AdminConfig = {
  loanDurationDays: number;
  fineRatePesos: number;
  pickupWindowHours: number;
};

const defaultAdminConfig: AdminConfig = {
  loanDurationDays: 7,
  fineRatePesos: 50,
  pickupWindowHours: 48,
};

const emptyMetrics: AdminMetrics = {
  totalBooks: 0,
  activeLoans: 0,
  pickupQueueCount: 0,
  overdueBooks: 0,
  availableBooks: 0,
  reservedBooks: 0,
  borrowedBooks: 0,
};

const STATUS_CONFIG: Record<TransactionStatus, { label: string; classes: string }> = {
  approved: { label: "Approved", classes: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  reserved: { label: "Reserved", classes: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  queued: { label: "Queued", classes: "border-amber-200 bg-amber-50 text-amber-700" },
  cancelled: { label: "Cancelled", classes: "border-amber-200 bg-amber-50 text-amber-700" },
  picked_up: { label: "Picked up", classes: "border-teal-200 bg-teal-50 text-teal-700" },
  returned: { label: "Returned", classes: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  overdue: { label: "Overdue", classes: "border-rose-200 bg-rose-50 text-rose-700" },
};

const BOOK_STATUS_CLASSES: Record<BookStatus, string> = {
  Available: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Reserved: "border-amber-200 bg-amber-50 text-amber-700",
  Borrowed: "border-sky-200 bg-sky-50 text-sky-700",
  Archived: "border-slate-200 bg-slate-50 text-slate-500",
};

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMoney(value: number | null | undefined): string {
  return `PHP ${Number(value ?? 0).toFixed(2)}`;
}

function getProfileName(profile: Record<string, unknown> | null | undefined): string {
  if (!profile) return "Unknown user";
  const parts = [
    profile.first_name,
    profile.middle_name,
    profile.last_name,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  return parts.join(" ") || String(profile.email ?? "Unknown user");
}

function getBookTitle(book: unknown): string {
  if (Array.isArray(book)) return getBookTitle(book[0]);
  if (book && typeof book === "object" && "title" in book) {
    return String((book as { title?: unknown }).title ?? "Untitled book");
  }
  return "Untitled book";
}

function getCopyBookTitle(copy: unknown): string {
  if (Array.isArray(copy)) return getCopyBookTitle(copy[0]);
  if (copy && typeof copy === "object" && "books" in copy) {
    return getBookTitle((copy as { books?: unknown }).books);
  }
  return "Untitled book";
}

function mapReservationStatus(status: string): TransactionStatus {
  if (status === "reserved") return "reserved";
  if (status === "queued") return "queued";
  if (status === "picked_up") return "picked_up";
  if (status === "returned") return "returned";
  if (status === "approved" || status === "ready_for_pickup") return "approved";
  if (status === "fulfilled") return "picked_up";
  if (status === "cancelled" || status === "expired") return "cancelled";
  return "reserved";
}

function mapLoanStatus(status: string): TransactionStatus {
  if (status === "returned") return "returned";
  if (status === "overdue" || status === "lost") return "overdue";
  return "picked_up";
}

function getBookStatus(book: Record<string, unknown>): BookStatus {
  const totalCopies = Number(book.total_copies ?? 0);
  const availableCopies = Number(book.available_copies ?? 0);
  const copyRows = asArray<Record<string, unknown>>(book.book_copies as Record<string, unknown>[] | null);

  if (totalCopies <= 0) return "Archived";
  if (availableCopies > 0 || copyRows.some((copy) => copy.status === "available")) return "Available";
  if (copyRows.some((copy) => copy.status === "reserved")) return "Reserved";
  if (copyRows.some((copy) => copy.status === "checked_out")) return "Borrowed";
  return "Archived";
}

function getStoredAdminConfig(): AdminConfig {
  const raw = window.localStorage.getItem("bookit-admin-config");
  if (!raw) return defaultAdminConfig;
  try {
    return { ...defaultAdminConfig, ...(JSON.parse(raw) as Partial<AdminConfig>) };
  } catch {
    return defaultAdminConfig;
  }
}

function saveStoredAdminConfig(config: AdminConfig) {
  window.localStorage.setItem("bookit-admin-config", JSON.stringify(config));
}

function getCountdown(approvedAt: string | null, hours = 48) {
  if (!approvedAt) return { expired: false, label: "Not approved", ms: hours * 3600000 };
  const remaining = hours * 3600000 - (Date.now() - new Date(approvedAt).getTime());
  const safe = Math.max(0, remaining);
  const h = Math.floor(safe / 3600000);
  const m = Math.floor((safe % 3600000) / 60000);
  return { expired: remaining <= 0, label: `${h}h ${m}m`, ms: remaining };
}

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function withinDateRange(value: string | null | undefined, startDate: string, endDate: string): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = new Date(`${endDate}T23:59:59.999`).getTime();
  return time >= start && time <= end;
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  const safeRows = rows.length > 0 ? rows : [{ section: "empty", message: "No records available for export" }];
  const headers = Array.from(safeRows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  const escape = (value: string | number | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [
    headers.join(","),
    ...safeRows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getAdminExportRows(adminData: AdminData, dateRange?: { startDate: string; endDate: string }): Array<Record<string, string | number>> {
  const boundedTransactions = dateRange
    ? adminData.transactions.filter((tx) => withinDateRange(tx.occurredAt, dateRange.startDate, dateRange.endDate))
    : adminData.transactions;
  const inventory = adminData.books.map((book) => ({
    section: "inventory",
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    status: book.status,
    copies: book.copies,
    available_copies: book.availableCopies,
  }));
  const transactions = boundedTransactions.map((tx) => ({
    section: "transactions",
    id: tx.id,
    title: tx.book,
    user: tx.patron,
    type: tx.type,
    status: tx.status,
    date: tx.date,
    occurred_at: tx.occurredAt,
  }));
  const fines = adminData.overdueLoans.map((loan) => ({
    section: "fines",
    id: loan.id,
    user: loan.borrower,
    title: loan.book,
    fine: loan.fine,
    status: loan.status,
    due: loan.due,
  }));
  const users = adminData.users.map((user) => ({
    section: "users",
    user: user.name,
    email: user.email,
    role: user.role,
    active_loans: user.loans,
    penalties: user.penalties,
    status: user.status,
  }));
  return [...inventory, ...transactions, ...fines, ...users];
}

function exportAdminReport(adminData: AdminData, dateRange?: { startDate: string; endDate: string }) {
  const suffix = dateRange ? `${dateRange.startDate}-to-${dateRange.endDate}` : new Date().toISOString().slice(0, 10);
  downloadCsv(`bookit-admin-export-${suffix}.csv`, getAdminExportRows(adminData, dateRange));
}

function Badge({ children, classes }: { children: ReactNode; classes: string }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${classes}`}>
      {children}
    </span>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[1.8rem] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)] ${className}`}>
      {children}
    </section>
  );
}

function useAdminData(): AdminData {
  const [books, setBooks] = useState<CatalogBook[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pickupQueue, setPickupQueue] = useState<PickupRecord[]>([]);
  const [overdueLoans, setOverdueLoans] = useState<OverdueLoan[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [metrics, setMetrics] = useState<AdminMetrics>(emptyMetrics);
  const [monthly, setMonthly] = useState<MonthlyMetric[]>([
    { label: "Reservations", value: 0, classes: "bg-emerald-500" },
    { label: "Checkouts", value: 0, classes: "bg-sky-500" },
    { label: "Returns", value: 0, classes: "bg-amber-500" },
  ]);
  const [chartRows, setChartRows] = useState<ChartRow[]>([]);
  const [mostBorrowed, setMostBorrowed] = useState<Array<{ title: string; count: number }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    if (!hasSupabaseEnv) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const now = new Date();
    const config = getStoredAdminConfig();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [
      booksResult,
      reservationsResult,
      loansResult,
      profilesResult,
      monthlyReservationsResult,
      monthlyLoansResult,
      monthlyReturnsResult,
    ] = await Promise.all([
      supabase
        .from("books")
        .select("id,isbn,title,publication_year,language,total_copies,available_copies,cover_image_url,book_copies(status),book_authors(authors(name)),book_categories(categories(name))")
        .order("title", { ascending: true }),
      supabase
        .from("reservations")
        .select("id,status,requested_at,approved_at,expires_at,fulfilled_at,cancelled_at,reservation_start_date,reservation_end_date,picked_up_at,returned_at,fine_amount,user_id,book_id,copy_id,books(title)")
        .order("requested_at", { ascending: false })
        .limit(80),
      supabase
        .from("loans")
        .select("id,status,checked_out_at,picked_up_at,due_at,returned_at,fine_amount,last_overdue_notice_at,user_id,copy_id,book_copies(books(id,title))")
        .order("checked_out_at", { ascending: false })
        .limit(80),
      supabase
        .from("user_profiles")
        .select("id,email,student_number,first_name,middle_name,last_name,role,account_status,metadata"),
      supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .gte("requested_at", monthStart),
      supabase
        .from("loans")
        .select("id", { count: "exact", head: true })
        .gte("checked_out_at", monthStart),
      supabase
        .from("loans")
        .select("id", { count: "exact", head: true })
        .gte("returned_at", monthStart),
    ]);

    const errors = [
      booksResult.error,
      reservationsResult.error,
      loansResult.error,
      profilesResult.error,
    ].filter(Boolean);

    if (errors.length > 0) {
      setNotice(errors.map((error) => error?.message).join(" | "));
    } else {
      setNotice("");
    }

    const profileById = new Map<string, Record<string, unknown>>();
    for (const profile of (profilesResult.data ?? []) as Record<string, unknown>[]) {
      if (typeof profile.id === "string") profileById.set(profile.id, profile);
    }

    const nextBooks = ((booksResult.data ?? []) as Record<string, unknown>[]).map((book) => {
      const author = asArray<Record<string, unknown>>(book.book_authors as Record<string, unknown>[] | null)
        .map((entry) => asArray<Record<string, unknown>>(entry.authors as Record<string, unknown>[] | Record<string, unknown> | null)[0]?.name)
        .filter(Boolean)
        .join(", ");
      const category = asArray<Record<string, unknown>>(book.book_categories as Record<string, unknown>[] | null)
        .map((entry) => asArray<Record<string, unknown>>(entry.categories as Record<string, unknown>[] | Record<string, unknown> | null)[0]?.name)
        .filter(Boolean)
        .join(", ");
      return {
        id: String(book.id),
        title: String(book.title ?? "Untitled book"),
        author: author || "Unassigned",
        isbn: String(book.isbn ?? "No ISBN"),
        category: category || "Unassigned",
        language: String(book.language ?? "Not set"),
        year: book.publication_year ? String(book.publication_year) : "Not set",
        status: getBookStatus(book),
        copies: Number(book.total_copies ?? 0),
        availableCopies: Number(book.available_copies ?? 0),
        coverImageUrl: String(book.cover_image_url ?? ""),
      };
    });

    const reservationRows = (reservationsResult.data ?? []) as Record<string, unknown>[];
    const loanRows = (loansResult.data ?? []) as Record<string, unknown>[];
    for (const loan of loanRows) {
      const dueDate = loan.due_at ? new Date(String(loan.due_at)) : null;
      const isPastDue = dueDate && dueDate.getTime() < now.getTime();
      if (!isPastDue || loan.status === "returned") continue;
      const lastNotice = loan.last_overdue_notice_at ? new Date(String(loan.last_overdue_notice_at)) : null;
      const shouldNotify = !lastNotice || now.getTime() - lastNotice.getTime() >= 86400000;
      if (loan.status !== "overdue") {
        void supabase.from("loans").update({ status: "overdue" }).eq("id", loan.id).in("status", ["active", "picked_up"]);
      }
      if (shouldNotify) {
        const pickedUpAt = String(loan.picked_up_at ?? loan.checked_out_at ?? "");
        const days = Math.max(1, Math.ceil((now.getTime() - dueDate.getTime()) / 86400000));
        const fine = days * config.fineRatePesos;
        const overdueMessage = `${getCopyBookTitle(loan.book_copies)} is overdue. Borrowed: ${formatDate(pickedUpAt)}. Expected return: ${formatDate(String(loan.due_at))}. Days overdue: ${days}. Total accrued fines: ${formatMoney(fine)}.`;
        void supabase.from("notifications").insert({
          user_id: String(loan.user_id),
          type: "loan_overdue",
          title: "Overdue library loan",
          message: overdueMessage,
          action_url: "/reservations",
          metadata: { channel: "in_app", days_overdue: days, fine_amount: fine },
        });
        void supabase.from("notifications").insert({
          user_id: String(loan.user_id),
          type: "loan_overdue_email",
          title: `Email queued: overdue notice #${days}`,
          message: overdueMessage,
          action_url: "/reservations",
          metadata: { channel: "email", days_overdue: days, fine_amount: fine },
        });
        void supabase.from("loans").update({ last_overdue_notice_at: now.toISOString(), fine_amount: fine }).eq("id", loan.id);
      }
    }

    const reservationTransactions: Transaction[] = reservationRows.map((reservation) => {
      const profile = profileById.get(String(reservation.user_id));
      const occurredAt = String(reservation.returned_at ?? reservation.picked_up_at ?? reservation.cancelled_at ?? reservation.fulfilled_at ?? reservation.approved_at ?? reservation.requested_at ?? "");
      const dueAt = String(reservation.reservation_end_date ?? reservation.expires_at ?? "");
      const dueDate = dueAt ? new Date(dueAt) : null;
      const returnedAt = reservation.returned_at ? new Date(String(reservation.returned_at)) : null;
      const compareDate = returnedAt ?? now;
      const overdueDays = dueDate && !Number.isNaN(dueDate.getTime())
        ? Math.max(0, Math.ceil((compareDate.getTime() - dueDate.getTime()) / 86400000))
        : 0;
      return {
        id: `RES-${String(reservation.id).slice(0, 8)}`,
        sourceId: String(reservation.id),
        book: getBookTitle(reservation.books),
        patron: getProfileName(profile),
        type: "Reservation",
        status: mapReservationStatus(String(reservation.status)),
        date: formatDate(occurredAt),
        occurredAt,
        dueAt,
        reservationStart: reservation.reservation_start_date ? String(reservation.reservation_start_date) : undefined,
        reservationEnd: reservation.reservation_end_date ? String(reservation.reservation_end_date) : undefined,
        pickedUpAt: reservation.picked_up_at ? String(reservation.picked_up_at) : undefined,
        returnedAt: reservation.returned_at ? String(reservation.returned_at) : undefined,
        fineAmount: Number(reservation.fine_amount ?? overdueDays * config.fineRatePesos),
        approvedAt: reservation.approved_at ? String(reservation.approved_at) : undefined,
        userId: String(reservation.user_id),
        bookId: String(reservation.book_id),
        copyId: reservation.copy_id ? String(reservation.copy_id) : null,
      };
    });

    const loanTransactions: Transaction[] = loanRows.map((loan) => {
      const profile = profileById.get(String(loan.user_id));
      const isReturn = Boolean(loan.returned_at);
      const occurredAt = String(isReturn ? loan.returned_at : loan.picked_up_at ?? loan.checked_out_at ?? "");
      return {
        id: `${isReturn ? "RT" : "LN"}-${String(loan.id).slice(0, 8)}`,
        sourceId: String(loan.id),
        book: getCopyBookTitle(loan.book_copies),
        patron: getProfileName(profile),
        type: isReturn ? "Return" : "Loan",
        status: mapLoanStatus(String(loan.status)),
        date: formatDate(occurredAt),
        occurredAt,
        dueAt: loan.due_at ? String(loan.due_at) : undefined,
        pickedUpAt: loan.picked_up_at ? String(loan.picked_up_at) : String(loan.checked_out_at ?? ""),
        returnedAt: loan.returned_at ? String(loan.returned_at) : undefined,
        fineAmount: Number(loan.fine_amount ?? 0),
        userId: String(loan.user_id),
        copyId: loan.copy_id ? String(loan.copy_id) : null,
      };
    });

    const nextPickups = reservationRows
      .filter((reservation) =>
        ["reserved", "approved", "ready_for_pickup"].includes(
          String(reservation.status),
        ),
      )
      .map((reservation) => {
        const profile = profileById.get(String(reservation.user_id));
        return {
          id: `RES-${String(reservation.id).slice(0, 8)}`,
          reservationId: String(reservation.id),
          userId: String(reservation.user_id),
          bookId: String(reservation.book_id),
          copyId: reservation.copy_id ? String(reservation.copy_id) : null,
          status: String(reservation.status),
          student: getProfileName(profile),
          email: String(profile?.email ?? "No email"),
          studentId: String(profile?.student_number ?? "No student ID"),
          book: getBookTitle(reservation.books),
          reservedAt: formatDate(String(reservation.requested_at ?? "")),
          startDate: formatDate(String(reservation.reservation_start_date ?? reservation.requested_at ?? "")),
          startDateValue: String(reservation.reservation_start_date ?? reservation.requested_at ?? ""),
          endDate: formatDate(String(reservation.reservation_end_date ?? reservation.expires_at ?? "")),
          endDateValue: String(reservation.reservation_end_date ?? reservation.expires_at ?? ""),
          deadline: formatDate(String(reservation.reservation_end_date ?? reservation.expires_at ?? "")),
          approvedAt: reservation.approved_at ? String(reservation.approved_at) : null,
          fineAmount: Number(reservation.fine_amount ?? 0),
        };
      });

    const nextOverdueLoans = loanRows
      .filter((loan) => loan.status === "overdue" || ((loan.status === "active" || loan.status === "picked_up") && loan.due_at && new Date(String(loan.due_at)) < now))
      .map((loan) => {
        const profile = profileById.get(String(loan.user_id));
        const dueDate = new Date(String(loan.due_at));
        const days = Number.isNaN(dueDate.getTime())
          ? 0
          : Math.max(0, Math.ceil((now.getTime() - dueDate.getTime()) / 86400000));
        const fine = Number(loan.fine_amount ?? days * config.fineRatePesos);
        return {
          id: `LN-${String(loan.id).slice(0, 8)}`,
          borrower: getProfileName(profile),
          book: getCopyBookTitle(loan.book_copies),
          due: formatDate(String(loan.due_at ?? "")),
          days,
          fine: formatMoney(fine),
          status: fine > 0 ? "Unpaid" : "Paid",
        };
      });

    const activeLoansByUser = new Map<string, number>();
    const penaltiesByUser = new Map<string, number>();
    for (const loan of loanRows) {
      const userId = String(loan.user_id);
      if (loan.status === "active" || loan.status === "picked_up" || loan.status === "overdue") {
        activeLoansByUser.set(userId, (activeLoansByUser.get(userId) ?? 0) + 1);
      }
      penaltiesByUser.set(userId, (penaltiesByUser.get(userId) ?? 0) + Number(loan.fine_amount ?? 0));
    }

    const nextUsers = ((profilesResult.data ?? []) as Record<string, unknown>[]).map((profile) => {
      const accountStatus = String(profile.account_status ?? "active");
      const metadata = (profile.metadata && typeof profile.metadata === "object" ? profile.metadata : {}) as Record<string, unknown>;
      const restrictedUntil = typeof metadata.restricted_until === "string" ? new Date(metadata.restricted_until) : null;
      const restrictionExpired = restrictedUntil ? restrictedUntil.getTime() <= now.getTime() : false;
      if (accountStatus === "suspended" && restrictionExpired) {
        void supabase
          .from("user_profiles")
          .update({
            account_status: "active",
            metadata: { ...metadata, restriction_reason: null, restricted_until: null },
          })
          .eq("id", profile.id);
      }
      const penaltyAmount = penaltiesByUser.get(String(profile.id)) ?? 0;
      return {
        id: String(profile.id),
        name: getProfileName(profile),
        email: String(profile.email ?? "No email"),
        role: String(profile.role ?? "student"),
        loans: activeLoansByUser.get(String(profile.id)) ?? 0,
        penalties: formatMoney(penaltyAmount),
        status: accountStatus === "suspended" && !restrictionExpired ? "Suspended" : penaltyAmount > 0 ? "Restricted" : "Active",
      };
    });

    const borrowedBooks = loanRows.filter((loan) => loan.status === "active" || loan.status === "picked_up" || loan.status === "overdue").length;
    const reservedBooks = reservationRows.filter((reservation) => ["reserved", "approved", "ready_for_pickup"].includes(String(reservation.status))).length;
    const availableBooks = nextBooks.reduce((sum, book) => {
      if (book.status === "Available") return sum + book.copies;
      return sum;
    }, 0);

    const borrowCounts = new Map<string, number>();
    for (const loan of loanRows) {
      const title = getCopyBookTitle(loan.book_copies);
      borrowCounts.set(title, (borrowCounts.get(title) ?? 0) + 1);
    }
    const nextChartRows = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (29 - index));
      const key = date.toISOString().slice(0, 10);
      const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return {
        date: key,
        label,
        borrowed: loanRows.filter((loan) => String(loan.picked_up_at ?? loan.checked_out_at ?? "").slice(0, 10) === key).length,
        returned: loanRows.filter((loan) => String(loan.returned_at ?? "").slice(0, 10) === key).length,
        overdue: loanRows.filter((loan) => String(loan.due_at ?? "").slice(0, 10) === key && (loan.status === "overdue" || loan.status === "active" || loan.status === "picked_up")).length,
        reservations: reservationRows.filter((reservation) => String(reservation.requested_at ?? "").slice(0, 10) === key).length,
      };
    });

    setBooks(nextBooks);
    setTransactions([...reservationTransactions, ...loanTransactions].slice(0, 80));
    setPickupQueue(nextPickups);
    setOverdueLoans(nextOverdueLoans);
    setUsers(nextUsers);
    setMetrics({
      totalBooks: nextBooks.reduce((sum, book) => sum + book.copies, 0),
      activeLoans: borrowedBooks,
      pickupQueueCount: nextPickups.length,
      overdueBooks: nextOverdueLoans.length,
      availableBooks,
      reservedBooks,
      borrowedBooks,
    });
    setMonthly([
      { label: "Reservations", value: monthlyReservationsResult.count ?? 0, classes: "bg-emerald-500" },
      { label: "Checkouts", value: monthlyLoansResult.count ?? 0, classes: "bg-sky-500" },
      { label: "Returns", value: monthlyReturnsResult.count ?? 0, classes: "bg-amber-500" },
    ]);
    setChartRows(nextChartRows);
    setMostBorrowed(
      Array.from(borrowCounts.entries())
        .map(([title, count]) => ({ title, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveBook = useCallback(async (book: CatalogBook) => {
    const payload = {
      title: book.title,
      isbn: book.isbn === "No ISBN" ? null : book.isbn,
      language: book.language === "Not set" ? null : book.language,
      publication_year: Number.isFinite(Number(book.year)) ? Number(book.year) : null,
      total_copies: Number(book.copies),
      available_copies: Number(book.availableCopies),
      cover_image_url: book.coverImageUrl || null,
    };
    let bookId = book.id;

    if (book.id) {
      const { error } = await supabase.from("books").update(payload).eq("id", book.id);
      if (error) {
        setNotice(error.message);
        return;
      }
    } else {
      const { data, error } = await supabase.from("books").insert(payload).select("id").single();
      if (error) {
        setNotice(error.message);
        return;
      }
      bookId = String(data.id);
    }

    if (bookId && book.author.trim()) {
      const { data: authorRow, error: authorError } = await supabase
        .from("authors")
        .upsert({ name: book.author.trim() }, { onConflict: "name" })
        .select("id")
        .single();
      if (!authorError && authorRow?.id) {
        await supabase.from("book_authors").delete().eq("book_id", bookId);
        await supabase.from("book_authors").insert({ book_id: bookId, author_id: authorRow.id });
      }
    }

    if (bookId && book.category.trim()) {
      const { data: categoryRow, error: categoryError } = await supabase
        .from("categories")
        .upsert({ name: book.category.trim() }, { onConflict: "name" })
        .select("id")
        .single();
      if (!categoryError && categoryRow?.id) {
        await supabase.from("book_categories").delete().eq("book_id", bookId);
        await supabase.from("book_categories").insert({ book_id: bookId, category_id: categoryRow.id });
      }
    }

    await refresh();
  }, [refresh]);

  const deleteBook = useCallback(async (bookId: string) => {
    const { error } = await supabase.from("books").delete().eq("id", bookId);
    if (error) {
      setNotice(error.message);
      return;
    }
    await refresh();
  }, [refresh]);

  const approveCheckout = useCallback(async (pickup: PickupRecord, pickupWindowHours: number) => {
    const status = pickup.status.toLowerCase();
    if (!["reserved", "ready_for_pickup"].includes(status)) {
      setNotice("Only reserved or ready pickup reservations can be approved.");
      return;
    }
    const approvedAt = new Date();
    const expiresAt = new Date(approvedAt.getTime() + pickupWindowHours * 3600000).toISOString();
    const { error } = await supabase
      .from("reservations")
      .update({ status: "approved", approved_at: approvedAt.toISOString(), expires_at: expiresAt })
      .eq("id", pickup.reservationId)
      .in("status", ["reserved", "ready_for_pickup"]);
    if (error) {
      setNotice(error.message);
      return;
    }
    await supabase.from("notifications").insert({
      user_id: pickup.userId,
      type: "reservation_approved",
      title: "Reservation approved",
      message: `Your reservation for ${pickup.book} has been approved! Please pick it up at the library within the next ${pickupWindowHours} hours. Unclaimed books will be automatically cancelled. Expires: ${new Date(expiresAt).toLocaleString()}.`,
      action_url: "/reservations",
    });
    await refresh();
  }, [refresh]);

  const markPickedUp = useCallback(async (pickup: PickupRecord, loanDays: number) => {
    if (!["reserved", "approved", "ready_for_pickup"].includes(pickup.status.toLowerCase())) {
      setNotice("Only active reservations can be marked as picked up.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const dueAt = new Date(pickup.endDateValue);
    const fallbackDueAt = new Date(Date.now() + loanDays * 86400000);
    const { data, error } = await supabase.rpc("admin_mark_reservation_picked_up", {
      target_reservation_id: pickup.reservationId,
      checkout_by: session?.user.id ?? null,
      due_timestamp: Number.isNaN(dueAt.getTime()) ? fallbackDueAt.toISOString() : dueAt.toISOString(),
    });
    if (error) {
      setNotice(error.message);
      return;
    }
    const result = Array.isArray(data) ? data[0] : null;
    if (result && result.was_checked_out === false) {
      setNotice("Reservation was already processed or no available physical copy was found.");
      return;
    }
    await refresh();
  }, [refresh]);

  const cancelReservation = useCallback(async (pickup: PickupRecord, reason = "manual") => {
    const { data, error } = await supabase.rpc("admin_cancel_reservation", {
      target_reservation_id: pickup.reservationId,
      cancel_reason: reason,
    });
    if (error) {
      setNotice(error.message);
      return;
    }
    const result = Array.isArray(data) ? data[0] : null;
    if (result && result.was_cancelled === false) {
      await refresh();
      return;
    }
    await supabase.from("notifications").insert({
      user_id: pickup.userId,
      type: "reservation_cancelled",
      title: "Reservation cancelled",
      message: reason === "expired"
        ? `Your reservation for ${pickup.book} has been automatically cancelled because it wasn't claimed within the 48-hour grace period.`
        : `Your reservation for ${pickup.book} has been cancelled because it wasn't picked up within the 48-hour grace period.`,
      action_url: "/reservations",
      metadata: { reason },
    });
    await refresh();
  }, [refresh]);

  const processReturn = useCallback(async (transaction: Transaction) => {
    if (!["picked_up", "overdue"].includes(transaction.status)) {
      setNotice("Only picked up or overdue loans can be returned.");
      return;
    }
    const { data, error } = await supabase.rpc("admin_process_loan_return", {
      target_loan_id: transaction.sourceId,
    });
    if (error) {
      setNotice(error.message);
      return;
    }
    const result = Array.isArray(data) ? data[0] : null;
    if (result && result.was_returned === false) {
      setNotice("Loan was already returned or is no longer active.");
      await refresh();
      return;
    }
    await refresh();
  }, [refresh]);

  return {
    books,
    transactions,
    pickupQueue,
    overdueLoans,
    users,
    metrics,
    monthly,
    chartRows,
    mostBorrowed,
    isLoading,
    notice,
    refresh,
    saveBook,
    deleteBook,
    approveCheckout,
    markPickedUp,
    processReturn,
    cancelReservation,
  };
}

function AdminShell({
  activeRoute,
  title,
  description,
  headerActions,
  children,
}: {
  activeRoute: WorkspaceRoute;
  title: string;
  description: string;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [authNotice, setAuthNotice] = useState("");

  useEffect(() => {
    let isMounted = true;
    let roleCheckTimer: ReturnType<typeof window.setTimeout> | undefined;

    const verifyStaffAccess = (nextSession: Session) => {
      if (roleCheckTimer) window.clearTimeout(roleCheckTimer);
      roleCheckTimer = window.setTimeout(() => {
        void (async () => {
          const role = await getUserRole(nextSession.user.id);
          const allowed = await isStaffUser(nextSession.user.id);
          if (!isMounted) return;
          if (!allowed && role === "student") {
            navigate("/dashboard", { replace: true });
            return;
          }
          if (!allowed) {
            setAuthNotice("Admin access verification is still syncing. Staying in the admin workspace.");
          }
        })();
      }, 0);
    };

    const bootstrap = async () => {
      if (!hasSupabaseEnv) {
        setIsBootstrapping(false);
        return;
      }

      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (!currentSession) {
        setIsBootstrapping(false);
        navigate("/", { replace: true });
        return;
      }

      setSession(currentSession);
      setIsBootstrapping(false);
      verifyStaffAccess(currentSession);
    };

    void bootstrap();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) {
        setSession(null);
        setIsBootstrapping(false);
        navigate("/", { replace: true });
        return;
      }
      setSession(nextSession);
      setIsBootstrapping(false);
      verifyStaffAccess(nextSession);
    });

    return () => {
      isMounted = false;
      if (roleCheckTimer) window.clearTimeout(roleCheckTimer);
      subscription.unsubscribe();
    };
  }, [navigate]);

  const notifier = useReservationNotifier(session?.user.id);
  const sidebarData = useAdminData();

  if (!hasSupabaseEnv || isBootstrapping) {
    return (
      <main className="portal-page">
        <section className="portal-shell portal-single">
          <article className="portal-panel">
            <h1>{!hasSupabaseEnv ? "Supabase not configured" : "Loading admin workspace..."}</h1>
          </article>
        </section>
      </main>
    );
  }

  return (
    <LibraryWorkspaceLayout
      activeRoute={activeRoute}
      audience="admin"
      title={title}
      description={description}
      notice={authNotice ? <p className="status error portal-notice">{authNotice}</p> : undefined}
      userEmail={session?.user.email ?? "admin@vsu.edu.ph"}
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
        { label: "Pickup Queue", value: String(sidebarData.metrics.pickupQueueCount) },
        { label: "Overdue", value: String(sidebarData.metrics.overdueBooks) },
      ]}
      sidebarAction={{
        label: "Export Report",
        onClick: () => navigate("/admin-reports"),
      }}
      headerActions={headerActions}
      onNavigate={(route) => navigate(`/${route}`)}
      onSignOut={async () => {
        await supabase.auth.signOut();
        navigate("/", { replace: true });
      }}
    >
      <div className="space-y-5">{children}</div>
    </LibraryWorkspaceLayout>
  );
}

function AdminDashboard() {
  const adminData = useAdminData();
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTransactions = useMemo(() => {
    return adminData.transactions.filter((tx) => {
      if (statusFilter !== "all" && tx.status !== statusFilter) return false;
      const query = searchQuery.trim().toLowerCase();
      return !query || tx.book.toLowerCase().includes(query) || tx.patron.toLowerCase().includes(query) || tx.id.toLowerCase().includes(query);
    });
  }, [adminData.transactions, statusFilter, searchQuery]);

  const statData = [
    { label: "Total Books", value: String(adminData.metrics.totalBooks), note: "Inventory across active catalog", accent: "bg-emerald-500", noteClass: "text-emerald-600" },
    { label: "Active Loans", value: String(adminData.metrics.activeLoans), note: "Borrowed books currently out", accent: "bg-sky-500", noteClass: "text-sky-600" },
    { label: "Pickup Queue", value: String(adminData.metrics.pickupQueueCount), note: "Awaiting librarian verification", accent: "bg-amber-500", noteClass: "text-amber-600" },
    { label: "Overdue Books", value: String(adminData.metrics.overdueBooks), note: "Past due or marked overdue", accent: "bg-rose-500", noteClass: "text-rose-600" },
  ];

  return (
    <>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statData.map((stat) => (
          <article key={stat.label} className="relative overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.07)]">
            <div className={`absolute bottom-0 left-0 top-0 w-[3px] ${stat.accent}`} />
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{stat.label}</p>
            <strong className="mt-2 block text-[2.2rem] font-semibold leading-none tracking-tight text-slate-900">{stat.value}</strong>
            <p className={`mt-2 text-xs font-medium ${stat.noteClass}`}>{stat.note}</p>
          </article>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Available", value: String(adminData.metrics.availableBooks), classes: "border-emerald-200 bg-emerald-50 text-emerald-700" },
          { label: "Reserved", value: String(adminData.metrics.reservedBooks), classes: "border-amber-200 bg-amber-50 text-amber-700" },
          { label: "Borrowed", value: String(adminData.metrics.borrowedBooks), classes: "border-sky-200 bg-sky-50 text-sky-700" },
        ].map((item) => (
          <article key={item.label} className={`rounded-[1.35rem] border p-4 shadow-[0_4px_16px_rgba(15,23,42,0.06)] ${item.classes}`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] opacity-80">{item.label}</p>
            <strong className="mt-2 block text-3xl font-semibold tracking-tight">{item.value}</strong>
          </article>
        ))}
      </section>

      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">Transaction Log</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">Recent Reservations, Checkouts & Returns</h2>
            <p className="mt-1 text-sm text-slate-500">{adminData.isLoading ? "Loading database records..." : `${filteredTransactions.length} of ${adminData.transactions.length} records shown`}</p>
            {adminData.notice ? <p className="mt-1 text-xs text-rose-600">{adminData.notice}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search book, patron, ID" />
            <select className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-emerald-600" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {["all", "reserved", "approved", "queued", "picked_up", "overdue", "returned", "cancelled"].map((status) => <option key={status} value={status}>{status === "all" ? "All Status" : status.replace(/_/g, " ")}</option>)}
            </select>
          </div>
        </div>
        <AdminTransactionTable rows={filteredTransactions} />
      </Panel>
    </>
  );
}

function AdminTransactionTable({
  rows,
  onProcessReturn,
  onView,
}: {
  rows: Transaction[];
  onProcessReturn?: (transaction: Transaction) => void;
  onView?: (transaction: Transaction) => void;
}) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[980px]">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/60">
            {["Transaction ID", "Book Title", "Patron", "Type", "Status", "Start", "Due", "Picked Up", "Returned", "Fine", "Actions"].map((heading) => (
              <th key={heading} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((tx) => (
            <tr key={tx.id} className="border-b border-slate-100 transition-colors hover:bg-emerald-50/40">
              <td className="px-4 py-3.5 font-mono text-xs text-slate-400">{tx.id}</td>
              <td className="px-4 py-3.5 text-sm font-medium text-slate-800">{tx.book}</td>
              <td className="px-4 py-3.5 text-sm text-slate-600">{tx.patron}</td>
              <td className="px-4 py-3.5"><Badge classes="border-slate-200 bg-slate-50 text-slate-500">{tx.type}</Badge></td>
              <td className="px-4 py-3.5"><Badge classes={STATUS_CONFIG[tx.status].classes}>{STATUS_CONFIG[tx.status].label}</Badge></td>
              <td className="px-4 py-3.5 text-xs text-slate-400">{formatDate(tx.reservationStart ?? tx.pickedUpAt ?? tx.occurredAt)}</td>
              <td className="px-4 py-3.5 text-xs text-slate-400">{formatDate(tx.reservationEnd ?? tx.dueAt)}</td>
              <td className="px-4 py-3.5 text-xs text-slate-400">{formatDate(tx.pickedUpAt)}</td>
              <td className="px-4 py-3.5 text-xs text-slate-400">{formatDate(tx.returnedAt)}</td>
              <td className="px-4 py-3.5 text-xs font-semibold text-slate-600">{formatMoney(tx.fineAmount ?? 0)}</td>
              <td className="px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700" onClick={() => onView?.(tx)}>View</button>
                  {tx.type === "Loan" && ["picked_up", "overdue"].includes(tx.status) ? <button className="admin-action-button rounded-lg bg-sky-700 px-2.5 py-1 text-xs font-semibold text-white" onClick={() => onProcessReturn?.(tx)}>Process Return</button> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminInventory() {
  const adminData = useAdminData();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [editingBook, setEditingBook] = useState<CatalogBook | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogBook | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const filteredBooks = useMemo(() => adminData.books.filter((book) => {
    const matchesStatus = status === "all" || book.status === status;
    const haystack = `${book.title} ${book.author} ${book.isbn} ${book.category}`.toLowerCase();
    return matchesStatus && haystack.includes(query.toLowerCase());
  }), [adminData.books, query, status]);

  const openForm = (book?: CatalogBook) => {
    setEditingBook(book ?? null);
    setIsFormOpen(true);
  };

  const saveBook = (book: CatalogBook) => {
    void adminData.saveBook(book);
    setIsFormOpen(false);
  };

  return (
    <>
      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">Catalog Manager</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">Physical book inventory and bibliographic records</h2>
            {adminData.notice ? <p className="mt-1 text-xs text-rose-600">{adminData.notice}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <input className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm outline-none focus:border-emerald-600" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, ISBN, category" />
            <select className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-emerald-600" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All Status</option>
              {Object.keys(BOOK_STATUS_CLASSES).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => openForm()}>Add Book</button>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                {["Title", "Author", "ISBN", "Category", "Language", "Year", "Status", "Copies", "Actions"].map((heading) => <th key={heading} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {filteredBooks.map((book) => (
                <tr key={book.id} className="border-b border-slate-100">
                  <td className="px-4 py-3.5 text-sm font-semibold text-slate-800">{book.title}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{book.author}</td>
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-400">{book.isbn}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{book.category}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{book.language}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{book.year}</td>
                  <td className="px-4 py-3.5"><Badge classes={BOOK_STATUS_CLASSES[book.status]}>{book.status}</Badge></td>
                  <td className="px-4 py-3.5 text-sm font-semibold text-slate-700">{book.copies}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex gap-1.5">
                      <button className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600" onClick={() => openForm(book)}>Edit</button>
                      <button className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700" onClick={() => setDeleteTarget(book)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!adminData.isLoading && filteredBooks.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-400">No database books match the current filters.</p> : null}
        </div>
      </Panel>
      {isFormOpen ? <BookForm book={editingBook} onCancel={() => setIsFormOpen(false)} onSave={saveBook} /> : null}
      {deleteTarget ? (
        <DeleteBookModal
          book={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            void adminData.deleteBook(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      ) : null}
    </>
  );
}

function BookForm({ book, onCancel, onSave }: { book: CatalogBook | null; onCancel: () => void; onSave: (book: CatalogBook) => void }) {
  const [form, setForm] = useState<CatalogBook>(book ?? { id: "", title: "", author: "", isbn: "", category: "Engineering", language: "English", year: "2026", status: "Available", copies: 1, availableCopies: 1, coverImageUrl: "" });
  const [uploadMessage, setUploadMessage] = useState("");
  const update = (key: keyof CatalogBook, value: string | number) => setForm((current) => ({ ...current, [key]: value }));
  const handleCoverFile = async (file: File | undefined) => {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    update("coverImageUrl", previewUrl);
    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const { error } = await supabase.storage.from("covers").upload(safeName, file, { upsert: true });
    if (error) {
      setUploadMessage("Storage bucket unavailable. Use the cover image URL field.");
      return;
    }
    const { data } = supabase.storage.from("covers").getPublicUrl(safeName);
    update("coverImageUrl", data.publicUrl);
    setUploadMessage("Cover uploaded.");
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4">
      <form onSubmit={submit} className="w-full max-w-2xl rounded-[1.4rem] border border-slate-200 bg-white p-5 shadow-2xl">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">{book ? "Edit Book Record" : "Add Book Record"}</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <input required className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Book title" value={form.title} onChange={(event) => update("title", event.target.value)} />
          <input required className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Author" value={form.author} onChange={(event) => update("author", event.target.value)} />
          <input required className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="ISBN" value={form.isbn} onChange={(event) => update("isbn", event.target.value)} />
          <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={form.category} onChange={(event) => update("category", event.target.value)}>
            {["Engineering", "Technology", "Science", "Agriculture", "Language"].map((item) => <option key={item}>{item}</option>)}
          </select>
          <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Language" value={form.language} onChange={(event) => update("language", event.target.value)} />
          <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Publication year" value={form.year} onChange={(event) => update("year", event.target.value)} />
          <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={form.status} onChange={(event) => update("status", event.target.value as BookStatus)}>
            {Object.keys(BOOK_STATUS_CLASSES).map((item) => <option key={item}>{item}</option>)}
          </select>
          <input type="number" min={0} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={form.copies} onChange={(event) => update("copies", Number(event.target.value))} />
          <input type="number" min={0} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={form.availableCopies} onChange={(event) => update("availableCopies", Number(event.target.value))} placeholder="Available copies" />
          <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Cover image URL" value={form.coverImageUrl} onChange={(event) => update("coverImageUrl", event.target.value)} />
        </div>
        <div
          className="mt-4 grid gap-3 rounded-[1.2rem] border border-dashed border-emerald-200 bg-emerald-50/40 p-4 md:grid-cols-[120px_1fr]"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void handleCoverFile(event.dataTransfer.files[0]);
          }}
        >
          <div className="flex h-32 w-24 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
            {form.coverImageUrl ? <img src={form.coverImageUrl} alt="Cover preview" className="h-full w-full object-cover" /> : <span className="text-xs text-slate-400">Preview</span>}
          </div>
          <label className="flex cursor-pointer flex-col justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            <strong className="text-slate-900">Upload cover photo</strong>
            <span className="mt-1">Drop an image here or browse. Falls back to URL when storage is unavailable.</span>
            <input type="file" accept="image/*" className="mt-3 text-xs" onChange={(event) => { void handleCoverFile(event.target.files?.[0]); }} />
            {uploadMessage ? <span className="mt-2 text-xs text-emerald-700">{uploadMessage}</span> : null}
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600" onClick={onCancel}>Cancel</button>
          <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Save Book</button>
        </div>
      </form>
    </div>
  );
}

function DeleteBookModal({ book, onCancel, onConfirm }: { book: CatalogBook; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-4">
      <section className="w-full max-w-lg rounded-[1.4rem] border border-rose-100 bg-white p-5 shadow-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-700">Delete Book</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Are you sure you want to delete this book?</h2>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p><strong className="text-slate-900">Title:</strong> {book.title}</p>
          <p className="mt-1"><strong className="text-slate-900">Author:</strong> {book.author}</p>
          <p className="mt-1"><strong className="text-slate-900">ISBN:</strong> {book.isbn}</p>
          <p className="mt-1"><strong className="text-slate-900">Available Copies:</strong> {book.availableCopies}</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600" onClick={onCancel}>Cancel</button>
          <button className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white" onClick={onConfirm}>Delete Book</button>
        </div>
      </section>
    </div>
  );
}

function AdminCirculation() {
  const adminData = useAdminData();
  const [config] = useState(getStoredAdminConfig);
  const [query, setQuery] = useState("");
  const [returnQuery, setReturnQuery] = useState("");
  const [viewTransaction, setViewTransaction] = useState<Transaction | null>(null);
  const filteredQueue = adminData.pickupQueue.filter((item) => `${item.id} ${item.student} ${item.book}`.toLowerCase().includes(query.toLowerCase()));
  const loanRows = adminData.transactions.filter((tx) => tx.type === "Loan" || tx.type === "Return");
  const runManualReturn = () => {
    const needle = returnQuery.trim().toLowerCase();
    const match = loanRows.find((tx) =>
      [tx.id, tx.sourceId, tx.book, tx.patron].some((value) => value.toLowerCase().includes(needle))
      && ["picked_up", "overdue"].includes(tx.status)
    );
    if (match) void adminData.processReturn(match);
  };
  return (
    <>
      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">Pickup Verification</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">Pickup queue</h2>
            {adminData.notice ? <p className="mt-1 text-xs text-rose-600">{adminData.notice}</p> : null}
          </div>
          <input className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm outline-none focus:border-emerald-600" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search transaction, student, book" />
        </div>
        <div className="mt-5 grid gap-3">
          {filteredQueue.map((item) => (
            <article key={item.id} className="rounded-[1.25rem] border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="font-mono text-xs text-slate-400">{item.id}</p>
                  <h3 className="mt-1 text-sm font-semibold text-slate-900">{item.book}</h3>
                  <p className="text-sm text-slate-500">{item.student} | {item.email} | {item.studentId}</p>
                  <p className="mt-1 text-xs text-slate-400">Reserved {item.reservedAt} | Reservation {item.startDate} to {item.endDate}</p>
                  <span className="mt-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    Ready for pickup
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="admin-action-button rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!["reserved", "approved", "ready_for_pickup"].includes(item.status.toLowerCase())}
                    onClick={() => { void adminData.markPickedUp(item, config.loanDurationDays); }}
                  >
                    Picked Up
                  </button>
                  <button className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700" onClick={() => { void adminData.cancelReservation(item, "manual"); }}>Cancel Reservation</button>
                </div>
              </div>
            </article>
          ))}
          {!adminData.isLoading && filteredQueue.length === 0 ? <p className="rounded-[1.25rem] border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No pickup records are in the database right now.</p> : null}
        </div>
      </Panel>
      <Panel>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">Manual Returns</p>
        <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">Reserved to borrowed to available</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <input className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm outline-none focus:border-emerald-600" placeholder="Enter transaction ID, barcode, student, or book title" value={returnQuery} onChange={(event) => setReturnQuery(event.target.value)} />
          <button className="cursor-pointer rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={!returnQuery.trim()} onClick={runManualReturn}>Process Return</button>
        </div>
        <AdminTransactionTable rows={loanRows} onProcessReturn={(tx) => { void adminData.processReturn(tx); }} onView={setViewTransaction} />
      </Panel>
      {viewTransaction ? <TransactionDetailModal transaction={viewTransaction} onClose={() => setViewTransaction(null)} /> : null}
    </>
  );
}

function TransactionDetailModal({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-4">
      <section className="w-full max-w-lg rounded-[1.4rem] bg-white p-5 shadow-2xl">
        <h2 className="text-xl font-semibold text-slate-900">Transaction Details</h2>
        <div className="mt-4 space-y-2 text-sm text-slate-600">
          <p><strong>ID:</strong> {transaction.id}</p>
          <p><strong>Book:</strong> {transaction.book}</p>
          <p><strong>Patron:</strong> {transaction.patron}</p>
          <p><strong>Status:</strong> {STATUS_CONFIG[transaction.status].label}</p>
          <p><strong>Date:</strong> {transaction.date}</p>
          {transaction.dueAt ? <p><strong>Due:</strong> {formatDate(transaction.dueAt)}</p> : null}
        </div>
        <div className="mt-5 flex justify-end"><button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white" onClick={onClose}>Close</button></div>
      </section>
    </div>
  );
}

function AdminOverdue() {
  const adminData = useAdminData();
  return (
    <Panel>
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-700">Overdue Monitoring</p>
      <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">Overdue loans and fine actions</h2>
      {adminData.notice ? <p className="mt-1 text-xs text-rose-600">{adminData.notice}</p> : null}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead><tr className="border-b border-slate-100 bg-slate-50/60">{["Loan ID", "Borrower", "Book", "Due Date", "Days", "Fine", "Status", "Actions"].map((h) => <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{h}</th>)}</tr></thead>
          <tbody>{adminData.overdueLoans.map((loan) => <tr key={loan.id} className="border-b border-slate-100"><td className="px-4 py-3.5 font-mono text-xs text-slate-400">{loan.id}</td><td className="px-4 py-3.5 text-sm text-slate-700">{loan.borrower}</td><td className="px-4 py-3.5 text-sm font-semibold text-slate-800">{loan.book}</td><td className="px-4 py-3.5 text-sm text-slate-500">{loan.due}</td><td className="px-4 py-3.5 text-sm font-semibold text-rose-700">{loan.days}</td><td className="px-4 py-3.5 text-sm text-slate-700">{loan.fine}</td><td className="px-4 py-3.5"><Badge classes={loan.status === "Unpaid" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-500"}>{loan.status}</Badge></td><td className="px-4 py-3.5"><div className="flex gap-1.5"><button className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">Notify</button><button className="rounded-lg bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white">Paid</button><button className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600">Waive</button></div></td></tr>)}</tbody>
        </table>
        {!adminData.isLoading && adminData.overdueLoans.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-400">No overdue loans are currently recorded in the database.</p> : null}
      </div>
    </Panel>
  );
}

function AdminUsers() {
  const adminData = useAdminData();
  const [historyUser, setHistoryUser] = useState<AdminUser | null>(null);
  const [restrictUser, setRestrictUser] = useState<AdminUser | null>(null);
  const [history, setHistory] = useState<UserHistoryEntry[]>([]);

  const openHistory = async (user: AdminUser) => {
    setHistoryUser(user);
    const [loanResult, reservationResult, activityResult] = await Promise.all([
      supabase
        .from("loans")
        .select("id,status,checked_out_at,returned_at,book_copies(books(title))")
        .eq("user_id", user.id)
        .order("checked_out_at", { ascending: false })
        .limit(30),
      supabase
        .from("reservations")
        .select("id,status,requested_at,cancelled_at,books(title)")
        .eq("user_id", user.id)
        .order("requested_at", { ascending: false })
        .limit(30),
      supabase
        .from("user_activity_logs")
        .select("id,action,created_at,resource_type")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    const loanEntries = ((loanResult.data ?? []) as Record<string, unknown>[]).map((loan) => ({
      id: `loan-${loan.id}`,
      date: formatDate(String(loan.returned_at ?? loan.checked_out_at ?? "")),
      title: loan.returned_at ? "Returned book" : "Borrowed book",
      detail: `${getCopyBookTitle(loan.book_copies)} (${loan.status})`,
    }));
    const reservationEntries = ((reservationResult.data ?? []) as Record<string, unknown>[]).map((reservation) => ({
      id: `reservation-${reservation.id}`,
      date: formatDate(String(reservation.cancelled_at ?? reservation.requested_at ?? "")),
      title: String(reservation.status) === "cancelled" ? "Cancelled reservation" : "Reservation activity",
      detail: `${getBookTitle(reservation.books)} (${reservation.status})`,
    }));
    const logEntries = ((activityResult.data ?? []) as Record<string, unknown>[]).map((log) => ({
      id: `log-${log.id}`,
      date: formatDate(String(log.created_at ?? "")),
      title: "Activity log",
      detail: `${log.action ?? "activity"} ${log.resource_type ? `on ${log.resource_type}` : ""}`,
    }));
    setHistory([...loanEntries, ...reservationEntries, ...logEntries]);
  };

  const applyRestriction = async (user: AdminUser, reason: string, duration: string) => {
    const until = duration === "manual"
      ? null
      : new Date(Date.now() + Number(duration) * 86400000).toISOString();
    await supabase
      .from("user_profiles")
      .update({
        account_status: "suspended",
        metadata: { restriction_reason: reason, restricted_until: until },
      })
      .eq("id", user.id);
    await supabase.from("notifications").insert({
      user_id: user.id,
      type: "account_restriction",
      title: "Account restricted",
      message: reason || "Your library account has been restricted. Contact the library desk for assistance.",
      action_url: "/help",
    });
    setRestrictUser(null);
    await adminData.refresh();
  };

  const unrestrictUser = async (user: AdminUser) => {
    await supabase
      .from("user_profiles")
      .update({ account_status: "active", metadata: { restriction_reason: null, restricted_until: null } })
      .eq("id", user.id);
    await supabase.from("notifications").insert({
      user_id: user.id,
      type: "account_restriction_removed",
      title: "Account restriction removed",
      message: "Your library account access has been restored.",
      action_url: "/dashboard",
    });
    await adminData.refresh();
  };

  return (
    <>
      <Panel>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">User Records</p>
        <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">Borrowing history, roles, and account status</h2>
        {adminData.notice ? <p className="mt-1 text-xs text-rose-600">{adminData.notice}</p> : null}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60">{["Name", "Email", "Role", "Active Loans", "Penalties", "Status", "Actions"].map((h) => <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{h}</th>)}</tr></thead>
            <tbody>{adminData.users.map((user) => <tr key={user.id} className="border-b border-slate-100"><td className="px-4 py-3.5 text-sm font-semibold text-slate-800">{user.name}</td><td className="px-4 py-3.5 text-sm text-slate-600">{user.email}</td><td className="px-4 py-3.5"><Badge classes={user.role === "librarian" || user.role === "admin" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}>{user.role}</Badge></td><td className="px-4 py-3.5 text-sm text-slate-700">{user.loans}</td><td className="px-4 py-3.5 text-sm text-slate-700">{user.penalties}</td><td className="px-4 py-3.5"><Badge classes={user.status === "Active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : user.status === "Restricted" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700"}>{user.status}</Badge></td><td className="px-4 py-3.5"><div className="flex gap-1.5"><button className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600" onClick={() => { void openHistory(user); }}>History</button>{user.status === "Suspended" ? <button className="rounded-lg bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white" onClick={() => { void unrestrictUser(user); }}>Unrestrict</button> : <button className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700" onClick={() => setRestrictUser(user)}>Restrict</button>}</div></td></tr>)}</tbody>
          </table>
          {!adminData.isLoading && adminData.users.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-400">No user profiles are currently readable from the database.</p> : null}
        </div>
      </Panel>
      <Panel>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700">Penalty History</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">{adminData.overdueLoans.map((loan) => <article key={loan.id} className="rounded-[1.2rem] border border-slate-200 bg-slate-50/70 p-4"><h3 className="text-sm font-semibold text-slate-900">{loan.borrower}</h3><p className="mt-1 text-xs text-slate-500">{loan.book}</p><strong className="mt-3 block text-xl text-rose-700">{loan.fine}</strong></article>)}</div>
      </Panel>
      {historyUser ? <HistoryModal user={historyUser} entries={history} onClose={() => setHistoryUser(null)} /> : null}
      {restrictUser ? <RestrictModal user={restrictUser} onCancel={() => setRestrictUser(null)} onApply={applyRestriction} /> : null}
    </>
  );
}

function HistoryModal({ user, entries, onClose }: { user: AdminUser; entries: UserHistoryEntry[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-4">
      <section className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-[1.4rem] bg-white p-5 shadow-2xl">
        <h2 className="text-xl font-semibold text-slate-900">{user.name} history</h2>
        <div className="mt-4 space-y-3">
          {entries.length > 0 ? entries.map((entry) => <article key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-400">{entry.date}</p><h3 className="text-sm font-semibold text-slate-900">{entry.title}</h3><p className="text-sm text-slate-500">{entry.detail}</p></article>) : <p className="text-sm text-slate-400">No activity found.</p>}
        </div>
        <div className="mt-5 flex justify-end"><button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white" onClick={onClose}>Close</button></div>
      </section>
    </div>
  );
}

function RestrictModal({ user, onCancel, onApply }: { user: AdminUser; onCancel: () => void; onApply: (user: AdminUser, reason: string, duration: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("7");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-4">
      <section className="w-full max-w-lg rounded-[1.4rem] bg-white p-5 shadow-2xl">
        <h2 className="text-xl font-semibold text-slate-900">Restrict {user.name}</h2>
        <textarea className="mt-4 min-h-28 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder="Custom reason message" value={reason} onChange={(event) => setReason(event.target.value)} />
        <select className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm" value={duration} onChange={(event) => setDuration(event.target.value)}>
          <option value="7">7 Days</option>
          <option value="30">1 Month</option>
          <option value="90">3 Months</option>
          <option value="manual">Manual / Indefinite</option>
        </select>
        <div className="mt-5 flex justify-end gap-2"><button className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600" onClick={onCancel}>Cancel</button><button className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => { void onApply(user, reason, duration); }}>Apply Restriction</button></div>
      </section>
    </div>
  );
}

function ActivityLineChart({ rows }: { rows: ChartRow[] }) {
  const visibleRows = rows.length > 0 ? rows : Array.from({ length: 7 }, (_, index) => ({ date: "", label: `Day ${index + 1}`, borrowed: 0, returned: 0, overdue: 0, reservations: 0 }));
  const series = [
    { name: "Borrowed", color: "#0284c7", values: visibleRows.map((row) => row.borrowed) },
    { name: "Returned", color: "#059669", values: visibleRows.map((row) => row.returned) },
    { name: "Overdue", color: "#e11d48", values: visibleRows.map((row) => row.overdue) },
    { name: "Reservations", color: "#d97706", values: visibleRows.map((row) => row.reservations) },
  ];
  const max = Math.max(1, ...series.flatMap((item) => item.values));
  const chartWidth = 520;
  const left = 58;
  const top = 34;
  const height = 230;
  const step = visibleRows.length > 1 ? (chartWidth - left - 24) / (visibleRows.length - 1) : 0;
  const getX = (index: number) => left + index * step;
  const getY = (value: number) => top + height - (value / max) * height;
  const points = (values: number[]) => values.map((value, index) => `${getX(index)},${getY(value)}`).join(" ");
  return (
    <article className="rounded-[1.25rem] border border-slate-200 p-5">
      <h3 className="font-semibold text-slate-900">Daily Traffic Volume</h3>
      <svg viewBox="0 0 520 330" className="mt-4 h-[360px] w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <line key={ratio} x1={left} y1={top + height * ratio} x2="496" y2={top + height * ratio} stroke="#e2e8f0" />)}
        <line x1={left} y1={top + height} x2="496" y2={top + height} stroke="#cbd5e1" />
        <line x1={left} y1={top} x2={left} y2={top + height} stroke="#cbd5e1" />
        <text x="16" y="160" fontSize="12" fill="#475569" transform="rotate(-90 16 160)">Count</text>
        <text x="260" y="322" fontSize="12" fill="#475569">Date range</text>
        {[0, Math.ceil(max / 2), max].map((value) => <text key={value} x="28" y={getY(value) + 4} fontSize="11" fill="#64748b">{value}</text>)}
        {series.map((item) => <polyline key={item.name} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={points(item.values)} className="admin-chart-line" />)}
        {series.map((item) => item.values.map((value, index) => <circle key={`${item.name}-${index}`} cx={getX(index)} cy={getY(value)} r="3.5" fill={item.color} className="admin-chart-dot" />))}
        {visibleRows.map((row, index) => index % Math.ceil(visibleRows.length / 7) === 0 ? <text key={row.label} x={getX(index) - 12} y="292" fontSize="10" fill="#64748b">{row.label}</text> : null)}
      </svg>
      <div className="flex flex-wrap gap-3">{series.map((item) => <span key={item.name} className="text-xs text-slate-500"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: item.color }} />{item.name}</span>)}</div>
    </article>
  );
}

function BorrowedBarChart({ rows }: { rows: Array<{ title: string; count: number }> }) {
  const data = rows.length > 0 ? rows : [{ title: "No loan data", count: 0 }];
  const max = Math.max(1, ...data.map((item) => item.count));
  return (
    <article className="rounded-[1.25rem] border border-slate-200 p-5">
      <h3 className="font-semibold text-slate-900">Most Borrowed Titles</h3>
      <p className="mt-1 text-xs text-slate-500">X-axis: borrow count. Y-axis: book title.</p>
      <div className="mt-5 space-y-5">
        {data.map((item) => (
          <div key={item.title}>
            <div className="flex justify-between gap-4 text-xs text-slate-500"><span className="truncate">{item.title}</span><strong>{item.count}</strong></div>
            <div className="mt-1 h-4 rounded-full bg-slate-100"><div className="admin-bar h-4 rounded-full bg-emerald-600" style={{ width: `${(item.count / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </article>
  );
}

function AdminReports() {
  const adminData = useAdminData();
  const today = useMemo(() => new Date(), []);
  const sevenDaysAgo = useMemo(() => {
    const date = new Date(today);
    date.setDate(today.getDate() - 6);
    return date;
  }, [today]);
  const [startDate, setStartDate] = useState(dateInputValue(sevenDaysAgo));
  const [endDate, setEndDate] = useState(dateInputValue(today));
  const boundedTransactions = useMemo(
    () => adminData.transactions.filter((tx) => withinDateRange(tx.occurredAt, startDate, endDate)),
    [adminData.transactions, endDate, startDate],
  );
  const rangedChartRows = useMemo(
    () => adminData.chartRows.filter((row) => withinDateRange(row.date, startDate, endDate)),
    [adminData.chartRows, endDate, startDate],
  );
  const rangedMostBorrowed = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tx of boundedTransactions) {
      if (tx.type === "Loan") {
        counts.set(tx.book, (counts.get(tx.book) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [boundedTransactions]);
  const rangedSummary = useMemo(() => ({
    reservations: boundedTransactions.filter((tx) => tx.type === "Reservation").length,
    checkouts: boundedTransactions.filter((tx) => tx.type === "Loan").length,
    returns: boundedTransactions.filter((tx) => tx.type === "Return").length,
    overdue: boundedTransactions.filter((tx) => tx.status === "overdue").length,
  }), [boundedTransactions]);
  const setPresetRange = (days: number) => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - (days - 1));
    setStartDate(dateInputValue(start));
    setEndDate(dateInputValue(end));
  };
  return (
    <>
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { label: "Reservations", value: rangedSummary.reservations, classes: "bg-emerald-500" },
          { label: "Checkouts", value: rangedSummary.checkouts, classes: "bg-sky-500" },
          { label: "Returns", value: rangedSummary.returns, classes: "bg-amber-500" },
        ].map((item) => <article key={item.label} className="rounded-[1.35rem] border border-slate-200 bg-white p-5 shadow-[0_4px_16px_rgba(15,23,42,0.06)]"><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{item.label}</p><strong className="mt-2 block text-3xl font-semibold text-slate-900">{item.value}</strong><div className="mt-4 h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${item.classes}`} style={{ width: `${Math.min(100, item.value * 8)}%` }} /></div></article>)}
      </section>
      <Panel>
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div><p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">Reports / Analytics</p><h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">Library activity summary</h2></div>
          <div className="flex flex-wrap items-center gap-2">
            {[7, 15, 30].map((days) => <button key={days} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700" onClick={() => setPresetRange(days)}>{days} days</button>)}
            <label className="text-xs font-semibold text-slate-500">Start <input type="date" className="ml-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-600" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="text-xs font-semibold text-slate-500">End <input type="date" className="ml-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-600" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label>
            <button className="cursor-pointer rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-emerald-800 active:translate-y-0" onClick={() => exportAdminReport(adminData, { startDate, endDate })}>Export Report</button>
          </div>
        </div>
        {adminData.notice ? <p className="mt-2 text-xs text-rose-600">{adminData.notice}</p> : null}
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <ActivityLineChart rows={rangedChartRows} />
          <BorrowedBarChart rows={rangedMostBorrowed} />
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <article className="rounded-[1.25rem] border border-slate-200 p-4"><h3 className="font-semibold text-slate-900">Most Borrowed Books</h3>{rangedMostBorrowed.length > 0 ? rangedMostBorrowed.map((book, index) => <p key={book.title} className="mt-3 flex justify-between text-sm text-slate-600"><span>{index + 1}. {book.title}</span><strong>{book.count}</strong></p>) : <p className="mt-3 text-sm text-slate-400">No loan activity has been recorded in this date range.</p>}</article>
          <article className="rounded-[1.25rem] border border-slate-200 p-4"><h3 className="font-semibold text-slate-900">Inventory Status Breakdown</h3>{[`Available ${adminData.metrics.availableBooks}`, `Reserved ${adminData.metrics.reservedBooks}`, `Borrowed ${adminData.metrics.borrowedBooks}`, `Total ${adminData.metrics.totalBooks}`].map((item) => <p key={item} className="mt-3 text-sm text-slate-600">{item}</p>)}</article>
          <article className="rounded-[1.25rem] border border-slate-200 p-4"><h3 className="font-semibold text-slate-900">Active User Activity</h3><p className="mt-3 text-sm text-slate-600">{adminData.users.length} readable users, {rangedSummary.checkouts} range checkouts, {adminData.metrics.pickupQueueCount} pickup records.</p></article>
          <article className="rounded-[1.25rem] border border-slate-200 p-4"><h3 className="font-semibold text-slate-900">Overdue Trend</h3><p className="mt-3 text-sm text-slate-600">{rangedSummary.overdue} overdue transaction records appear in the selected date window.</p></article>
        </div>
      </Panel>
    </>
  );
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  return (
    <AdminShell
      activeRoute="admin"
      title="Admin Dashboard"
      description="Library operations overview: reservations, loans, catalog health, and patron activity."
      headerActions={<AdminHeaderActions onProcessReturns={() => navigate("/admin-circulation")} onAddBook={() => navigate("/admin-inventory")} />}
    >
      <AdminDashboard />
    </AdminShell>
  );
}

function AdminHeaderActions({ onProcessReturns, onAddBook }: { onProcessReturns: () => void; onAddBook: () => void }) {
  return (
    <div className="discover-inline-actions">
      <button type="button" className="btn btn-soft btn-small" onClick={onProcessReturns}>Process Returns</button>
      <button type="button" className="rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800" onClick={onAddBook}>Add New Book</button>
    </div>
  );
}

export function AdminInventoryPage() {
  return (
    <AdminShell activeRoute="admin-inventory" title="Inventory / Catalog Manager" description="Manage physical book inventory, categories, copy counts, and bibliographic data.">
      <AdminInventory />
    </AdminShell>
  );
}

export function AdminCirculationPage() {
  return (
    <AdminShell activeRoute="admin-circulation" title="Circulation / Load" description="Verify students in person, approve checkouts, and process returns.">
      <AdminCirculation />
    </AdminShell>
  );
}

export function AdminOverduePage() {
  return (
    <AdminShell activeRoute="admin-overdue" title="Overdue & Fines" description="Track overdue books, notify users, and settle penalties.">
      <AdminOverdue />
    </AdminShell>
  );
}

export function AdminUsersPage() {
  return (
    <AdminShell activeRoute="admin-users" title="Users & Penalties" description="Review user records, borrowing history, account status, and penalty logs.">
      <AdminUsers />
    </AdminShell>
  );
}

export function AdminReportsPage() {
  return (
    <AdminShell activeRoute="admin-reports" title="Reports / Analytics" description="Inspect library activity and export operational reports.">
      <AdminReports />
    </AdminShell>
  );
}

export function AdminSettingsPage() {
  const adminData = useAdminData();
  const [config, setConfig] = useState(getStoredAdminConfig);
  const updateConfig = (key: keyof AdminConfig, value: number) => {
    const next = { ...config, [key]: value };
    setConfig(next);
    saveStoredAdminConfig(next);
  };
  const exportReports = () => {
    exportAdminReport(adminData);
  };
  return (
    <AdminShell activeRoute="admin-settings" title="Admin Settings" description="Configure librarian operations, notification preferences, and circulation defaults.">
      <Panel>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">Workspace Controls</p>
        <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">Library admin preferences</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            ["Pickup Window", "pickupWindowHours", "hours before auto-expiration"],
            ["Loan Duration", "loanDurationDays", "days before due date"],
            ["Fine Rate", "fineRatePesos", "pesos per overdue day"],
          ].map(([label, key, hint]) => (
            <article key={label} className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
              <input
                type="number"
                min={1}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-2xl font-semibold tracking-tight text-slate-900"
                value={config[key as keyof AdminConfig]}
                onChange={(event) => updateConfig(key as keyof AdminConfig, Number(event.target.value))}
              />
              <p className="mt-2 text-xs text-slate-500">{hint}</p>
            </article>
          ))}
        </div>
        <button className="mt-5 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white" onClick={exportReports}>Export Reports</button>
      </Panel>
    </AdminShell>
  );
}

export function AdminHelpPage() {
  return (
    <AdminShell activeRoute="admin-help" title="Admin Help" description="Operational guide for librarian and administrator workflows.">
      <Panel>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">Admin Workflow Guide</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {[
            ["Pickup verification", "Open Circulation / Load, confirm the student ID, then approve checkout."],
            ["Catalog updates", "Use Inventory / Catalog Manager to add books, edit categories, adjust status, or archive records."],
            ["Fine handling", "Use Overdue & Fines to notify borrowers, mark fines paid, or waive penalties."],
            ["Reports", "Use Reports / Analytics to review monthly activity and export summaries."],
          ].map(([title, copy]) => (
            <article key={title} className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 p-4">
              <h3 className="font-semibold text-slate-900">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{copy}</p>
            </article>
          ))}
        </div>
      </Panel>
    </AdminShell>
  );
}
