import { supabase } from "./supabase";

type AppRole = "student" | "librarian" | "admin";

const staffRoles = new Set<AppRole>(["librarian", "admin"]);
const ROLE_CHECK_TIMEOUT_MS = 4500;

function getSessionMetadataRole(role: unknown): AppRole | null {
  return role === "student" || role === "librarian" || role === "admin"
    ? role
    : null;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timeoutId: ReturnType<typeof window.setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

export async function getUserRole(userId: string): Promise<AppRole | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const metadataRole = getSessionMetadataRole(session?.user.app_metadata?.role);
  if (metadataRole) {
    return metadataRole;
  }

  const result = await withTimeout(
    supabase
      .from("user_profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle(),
    ROLE_CHECK_TIMEOUT_MS,
  );

  if (!result || result.error) {
    return null;
  }

  return (result.data?.role as AppRole | undefined) ?? null;
}

export async function getPostLoginPath(userId: string): Promise<string> {
  return (await isStaffUser(userId)) ? "/admin" : "/dashboard";
}

export async function isStaffUser(userId: string): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.user.id !== userId) {
    return false;
  }

  const metadataRole = getSessionMetadataRole(session.user.app_metadata?.role);
  if (metadataRole) {
    return staffRoles.has(metadataRole);
  }

  const result = await withTimeout(
    supabase.rpc("is_staff"),
    ROLE_CHECK_TIMEOUT_MS,
  );

  if (!result || result.error) {
    return false;
  }

  return Boolean(result.data);
}
