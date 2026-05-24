import { Navigate, Route, Routes } from "react-router-dom";
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
import HelpPage from "./pages/HelpPage";
import ReservationsPage from "./pages/ReservationsPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/books/:bookId" element={<BookDetailsPage />} />
      <Route path="/category" element={<CategoryPage />} />
      <Route path="/reservations" element={<ReservationsPage />} />
      <Route path="/favorites" element={<FavoritesPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/admin" element={<AdminDashboardPage />} />
      <Route path="/admin-inventory" element={<AdminInventoryPage />} />
      <Route path="/admin-circulation" element={<AdminCirculationPage />} />
      <Route path="/admin-overdue" element={<AdminOverduePage />} />
      <Route path="/admin-users" element={<AdminUsersPage />} />
      <Route path="/admin-reports" element={<AdminReportsPage />} />
      <Route path="/admin-settings" element={<AdminSettingsPage />} />
      <Route path="/admin-help" element={<AdminHelpPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
