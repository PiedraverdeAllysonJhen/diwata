type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  email_status?: string;
};

type UserProfileRow = {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getNotificationId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  if (typeof body.notification_id === "string") return body.notification_id;
  const record = body.record;
  if (record && typeof record === "object" && typeof (record as Record<string, unknown>).id === "string") {
    return String((record as Record<string, unknown>).id);
  }
  return null;
}

async function supabaseRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${errorText}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function updateNotificationEmailStatus(
  notificationId: string,
  emailStatus: "not_applicable" | "pending" | "sent" | "failed",
  emailError: string | null,
) {
  await supabaseRequest(`notifications?id=eq.${notificationId}`, {
    method: "PATCH",
    body: JSON.stringify({
      email_status: emailStatus,
      email_sent_at: emailStatus === "sent" ? new Date().toISOString() : null,
      email_error: emailError,
    }),
  });
}

async function sendWithResend(to: string, subject: string, message: string) {
  const resendApiKey = getRequiredEnv("RESEND_API_KEY");
  const fromEmail = getRequiredEnv("EMAIL_FROM");
  const appName = Deno.env.get("EMAIL_APP_NAME") ?? "BookItStudent Library";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #123;">
          <h2 style="color: #047857;">${escapeHtml(subject)}</h2>
          <p>${escapeHtml(message)}</p>
          <p style="margin-top: 24px; color: #64748b; font-size: 13px;">
            ${escapeHtml(appName)}
          </p>
        </div>
      `,
      text: message,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend failed: ${response.status} ${errorText}`);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let payload: unknown = {};

  try {
    payload = await request.json().catch(() => ({}));
    const notificationId = getNotificationId(payload);

    if (!notificationId) {
      return new Response(JSON.stringify({ error: "Missing notification id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const notifications = await supabaseRequest<NotificationRow[]>(
      `notifications?id=eq.${notificationId}&select=id,user_id,type,title,message,email_status`,
    );
    const notification = notifications[0];

    if (!notification) {
      return new Response(JSON.stringify({ error: "Notification not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!notification.type.endsWith("_email")) {
      await updateNotificationEmailStatus(notification.id, "not_applicable", null);
      return new Response(JSON.stringify({ ok: true, skipped: "not_email_notification" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (notification.email_status === "sent") {
      return new Response(JSON.stringify({ ok: true, skipped: "already_sent" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await updateNotificationEmailStatus(notification.id, "pending", null);

    const profiles = await supabaseRequest<UserProfileRow[]>(
      `user_profiles?id=eq.${notification.user_id}&select=email,first_name,last_name`,
    );
    const profile = profiles[0];
    const recipientEmail = profile?.email;

    if (!recipientEmail) {
      throw new Error("Student profile has no email address");
    }

    await sendWithResend(recipientEmail, notification.title.replace(/^Email queued:\s*/i, ""), notification.message);
    await updateNotificationEmailStatus(notification.id, "sent", null);

    return new Response(JSON.stringify({ ok: true, sent_to: recipientEmail }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email error";
    const notificationId = getNotificationId(payload);
    if (notificationId) {
      await updateNotificationEmailStatus(notificationId, "failed", message).catch(() => undefined);
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
