import { useCallback, useEffect, useMemo, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { hasSupabaseEnv, supabase } from "../lib/supabase";

const MAX_NOTIFICATIONS = 40;

export type ReservationNotification = {
  id: string;
  reservationId: string;
  status: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
};

type ReservationRow = {
  id: string;
  status: string | null;
  requested_at?: string | null;
  updated_at?: string | null;
};

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
};

function getStorageKey(userId: string): string {
  return `bookitstudent.notifications.${userId}`;
}

function parseStoredNotifications(raw: string | null): ReservationNotification[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((value): value is ReservationNotification => {
        if (typeof value !== "object" || value === null) return false;
        const candidate = value as Partial<ReservationNotification>;

        return (
          typeof candidate.id === "string" &&
          typeof candidate.reservationId === "string" &&
          typeof candidate.status === "string" &&
          typeof candidate.title === "string" &&
          typeof candidate.message === "string" &&
          typeof candidate.createdAt === "string" &&
          typeof candidate.read === "boolean"
        );
      })
      .slice(0, MAX_NOTIFICATIONS);
  } catch {
    return [];
  }
}

export function useReservationNotifier(userId: string | undefined) {
  const [notifications, setNotifications] = useState<ReservationNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const unreadCount = useMemo(
    () => notifications.reduce((count, item) => count + (item.read ? 0 : 1), 0),
    [notifications]
  );

  const normalizeNotificationRow = useCallback(
    (row: NotificationRow): ReservationNotification => {
      const reservationId =
        typeof row.metadata?.reservation_id === "string"
          ? row.metadata.reservation_id
          : row.id;

      return {
        id: row.id,
        reservationId,
        status: row.type,
        title: row.title,
        message: row.message,
        createdAt: row.created_at,
        read: row.is_read
      };
    },
    []
  );

  const loadNotifications = useCallback(async () => {
    if (!userId || !hasSupabaseEnv) return;

    const { data, error } = await supabase
      .from("notifications")
      .select("id,type,title,message,metadata,is_read,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_NOTIFICATIONS);

    if (error || !data) return;
    setNotifications((data as NotificationRow[]).map(normalizeNotificationRow));
  }, [normalizeNotificationRow, userId]);

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setIsOpen(false);
      return;
    }

    const stored = parseStoredNotifications(window.localStorage.getItem(getStorageKey(userId)));
    setNotifications(stored);
    void loadNotifications();
  }, [loadNotifications, userId]);

  useEffect(() => {
    if (!userId) return;

    window.localStorage.setItem(
      getStorageKey(userId),
      JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS))
    );
  }, [notifications, userId]);

  useEffect(() => {
    if (!userId || !hasSupabaseEnv) return;

    const handleNotificationChange = (
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return;
      const row = payload.new as NotificationRow;
      if (!row?.id || !row.title || !row.message) return;

      const nextNotification = normalizeNotificationRow(row);
      setNotifications((previousItems) => {
        const deduped = previousItems.filter((item) => item.id !== nextNotification.id);
        return [nextNotification, ...deduped].slice(0, MAX_NOTIFICATIONS);
      });
    };

    const handleReservationFallbackChange = (
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      const eventType = payload.eventType;
      if (eventType !== "UPDATE") return;

      const nextRow = payload.new as ReservationRow;
      if (!nextRow?.id || typeof nextRow.id !== "string") return;
      if (!nextRow.status || typeof nextRow.status !== "string") return;

      void loadNotifications();
    };

    const channel = supabase
      .channel(`reservation-notifier-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`
        },
        handleNotificationChange
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `user_id=eq.${userId}`
        },
        handleReservationFallbackChange
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadNotifications, normalizeNotificationRow, userId]);

  const toggleOpen = () => {
    setIsOpen((current) => !current);
  };

  const close = () => {
    setIsOpen(false);
  };

  const markAsRead = (id: string) => {
    setNotifications((previousItems) =>
      previousItems.map((item) => (item.id === id ? { ...item, read: true } : item))
    );
    if (hasSupabaseEnv) {
      void supabase
        .from("notifications")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq("id", id);
    }
  };

  const markAllAsRead = () => {
    setNotifications((previousItems) =>
      previousItems.map((item) => (item.read ? item : { ...item, read: true }))
    );
    if (userId && hasSupabaseEnv) {
      void supabase
        .from("notifications")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("is_read", false);
    }
  };

  return {
    notifications,
    unreadCount,
    isOpen,
    toggleOpen,
    close,
    markAsRead,
    markAllAsRead
  };
}
