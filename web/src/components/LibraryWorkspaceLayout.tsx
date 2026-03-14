import { ReactNode } from "react";
import ReservationNotifier from "./ReservationNotifier";
import { ReservationNotification } from "../hooks/useReservationNotifier";

export type WorkspaceRoute =
  | "dashboard"
  | "reservations"
  | "search"
  | "category"
  | "favorites"
  | "settings"
  | "help";

export type WorkspaceMenuKey =
  | "discover"
  | "category"
  | "library"
  | "reservation"
  | "favorite"
  | "setting"
  | "help";

type SidebarStat = {
  label: string;
  value: string;
};

type SidebarAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

type NotifierModel = {
  notifications: ReservationNotification[];
  unreadCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
};

type LibraryWorkspaceLayoutProps = {
  activeRoute: WorkspaceRoute;
  activeMenuKey?: WorkspaceMenuKey;
  title: string;
  description: string;
  releaseCode?: string;
  userEmail: string;
  notifier: NotifierModel;
  sidebarStats: SidebarStat[];
  sidebarAction?: SidebarAction;
  headerActions?: ReactNode;
  statusBar?: ReactNode;
  notice?: ReactNode;
  onNavigate: (route: WorkspaceRoute) => void;
  onSignOut: () => Promise<void> | void;
  children: ReactNode;
};

type MenuItem = {
  key: WorkspaceMenuKey;
  label: string;
  route: WorkspaceRoute;
};

const PRIMARY_MENU: MenuItem[] = [
  { key: "discover", label: "Discover", route: "search" },
  { key: "category", label: "Category", route: "category" },
  { key: "library", label: "My Library", route: "dashboard" },
  { key: "reservation", label: "Reservation", route: "reservations" },
  { key: "favorite", label: "Favorite", route: "favorites" }
];

const SECONDARY_MENU: MenuItem[] = [
  { key: "setting", label: "Setting", route: "settings" },
  { key: "help", label: "Help", route: "help" }
];

const ROUTE_MENU_KEY_MAP: Record<WorkspaceRoute, WorkspaceMenuKey> = {
  dashboard: "library",
  reservations: "reservation",
  search: "discover",
  category: "category",
  favorites: "favorite",
  settings: "setting",
  help: "help"
};

function getUserLabel(email: string): string {
  const local = email.split("@")[0] ?? "student";
  return local.replace(/[-_.]+/g, " ").trim() || "Student";
}

function getInitial(email: string): string {
  const local = email.trim().charAt(0);
  return local ? local.toUpperCase() : "S";
}

export default function LibraryWorkspaceLayout({
  activeRoute,
  activeMenuKey,
  title,
  description,
  releaseCode = "DW.010.003",
  userEmail,
  notifier,
  sidebarStats,
  sidebarAction,
  headerActions,
  statusBar,
  notice,
  onNavigate,
  onSignOut,
  children
}: LibraryWorkspaceLayoutProps) {
  const currentMenu = activeMenuKey ?? ROUTE_MENU_KEY_MAP[activeRoute];

  return (
    <main className="portal-page discover-page discover-exact">
      <div className="discover-app-card">
        <div className="discover-shell">
          <aside className="discover-sidebar" aria-label="Primary navigation">
            <div className="discover-sidebar-brand">
              <img src="/assets/bookitstudent-logo.jpg" alt="BookItStudent logo" />
              <div>
                <h2>BookItStudent</h2>
                <p>Visayas State University</p>
              </div>
            </div>

            <div className="discover-menu-block">
              <p className="discover-menu-title">Menu</p>

              <nav className="discover-menu">
                {PRIMARY_MENU.map((item) => {
                  const active = item.key === currentMenu;

                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`discover-menu-item ${active ? "active" : ""}`.trim()}
                      aria-current={active ? "page" : undefined}
                      onClick={() => onNavigate(item.route)}
                    >
                      <span className="discover-menu-dot" aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="discover-sidebar-divider" />

            <nav className="discover-menu discover-menu-secondary" aria-label="Secondary navigation">
              {SECONDARY_MENU.map((item) => {
                const active = item.key === currentMenu;

                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`discover-menu-item ${active ? "active" : "discover-menu-passive"}`.trim()}
                    aria-current={active ? "page" : undefined}
                    onClick={() => onNavigate(item.route)}
                  >
                    <span className="discover-menu-dot" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                className="discover-menu-item"
                onClick={() => {
                  void onSignOut();
                }}
              >
                <span className="discover-menu-dot" aria-hidden="true" />
                <span>Log out</span>
              </button>
            </nav>

            <div className="discover-sidebar-footer">
              <p>Book Library</p>
              <div className="discover-sidebar-footer-stats">
                {sidebarStats.map((item) => (
                  <div key={item.label} className="discover-sidebar-stat">
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
              {sidebarAction ? (
                <button
                  type="button"
                  className="discover-side-action"
                  disabled={sidebarAction.disabled}
                  onClick={sidebarAction.onClick}
                >
                  {sidebarAction.label}
                </button>
              ) : null}
            </div>
          </aside>

          <section className="discover-main">
            <header className="discover-header">
              <div>
                <p className="eyebrow">{releaseCode}</p>
                <h1>{title}</h1>
                <p>{description}</p>
              </div>

              <div className="discover-header-actions">
                {headerActions}
                <div className="discover-profile" aria-label="Profile and notifications">
                  <div className="discover-profile-alert">
                    <ReservationNotifier
                      notifications={notifier.notifications}
                      unreadCount={notifier.unreadCount}
                      isOpen={notifier.isOpen}
                      onToggle={notifier.onToggle}
                      onClose={notifier.onClose}
                      onMarkRead={notifier.onMarkRead}
                      onMarkAllRead={notifier.onMarkAllRead}
                    />
                  </div>
                  <p className="discover-user-chip" title={userEmail}>
                    <span className="discover-user-avatar" aria-hidden="true">
                      {getInitial(userEmail)}
                    </span>
                    <span className="discover-user-name">{getUserLabel(userEmail)}</span>
                  </p>
                </div>
              </div>
            </header>

            {statusBar ? <section className="discover-meta-row">{statusBar}</section> : null}
            {notice}
            <div className="discover-content-stack">{children}</div>
          </section>
        </div>
      </div>
    </main>
  );
}
