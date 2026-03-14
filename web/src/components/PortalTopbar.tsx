import ReservationNotifier from "./ReservationNotifier";
import { ReservationNotification } from "../hooks/useReservationNotifier";

export type PortalRoute = "dashboard" | "reservations" | "search";

type NotifierViewModel = {
  notifications: ReservationNotification[];
  unreadCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
};

type PortalTopbarProps = {
  activeRoute: PortalRoute;
  userEmail: string;
  notifier: NotifierViewModel;
  onNavigate: (route: PortalRoute) => void;
  onSignOut: () => Promise<void> | void;
};

const NAV_ITEMS: Array<{ route: PortalRoute; label: string }> = [
  { route: "dashboard", label: "Dashboard" },
  { route: "reservations", label: "Reservations" },
  { route: "search", label: "Search" }
];

export default function PortalTopbar({
  activeRoute,
  userEmail,
  notifier,
  onNavigate,
  onSignOut
}: PortalTopbarProps) {
  return (
    <header className="portal-topbar">
      <button type="button" className="portal-brand" onClick={() => onNavigate("dashboard")}>
        <img src="/assets/bookitstudent-logo.jpg" alt="BookItStudent logo" />
        <span>
          <strong>BookItStudent</strong>
          <em>Visayas State University</em>
        </span>
      </button>

      <nav className="portal-nav" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => {
          const isActive = item.route === activeRoute;
          return (
            <button
              key={item.route}
              type="button"
              className={`portal-nav-item ${isActive ? "active" : ""}`.trim()}
              aria-current={isActive ? "page" : undefined}
              onClick={() => onNavigate(item.route)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="portal-user-controls">
        <ReservationNotifier
          notifications={notifier.notifications}
          unreadCount={notifier.unreadCount}
          isOpen={notifier.isOpen}
          onToggle={notifier.onToggle}
          onClose={notifier.onClose}
          onMarkRead={notifier.onMarkRead}
          onMarkAllRead={notifier.onMarkAllRead}
        />
        <p className="portal-user-email" title={userEmail}>
          {userEmail}
        </p>
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={() => {
            void onSignOut();
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
