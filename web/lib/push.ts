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

// Returns true on success. Never throws (so one bad subscription can't abort a poll).
export async function sendPush(sub: PushSub, payload: object): Promise<boolean> {
  try {
    configure();
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (err) {
    console.error("push failed", err);
    return false;
  }
}
