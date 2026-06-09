import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AuthRouteGuard from "./components/AuthRouteGuard";
import AuthPage from "./pages/AuthPage";

const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const BookDetailsPage = lazy(() => import("./pages/BookDetailsPage"));
const CategoryPage = lazy(() => import("./pages/CategoryPage"));
const ReservationsPage = lazy(() => import("./pages/ReservationsPage"));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const HelpPage = lazy(() => import("./pages/HelpPage"));
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboardPage"));
const AdminInventoryPage = lazy(() =>
  import("./pages/AdminDashboardPage").then((module) => ({
    default: module.AdminInventoryPage,
  })),
);
const AdminCirculationPage = lazy(() =>
  import("./pages/AdminDashboardPage").then((module) => ({
    default: module.AdminCirculationPage,
  })),
);
const AdminOverduePage = lazy(() =>
  import("./pages/AdminDashboardPage").then((module) => ({
    default: module.AdminOverduePage,
  })),
);
const AdminUsersPage = lazy(() =>
  import("./pages/AdminDashboardPage").then((module) => ({
    default: module.AdminUsersPage,
  })),
);
const AdminReportsPage = lazy(() =>
  import("./pages/AdminDashboardPage").then((module) => ({
    default: module.AdminReportsPage,
  })),
);
const AdminSettingsPage = lazy(() =>
  import("./pages/AdminDashboardPage").then((module) => ({
    default: module.AdminSettingsPage,
  })),
);
const AdminHelpPage = lazy(() =>
  import("./pages/AdminDashboardPage").then((module) => ({
    default: module.AdminHelpPage,
  })),
);

function RouteFallback() {
  return (
    <main className="portal-page route-loading-page">
      <section className="portal-shell portal-single">
        <article className="portal-panel route-loading-card" aria-busy="true">
          <span className="route-loading-mark" aria-hidden="true" />
          <h1>Loading workspace...</h1>
        </article>
      </section>
    </main>
  );
}

function guardedRoute(
  mode: "guest" | "auth" | "student" | "admin",
  page: ReactNode,
) {
  return (
    <AuthRouteGuard mode={mode}>
      <Suspense fallback={<RouteFallback />}>{page}</Suspense>
    </AuthRouteGuard>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthRouteGuard mode="guest"><AuthPage /></AuthRouteGuard>} />
      <Route path="/forgot-password" element={guardedRoute("guest", <ForgotPasswordPage />)} />
      <Route path="/reset-password" element={guardedRoute("auth", <ResetPasswordPage />)} />
      <Route path="/dashboard" element={guardedRoute("student", <DashboardPage />)} />
      <Route path="/search" element={guardedRoute("student", <SearchPage />)} />
      <Route path="/books/:bookId" element={guardedRoute("student", <BookDetailsPage />)} />
      <Route path="/category" element={guardedRoute("student", <CategoryPage />)} />
      <Route path="/reservations" element={guardedRoute("student", <ReservationsPage />)} />
      <Route path="/favorites" element={guardedRoute("student", <FavoritesPage />)} />
      <Route path="/settings" element={guardedRoute("student", <SettingsPage />)} />
      <Route path="/help" element={guardedRoute("student", <HelpPage />)} />
      <Route path="/admin" element={guardedRoute("admin", <AdminDashboardPage />)} />
      <Route path="/admin-inventory" element={guardedRoute("admin", <AdminInventoryPage />)} />
      <Route path="/admin-circulation" element={guardedRoute("admin", <AdminCirculationPage />)} />
      <Route path="/admin-overdue" element={guardedRoute("admin", <AdminOverduePage />)} />
      <Route path="/admin-users" element={guardedRoute("admin", <AdminUsersPage />)} />
      <Route path="/admin-reports" element={guardedRoute("admin", <AdminReportsPage />)} />
      <Route path="/admin-settings" element={guardedRoute("admin", <AdminSettingsPage />)} />
      <Route path="/admin-help" element={guardedRoute("admin", <AdminHelpPage />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
