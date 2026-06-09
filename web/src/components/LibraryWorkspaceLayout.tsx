import { ReactNode, useState } from "react";
import ReservationNotifier from "./ReservationNotifier";
import { ReservationNotification } from "../hooks/useReservationNotifier";

export type WorkspaceRoute =
  | "dashboard"
  | "reservations"
  | "search"
  | "category"
  | "favorites"
  | "settings"
  | "help"
  | "admin"
  | "admin-inventory"
  | "admin-circulation"
  | "admin-overdue"
  | "admin-users"
  | "admin-reports"
  | "admin-settings"
  | "admin-help";

export type WorkspaceMenuKey =
  | "discover"
  | "category"
  | "library"
  | "reservation"
  | "favorite"
  | "setting"
  | "help"
  | "admin-dashboard"
  | "admin-inventory"
  | "admin-circulation"
  | "admin-overdue"
  | "admin-users"
  | "admin-reports"
  | "admin-settings"
  | "admin-help";

export type WorkspaceAudience = "student" | "admin";

type SidebarStat = { label: string; value: string };
type SidebarAction = { label: string; onClick: () => void; disabled?: boolean };

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
  audience?: WorkspaceAudience;
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

type MenuItem = { key: WorkspaceMenuKey; label: string; route: WorkspaceRoute };

const STUDENT_PRIMARY_MENU: MenuItem[] = [
  { key: "discover", label: "Discover", route: "search" },
  { key: "category", label: "Category", route: "category" },
  { key: "library", label: "My Library", route: "dashboard" },
  { key: "reservation", label: "Reservation", route: "reservations" },
  { key: "favorite", label: "Favorite", route: "favorites" },
];

const STUDENT_SECONDARY_MENU: MenuItem[] = [
  { key: "setting", label: "Setting", route: "settings" },
  { key: "help", label: "Help", route: "help" },
];

const ADMIN_PRIMARY_MENU: MenuItem[] = [
  { key: "admin-dashboard", label: "Admin Dashboard", route: "admin" },
  { key: "admin-inventory", label: "Inventory / Catalog Manager", route: "admin-inventory" },
  { key: "admin-circulation", label: "Circulation / Load", route: "admin-circulation" },
  { key: "admin-overdue", label: "Overdue & Fines", route: "admin-overdue" },
  { key: "admin-users", label: "Users & Penalties", route: "admin-users" },
  { key: "admin-reports", label: "Reports / Analytics", route: "admin-reports" },
];

const ADMIN_SECONDARY_MENU: MenuItem[] = [
  { key: "admin-settings", label: "Settings", route: "admin-settings" },
  { key: "admin-help", label: "Help", route: "admin-help" },
];

const ROUTE_MENU_KEY_MAP: Record<WorkspaceRoute, WorkspaceMenuKey> = {
  dashboard: "library",
  reservations: "reservation",
  search: "discover",
  category: "category",
  favorites: "favorite",
  settings: "setting",
  help: "help",
  admin: "admin-dashboard",
  "admin-inventory": "admin-inventory",
  "admin-circulation": "admin-circulation",
  "admin-overdue": "admin-overdue",
  "admin-users": "admin-users",
  "admin-reports": "admin-reports",
  "admin-settings": "admin-settings",
  "admin-help": "admin-help",
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
  audience = "student",
  title,
  description,
  releaseCode,
  userEmail,
  notifier,
  sidebarStats,
  sidebarAction,
  headerActions,
  statusBar,
  notice,
  onNavigate,
  onSignOut,
  children,
}: LibraryWorkspaceLayoutProps) {
  const currentMenu = activeMenuKey ?? ROUTE_MENU_KEY_MAP[activeRoute];
  const primaryMenu = audience === "admin" ? ADMIN_PRIMARY_MENU : STUDENT_PRIMARY_MENU;
  const secondaryMenu = audience === "admin" ? ADMIN_SECONDARY_MENU : STUDENT_SECONDARY_MENU;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navigateAndClose = (route: WorkspaceRoute) => {
    setIsMobileMenuOpen(false);
    onNavigate(route);
  };

  const signOutAndClose = () => {
    setIsMobileMenuOpen(false);
    void onSignOut();
  };

  return (
    <main className="portal-page discover-page discover-exact">
      <div className="discover-app-card">
        <button
          type="button"
          className="workspace-menu-toggle"
          aria-expanded={isMobileMenuOpen}
          aria-controls="workspace-sidebar"
          onClick={() => setIsMobileMenuOpen((value) => !value)}
        >
          <span aria-hidden="true" />
          <span>Menu</span>
        </button>

        {isMobileMenuOpen ? (
          <button
            type="button"
            className="workspace-menu-backdrop"
            aria-label="Close menu"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        ) : null}

        <div className="discover-shell">
          <aside
            id="workspace-sidebar"
            className={`discover-sidebar ${isMobileMenuOpen ? "mobile-open" : ""}`.trim()}
            aria-label="Primary navigation"
          >
            <div className="discover-sidebar-brand">
              <img
                src="/assets/bookitstudent-logo.jpg"
                alt="BookItStudent logo"
              />
              <div>
                <h2>BookItStudent</h2>
                <p>Visayas State University</p>
              </div>
            </div>

            <div className="discover-menu-block">
              <p className="discover-menu-title">Menu</p>
              <nav className="discover-menu">
                {primaryMenu.map((item) => {
                  const active = item.key === currentMenu;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`discover-menu-item ${active ? "active" : ""}`.trim()}
                      aria-current={active ? "page" : undefined}
                      onClick={() => navigateAndClose(item.route)}
                    >
                      <span className="discover-menu-dot" aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="discover-sidebar-divider" />

            <nav
              className="discover-menu discover-menu-secondary"
              aria-label="Secondary navigation"
            >
              {secondaryMenu.map((item) => {
                const active = item.key === currentMenu;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`discover-menu-item ${active ? "active" : "discover-menu-passive"}`.trim()}
                    aria-current={active ? "page" : undefined}
                    onClick={() => navigateAndClose(item.route)}
                  >
                    <span className="discover-menu-dot" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                className="discover-menu-item"
                onClick={signOutAndClose}
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
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    sidebarAction.onClick();
                  }}
                >
                  {sidebarAction.label}
                </button>
              ) : null}
            </div>
          </aside>

          <section className="discover-main">
            <header className="discover-header">
              <div>
                {releaseCode ? <p className="eyebrow">{releaseCode}</p> : null}
                <h1>{title}</h1>
                <p>{description}</p>
              </div>
              <div className="discover-header-actions">
                {headerActions}
                <div
                  className="discover-profile"
                  aria-label="Profile and notifications"
                >
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
                    <span className="discover-user-name">
                      {getUserLabel(userEmail)}
                    </span>
                  </p>
                </div>
              </div>
            </header>

            {notice}
            <div className="discover-content-stack">{children}</div>
          </section>
        </div>
      </div>
    </main>
  );
}
