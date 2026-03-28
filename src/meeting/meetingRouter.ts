// src/meeting/meetingRouter.ts
import { parseMeetingIntent } from "./meetingParser";
import { createGoogleMeet } from "./googleMeet";
import { createZoomMeeting } from "./zoomMeeting";
import type { MeetingResult } from "./googleMeet";

export type { MeetingResult };

export async function scheduleMeeting(userPrompt: string): Promise<MeetingResult> {
  // Step 1: Parse intent
  console.log(`\n📆 Parsing meeting intent: "${userPrompt}"`);
  const intent = await parseMeetingIntent(userPrompt);

  console.log(`   Platform : ${intent.platform}`);
  console.log(`   Title    : ${intent.title}`);
  console.log(`   Time     : ${intent.startIso} (${intent.timezone})`);
  console.log(`   Duration : ${intent.durationMinutes} min`);
  console.log(`   Attendees: ${intent.attendees.join(", ") || "(none)"}`);

  // Step 2: Create on the right platform
  if (intent.platform === "zoom") {
    return createZoomMeeting(intent);
  }
  return createGoogleMeet(intent);
}