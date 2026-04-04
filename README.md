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

---

## Release Notes

## DW.010.003 Release Notes
- Fixed reservation status mismatches so favorites now reflect active reservations and avoid duplicate reserve actions.
- Streamlined the book details feedback flow by replacing separate stacked review/comment textboxes with a cleaner shared feedback composer.
- Fixed settings persistence so profile updates and user preferences save reliably to Supabase.
- Cleared review form state after successful submission, including both written text and rating reset behavior.
- Polished the Favorites, Book Details, and Settings pages with clearer summary cards, stronger status cues, and improved visual hierarchy.
- NOTES: No known blocking issues reported for this release.

## DW.010.002 Release Notes
- Added project structure for frontend and backend (`web/` and `api/`).
- Implemented Supabase authentication (login, sign up, magic link, forgot password, reset password).
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

## Maintainers
DIWATA Development Team  
Bachelor of Science in Computer Science  
Visayas State University
