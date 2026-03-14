import { useEffect, useRef } from "react";
import { ReservationNotification } from "../hooks/useReservationNotifier";

type ReservationNotifierProps = {
  notifications: ReservationNotification[];
  unreadCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
};

function formatNotificationTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Just now";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export default function ReservationNotifier({
  notifications,
  unreadCount,
  isOpen,
  onToggle,
  onClose,
  onMarkRead,
  onMarkAllRead
}: ReservationNotifierProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current && !containerRef.current.contains(target)) {
        onClose();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("touchstart", onPointerDown);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <div className="notifier" ref={containerRef}>
      <button
        type="button"
        className="notifier-toggle"
        onClick={onToggle}
        aria-label="Reservation notifications"
        aria-expanded={isOpen}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15 17h5l-1.4-1.4a2 2 0 01-.6-1.4V10a6 6 0 10-12 0v4.2a2 2 0 01-.6 1.4L4 17h5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 17a2 2 0 104 0"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Alerts</span>
        {unreadCount > 0 ? (
          <span className="notifier-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        ) : null}
      </button>

      {isOpen ? (
        <section className="notifier-panel" role="dialog" aria-label="Reservation notifications panel">
          <header className="notifier-header">
            <h3>Reservation Alerts</h3>
            {notifications.length > 0 ? (
              <button type="button" className="notifier-link" onClick={onMarkAllRead}>
                Mark all read
              </button>
            ) : null}
          </header>

          {notifications.length === 0 ? (
            <p className="notifier-empty">No reservation notifications yet.</p>
          ) : (
            <ul className="notifier-list">
              {notifications.slice(0, 12).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`notifier-item ${item.read ? "" : "unread"}`.trim()}
                    onClick={() => onMarkRead(item.id)}
                  >
                    <span className="notifier-item-title">{item.title}</span>
                    <span className="notifier-item-message">{item.message}</span>
                    <span className="notifier-item-time">{formatNotificationTime(item.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
