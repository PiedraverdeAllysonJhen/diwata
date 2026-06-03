import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type AvailabilityDay = {
  start_date: string;
  end_date: string;
  available_copies: number;
  total_copies: number;
  is_available: boolean;
};

type ReservationCalendarModalProps = {
  bookId: string;
  title: string;
  totalCopies: number;
  onClose: () => void;
  onComplete: (bookId: string, status: string, message: string) => void | Promise<void>;
  onError: (message: string) => void;
};

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

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
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

export default function ReservationCalendarModal({
  bookId,
  title,
  totalCopies,
  onClose,
  onComplete,
  onError,
}: ReservationCalendarModalProps) {
  const [availabilityDays, setAvailabilityDays] = useState<AvailabilityDay[]>(
    [],
  );
  const [selectedStartDate, setSelectedStartDate] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadAvailability = useCallback(async () => {
    setIsLoadingAvailability(true);
    const { data, error } = await supabase.rpc(
      "get_book_reservation_availability",
      {
        target_book_id: bookId,
        window_start: toDateInputValue(calendarMonth),
        days_to_check: 62,
      },
    );

    if (error) {
      const mappedError = mapReservationWriteError(error.message);
      setAvailabilityDays([]);
      setIsLoadingAvailability(false);
      setModalError(mappedError);
      onError(mappedError);
      return;
    }

    setAvailabilityDays((data ?? []) as AvailabilityDay[]);
    setIsLoadingAvailability(false);
  }, [bookId, calendarMonth, onError]);

  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);

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
        .map(
          (day) =>
            `${formatDateOnly(day.start_date)} to ${formatDateOnly(day.end_date)}`,
        ),
    [availabilityDays],
  );

  const confirmReservation = async () => {
    if (!selectedStartDate) return;
    setIsSaving(true);
    setModalError("");
    const { data, error } = await supabase.rpc("create_student_reservation", {
      target_book_id: bookId,
      desired_start: selectedStartDate,
      join_queue_when_full: true,
    });

    if (error) {
      const mappedError =
        /already have/i.test(error.message)
          ? "You already have an active reservation for this book."
          : mapReservationWriteError(error.message);
      setIsSaving(false);
      setModalError(mappedError);
      onError(mappedError);
      return;
    }

    const result = Array.isArray(data) ? data[0] : null;
    const status = String(result?.status ?? "reserved");
    if (!result?.reservation_id) {
      const fallbackError =
        "Reservation did not finish. Please run the latest Supabase reservation migration, then try again.";
      setIsSaving(false);
      setModalError(fallbackError);
      onError(fallbackError);
      return;
    }
    if (status === "pending") {
      const legacyError =
        "Your database is still using the old pending reservation flow. Run the latest Supabase reservation migration so reservations are saved as reserved and availability is decremented.";
      setIsSaving(false);
      setModalError(legacyError);
      onError(legacyError);
      return;
    }

    await onComplete(
      bookId,
      status,
      status === "queued"
        ? "No copies are available for that week, so you were added to the waitlist."
        : `Reservation confirmed from ${formatDateOnly(selectedStartDate)} to ${formatDateOnly(result?.end_date ?? selectedAvailability?.end_date)}.`,
    );
    setIsSaving(false);
  };

  return (
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
            <h2 id="reservation-modal-title">{title}</h2>
            <p>
              {totalCopies} total copies. Each reservation lasts 7 days with a
              1-day grace period after the due date.
            </p>
          </div>
          <button type="button" className="btn btn-soft btn-small" onClick={onClose}>
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
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
              <span key={label} className="reservation-calendar-weekday">
                {label}
              </span>
            ))}
            {Array.from({
              length:
                new Date(
                  calendarMonth.getFullYear(),
                  calendarMonth.getMonth() + 1,
                  0,
                ).getDate() + calendarMonth.getDay(),
            }).map((_, index) => {
              const dayNumber = index - calendarMonth.getDay() + 1;
              if (dayNumber < 1) return <span key={`blank-${index}`} />;
              const cellDate = new Date(
                calendarMonth.getFullYear(),
                calendarMonth.getMonth(),
                dayNumber,
              );
              const key = toDateInputValue(cellDate);
              const availability =
                availabilityDays.find((day) => day.start_date === key) ?? null;
              const isPast = cellDate < addDays(new Date(), -1);
              const isAvailable = Boolean(availability?.is_available && !isPast);
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
                    {availability ? `${availability.available_copies} open` : "No data"}
                  </small>
                </button>
              );
            })}
          </div>
        )}

        <div className="reservation-modal-summary">
          {modalError ? <p className="status error">{modalError}</p> : null}
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
          <button type="button" className="btn btn-soft btn-small" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={!selectedStartDate || isSaving}
            onClick={() => {
              void confirmReservation();
            }}
          >
            {isSaving
              ? "Saving..."
              : selectedAvailability && !selectedAvailability.is_available
                ? "Join waitlist"
                : "Confirm reservation"}
          </button>
        </div>
      </section>
    </div>
  );
}
