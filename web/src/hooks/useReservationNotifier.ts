import { useEffect, useMemo, useRef, useState } from "react";
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

function statusLabel(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function notificationTitle(status: string, eventType: "INSERT" | "UPDATE"): string {
  if (status === "ready_for_pickup") return "Book ready for pickup";
  if (status === "fulfilled") return "Reservation completed";
  if (status === "cancelled") return "Reservation cancelled";
  if (status === "expired") return "Reservation expired";
  if (status === "pending" && eventType === "INSERT") return "Reservation submitted";
  if (status === "pending") return "Reservation updated";
  return "Reservation status updated";
}

function notificationMessage(
  status: string,
  previousStatus: string | undefined,
  eventType: "INSERT" | "UPDATE"
): string {
  if (eventType === "INSERT") {
    return `Your reservation is now ${statusLabel(status)}.`;
  }

  if (previousStatus && previousStatus !== status) {
    return `Status changed from ${statusLabel(previousStatus)} to ${statusLabel(status)}.`;
  }

  return `Your reservation status is ${statusLabel(status)}.`;
}

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
  const statusByReservationRef = useRef<Map<string, string>>(new Map());

  const unreadCount = useMemo(
    () => notifications.reduce((count, item) => count + (item.read ? 0 : 1), 0),
    [notifications]
  );

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setIsOpen(false);
      statusByReservationRef.current = new Map();
      return;
    }

    const stored = parseStoredNotifications(window.localStorage.getItem(getStorageKey(userId)));
    setNotifications(stored);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    window.localStorage.setItem(
      getStorageKey(userId),
      JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS))
    );
  }, [notifications, userId]);

  useEffect(() => {
    if (!userId || !hasSupabaseEnv) return;

    let isMounted = true;

    const primeCurrentStatuses = async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select("id,status")
        .eq("user_id", userId)
        .limit(500);

      if (!isMounted || error || !data) return;

      const nextMap = new Map<string, string>();

      for (const entry of data as ReservationRow[]) {
        if (entry.id && entry.status) {
          nextMap.set(entry.id, entry.status);
        }
      }

      statusByReservationRef.current = nextMap;
    };

    void primeCurrentStatuses();

    const enqueueNotification = (
      reservationId: string,
      status: string,
      eventType: "INSERT" | "UPDATE",
      previousStatus: string | undefined,
      createdAt?: string | null
    ) => {
      const eventTimestamp = createdAt ?? new Date().toISOString();
      const notificationId = `${reservationId}:${status}:${eventTimestamp}:${eventType}`;

      const nextNotification: ReservationNotification = {
        id: notificationId,
        reservationId,
        status,
        title: notificationTitle(status, eventType),
        message: notificationMessage(status, previousStatus, eventType),
        createdAt: eventTimestamp,
        read: false
      };

      setNotifications((previousItems) => {
        const deduped = previousItems.filter((item) => item.id !== notificationId);
        return [nextNotification, ...deduped].slice(0, MAX_NOTIFICATIONS);
      });
    };

    const handleReservationChange = (
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      const eventType = payload.eventType;
      if (eventType !== "INSERT" && eventType !== "UPDATE") return;

      const nextRow = payload.new as ReservationRow;
      const previousRow = payload.old as ReservationRow;

      if (!nextRow?.id || typeof nextRow.id !== "string") return;
      if (!nextRow.status || typeof nextRow.status !== "string") return;

      const previousStatus =
        statusByReservationRef.current.get(nextRow.id) ??
        (typeof previousRow?.status === "string" ? previousRow.status : undefined);

      const statusChanged = previousStatus !== nextRow.status;

      if (eventType === "INSERT" || statusChanged) {
        enqueueNotification(
          nextRow.id,
          nextRow.status,
          eventType,
          previousStatus,
          nextRow.updated_at ?? nextRow.requested_at
        );
      }

      statusByReservationRef.current.set(nextRow.id, nextRow.status);
    };

    const channel = supabase
      .channel(`reservation-notifier-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `user_id=eq.${userId}`
        },
        handleReservationChange
      )
      .subscribe();

    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, [userId]);

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
  };

  const markAllAsRead = () => {
    setNotifications((previousItems) =>
      previousItems.map((item) => (item.read ? item : { ...item, read: true }))
    );
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
