import webpush from "web-push";

let configured = false;

function configure() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!publicKey || !privateKey) throw new Error("VAPID keys not set");
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendPushResult {
  ok: boolean;
  // True when the push service itself says this endpoint is gone for good
  // (404/410 — unsubscribed, expired, or the browser rotated it) rather
  // than a transient failure. The caller (see app/api/poll) uses this to
  // prune the dead row instead of leaving it to fail silently forever.
  gone: boolean;
}

// Never throws (so one bad subscription can't abort a poll).
export async function sendPush(sub: PushSub, payload: object): Promise<SendPushResult> {
  try {
    configure();
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return { ok: true, gone: false };
  } catch (err) {
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    console.error("push failed", err);
    return { ok: false, gone: statusCode === 404 || statusCode === 410 };
  }
}
