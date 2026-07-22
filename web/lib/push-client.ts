// Browser-side Web Push helpers: permission, subscription, follow sync, and
// notification preferences (type mutes, lead-time reminders, per-item mute).

import type { MediaType } from "@/lib/types";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Ask permission, register the service worker, subscribe, and tell the server.
export async function enablePush(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await navigator.serviceWorker.register("/sw.js");
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set");

  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    }));

  await fetch("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub }),
  });
  return true;
}

// Exported so Settings/DetailModal can know whether push is active at all
// (preference controls are meaningless without a subscription to hang them on).
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

// Sync a follow/unfollow to the server. Follows ALWAYS post, subscription or
// not — the server needs the followed_items row to log notification history
// even for push-less devices (see /api/follow). Unfollow without a
// subscription stays a no-op: there's no subscription link to remove, and
// the global followed_items row may still serve other devices.
export async function syncFollow(itemID: string, following: boolean): Promise<void> {
  const sub = await currentSubscription();
  if (!following && !sub) return;
  await fetch(following ? "/api/follow" : "/api/unfollow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemID, subscription: sub }),
  });
}

export interface NotificationPrefs {
  mutedTypes: MediaType[];
  leadTimeDays: number; // 0 = reminders off
  mutedItemIds: string[];
}

// Read (no update fields) or update (with them) this device's notification
// preferences. Returns null when push was never enabled — there's no
// subscription to attach preferences to. POST even for the read: the push
// endpoint is a capability URL and shouldn't appear in query strings/logs.
export async function fetchPrefs(update?: {
  mutedTypes?: MediaType[];
  leadTimeDays?: number;
}): Promise<NotificationPrefs | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const res = await fetch("/api/prefs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub, ...update }),
  });
  return res.ok ? ((await res.json()) as NotificationPrefs) : null;
}

// Mute/unmute pushes for one followed item on THIS device (it stays
// followed and still appears in history). No-op without a subscription.
export async function setItemMuted(itemID: string, muted: boolean): Promise<boolean> {
  const sub = await currentSubscription();
  if (!sub) return false;
  const res = await fetch("/api/mute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemID, subscription: sub, muted }),
  });
  return res.ok;
}
