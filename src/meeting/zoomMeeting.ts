// src/meeting/zoomMeeting.ts
// Creates a Zoom meeting via Zoom Server-to-Server OAuth (no user login needed).
//
// One-time setup:
//   1. Go to https://marketplace.zoom.us → Develop → Build App → Server-to-Server OAuth
//   2. Add scopes: meeting:write:admin  (or meeting:write if you want user-level)
//   3. Activate the app
//   4. Copy Account ID, Client ID, Client Secret → put in .env as:
//      ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
//   5. Optionally set ZOOM_USER_ID to the host's email/userId (default: "me")

import type { MeetingIntent } from "./meetingParser";
import type { MeetingResult } from "./googleMeet";

async function getZoomAccessToken(): Promise<string> {
  const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;

  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error(
      "Missing Zoom env vars: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET"
    );
  }

  const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString("base64");

  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Zoom token fetch failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

function toZoomDateTime(isoString: string): string {
  // Zoom expects format: "2025-04-01T15:00:00" (no Z, no offset)
  return isoString.replace(/Z$/, "").replace(/\+\d{2}:\d{2}$/, "").slice(0, 19);
}

function addMinutes(isoString: string, minutes: number): string {
  const d = new Date(isoString);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().slice(0, 19);
}

// Zoom timezone identifiers differ slightly from IANA — map the common ones
const TZ_MAP: Record<string, string> = {
  "Asia/Kolkata": "Asia/Calcutta",
  "Asia/Calcutta": "Asia/Calcutta",
};

function toZoomTimezone(tz: string): string {
  return TZ_MAP[tz] ?? tz;
}

export async function createZoomMeeting(intent: MeetingIntent): Promise<MeetingResult> {
  console.log(`📅 Creating Zoom meeting: "${intent.title}" at ${intent.startIso}`);

  const accessToken = await getZoomAccessToken();
  const userId = process.env.ZOOM_USER_ID || "me";

  const meetingBody = {
    topic: intent.title,
    type: 2, // Scheduled meeting
    start_time: toZoomDateTime(intent.startIso),
    duration: intent.durationMinutes,
    timezone: toZoomTimezone(intent.timezone),
    agenda: intent.description || "",
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: false,
      mute_upon_entry: true,
      waiting_room: true,
      auto_recording: "none",
      ...(intent.attendees.length > 0
        ? {
            meeting_invitees: intent.attendees.map((email) => ({ email })),
            send_notification: true,
          }
        : {}),
    },
  };

  const res = await fetch(`https://api.zoom.us/v2/users/${userId}/meetings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(meetingBody),
  });

  const meeting = await res.json();

  if (!res.ok) {
    throw new Error(`Zoom API error: ${meeting.message || JSON.stringify(meeting)}`);
  }

  const meetUrl = meeting.join_url;
  const endIso = addMinutes(intent.startIso, intent.durationMinutes);

  if (!meetUrl) {
    throw new Error("Zoom meeting created but no join URL was returned.");
  }

  console.log(`✅ Zoom meeting created: ${meetUrl}`);

  return {
    platform: "zoom",
    title: intent.title,
    meetUrl,
    startIso: intent.startIso,
    endIso,
    durationMinutes: intent.durationMinutes,
    attendees: intent.attendees,
    meetingId: String(meeting.id),
  };
}