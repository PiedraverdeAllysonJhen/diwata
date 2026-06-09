import { Navigate, Route, Routes } from "react-router-dom";
import AuthRouteGuard from "./components/AuthRouteGuard";
import AdminDashboardPage, {
  AdminCirculationPage,
  AdminInventoryPage,
  AdminOverduePage,
  AdminReportsPage,
  AdminSettingsPage,
  AdminUsersPage,
  AdminHelpPage,
} from "./pages/AdminDashboardPage";
import AuthPage from "./pages/AuthPage";
import BookDetailsPage from "./pages/BookDetailsPage";
import CategoryPage from "./pages/CategoryPage";
import DashboardPage from "./pages/DashboardPage";
import FavoritesPage from "./pages/FavoritesPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import HelpPage from "./pages/HelpPage";
import ReservationsPage from "./pages/ReservationsPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthRouteGuard mode="guest"><AuthPage /></AuthRouteGuard>} />
      <Route path="/forgot-password" element={<AuthRouteGuard mode="guest"><ForgotPasswordPage /></AuthRouteGuard>} />
      <Route path="/reset-password" element={<AuthRouteGuard mode="auth"><ResetPasswordPage /></AuthRouteGuard>} />
      <Route path="/dashboard" element={<AuthRouteGuard mode="student"><DashboardPage /></AuthRouteGuard>} />
      <Route path="/search" element={<AuthRouteGuard mode="student"><SearchPage /></AuthRouteGuard>} />
      <Route path="/books/:bookId" element={<AuthRouteGuard mode="student"><BookDetailsPage /></AuthRouteGuard>} />
      <Route path="/category" element={<AuthRouteGuard mode="student"><CategoryPage /></AuthRouteGuard>} />
      <Route path="/reservations" element={<AuthRouteGuard mode="student"><ReservationsPage /></AuthRouteGuard>} />
      <Route path="/favorites" element={<AuthRouteGuard mode="student"><FavoritesPage /></AuthRouteGuard>} />
      <Route path="/settings" element={<AuthRouteGuard mode="student"><SettingsPage /></AuthRouteGuard>} />
      <Route path="/help" element={<AuthRouteGuard mode="student"><HelpPage /></AuthRouteGuard>} />
      <Route path="/admin" element={<AuthRouteGuard mode="admin"><AdminDashboardPage /></AuthRouteGuard>} />
      <Route path="/admin-inventory" element={<AuthRouteGuard mode="admin"><AdminInventoryPage /></AuthRouteGuard>} />
      <Route path="/admin-circulation" element={<AuthRouteGuard mode="admin"><AdminCirculationPage /></AuthRouteGuard>} />
      <Route path="/admin-overdue" element={<AuthRouteGuard mode="admin"><AdminOverduePage /></AuthRouteGuard>} />
      <Route path="/admin-users" element={<AuthRouteGuard mode="admin"><AdminUsersPage /></AuthRouteGuard>} />
      <Route path="/admin-reports" element={<AuthRouteGuard mode="admin"><AdminReportsPage /></AuthRouteGuard>} />
      <Route path="/admin-settings" element={<AuthRouteGuard mode="admin"><AdminSettingsPage /></AuthRouteGuard>} />
      <Route path="/admin-help" element={<AuthRouteGuard mode="admin"><AdminHelpPage /></AuthRouteGuard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
