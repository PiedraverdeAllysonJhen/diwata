# DIWATA

## Project Description
DIWATA is a web-based book reservation platform developed for the VSU Learning Commons.
The system allows students to check book availability, reserve materials online, and
reduce the need for physical inquiries inside the library. It aims to improve resource
accessibility, minimize waiting time, and modernize the current manual reservation process.

## Internal Releases
| Internal Release Code | Date Released |
|-----------------------|---------------|
| DW.010.001 | 2026-02-27 |
| DW.010.002 | 2026-03-05 |
| DW.010.003 | 2026-04-04 |
| DW.010.004 | 2026-06-09 |

---

## Release Notes

## DW.010.004 Release Notes
- Fixed the student reservation lifecycle so confirmed reservations are saved as active reserved records immediately.
- Updated reservation availability handling so book counts decrement on successful reservation and stay consistent across catalog cards, category pages, book details, favorites, and reservation modals.
- Added migration support to reconcile legacy pending reservations, recalculate available copies from active reservations and loans, and prevent duplicate reservations from old pending rows.
- Removed pending from the visible student/admin reservation status experience while keeping legacy pending rows compatible internally.
- Added clearer reservation modal error handling for failed RPC calls or outdated database flows.
- Added a new reservation calendar modal flow and kept reservation actions consistent across Discover, Category, Book Details, and Favorites.
- Added a New Books section in Discover sorted by `books.created_at`.
- Improved the My Library status layout so five status cards display cleanly in one row on wide screens.
- Added bottom-right notification toast popups for new unread alerts with auto-dismiss, click-to-read, and per-toast dismissal behavior.
- Added notification email delivery support through the Supabase Edge Function and notification email migration.
- Removed the green synced / last sync pills from the shared student workspace layout.
- Removed Magic Link authentication from the login experience and kept password-based login, signup, forgot password, and reset password flows.
- Added a dedicated forgot password page using Supabase password reset email redirects.
- Added centralized route guards for guest, authenticated, student, and admin routes.
- Added timeout handling for session, role, and settings checks so auth/settings loading screens do not hang indefinitely.
- Hardened admin access so non-staff users are redirected before admin pages render.
- Reduced duplicate admin Supabase fetching by sharing admin data through the admin workspace.
- Removed database-writing side effects from normal admin data refresh/loading.
- Added a safe student reservation cancellation RPC so cancelled reservations restore availability and promote queued reservations correctly.
- Hardened admin reservation RPCs with staff checks.
- Disabled unfinished overdue fine action buttons until notification, payment, and waiver workflows are fully implemented.
- Kept category browsing in the dedicated Category page and removed duplicate category UI from other student pages.
- Simplified the student dashboard/settings UI by removing interface preference panels, current preference summaries, preference metric cards, repeated header shortcut buttons, and extra intro/explainer cards.
- Improved mobile navigation with a menu drawer, fixed mobile notification panel layout, and refined responsive category/status controls.
- Cleaned unused legacy UI code, production comments, and notification read-state handling.
- Added documentation for BookItStudent email sender setup using `bookitstudent@gmail.com`.
- NOTES: Supabase dashboard SMTP settings and the new database migration must be applied before deployment.

## DW.010.003 Release Notes
- Fixed reservation status mismatches so favorites now reflect active reservations and avoid duplicate reserve actions.
- Streamlined the book details feedback flow by replacing separate stacked review/comment textboxes with a cleaner shared feedback composer.
- Fixed settings persistence so profile updates and user preferences save reliably to Supabase.
- Cleared review form state after successful submission, including both written text and rating reset behavior.
- Polished the Favorites, Book Details, and Settings pages with clearer summary cards, stronger status cues, and improved visual hierarchy.
- NOTES: No known blocking issues reported for this release.

## DW.010.002 Release Notes
- Added project structure for frontend and backend (`web/` and `api/`).
- Implemented Supabase authentication (login, sign up, forgot password, reset password).
- Added session-aware protected dashboard flow and sign-out handling.
- Added initial Supabase database migration with core user/library tables and Row Level Security (RLS) policies.
- Improved authentication UI with responsive layout, branding-based styling, and field-level validation feedback.
- Added Vercel deployment configuration for build and routing.
- NOTES: No known blocking issues reported for this release.

## DW.010.001 Release Notes
- Initialize GitHub repository structure.
- Add initial README and project documentation scaffold.
- NOTES: No known issues reported for this release (update if you have any).

### DW.010.000
- Project codename DIWATA established.
- Initial project concept and scope defined.
- Team formation and role assignment completed.
- Repository planned prior to initial release.

---

## Important Links
- Design Specs: To be added in next release.
- Repository: https://github.com/PiedraverdeAllysonJhen/diwata

## Authentication Email Sender Setup

All BookItStudent authentication emails must be sent from `bookitstudent@gmail.com`.
Do not place Gmail passwords or app passwords in the frontend.

Configure this in Supabase:

1. Open Supabase Dashboard > Authentication > Emails / SMTP.
2. Enable custom SMTP.
3. Set the sender/from email to `bookitstudent@gmail.com`.
4. Use Gmail SMTP credentials or an approved mail provider credential stored only in Supabase secrets/dashboard settings.
5. Confirm verification, password reset, recovery, and invite templates no longer reference a personal email account.
6. Add the deployed app URL and local dev URL to Authentication > URL Configuration so reset links can redirect to `/reset-password`.

For notification emails sent by the Edge Function, set these Supabase function secrets:

- `EMAIL_FROM=BookItStudent <bookitstudent@gmail.com>`
- `EMAIL_APP_NAME=BookItStudent Library`

## Maintainers
DIWATA Development Team  
Bachelor of Science in Computer Science  
Visayas State University
