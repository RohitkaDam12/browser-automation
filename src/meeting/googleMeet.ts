// src/meeting/googleMeet.ts
// Creates a Google Calendar event with a Meet link.
// Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN in .env
//
// One-time setup to get a refresh token:
//   1. Go to https://console.cloud.google.com → Create OAuth 2.0 credentials (Desktop app)
//   2. Enable Google Calendar API
//   3. Run the OAuth consent flow once to get a refresh token:
//      https://developers.google.com/oauthplayground
//      Scope: https://www.googleapis.com/auth/calendar
//   4. Store the refresh token as GOOGLE_REFRESH_TOKEN in .env

import type { MeetingIntent } from "./meetingParser";

export type MeetingResult = {
  platform: "google_meet" | "zoom";
  title: string;
  meetUrl: string;
  startIso: string;
  endIso: string;
  durationMinutes: number;
  attendees: string[];
  calendarEventUrl?: string;
  meetingId?: string;
};

async function getAccessToken(): Promise<string> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      "Missing Google OAuth env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN"
    );
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Google token refresh failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

function addMinutes(isoString: string, minutes: number): string {
  const d = new Date(isoString);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().replace(/\.\d{3}Z$/, "");
}

export async function createGoogleMeet(intent: MeetingIntent): Promise<MeetingResult> {
  console.log(`📅 Creating Google Meet: "${intent.title}" at ${intent.startIso}`);

  const accessToken = await getAccessToken();

  const endIso = addMinutes(intent.startIso, intent.durationMinutes);

  const eventBody = {
    summary: intent.title,
    description: intent.description || "",
    start: {
      dateTime: intent.startIso,
      timeZone: intent.timezone,
    },
    end: {
      dateTime: endIso,
      timeZone: intent.timezone,
    },
    attendees: intent.attendees.map((email) => ({ email })),
    conferenceData: {
      createRequest: {
        requestId: `agent-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 30 },
        { method: "popup", minutes: 10 },
      ],
    },
    guestsCanModify: false,
    guestsCanInviteOthers: false,
  };

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody),
    }
  );

  const event = await res.json();

  if (!res.ok) {
    throw new Error(`Google Calendar API error: ${JSON.stringify(event)}`);
  }

  const meetUrl =
    event.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ||
    event.hangoutLink ||
    "";

  if (!meetUrl) {
    throw new Error("Google Calendar event created but no Meet link was returned.");
  }

  console.log(`✅ Google Meet created: ${meetUrl}`);

  return {
    platform: "google_meet",
    title: intent.title,
    meetUrl,
    startIso: intent.startIso,
    endIso,
    durationMinutes: intent.durationMinutes,
    attendees: intent.attendees,
    calendarEventUrl: event.htmlLink,
    meetingId: event.id,
  };
}