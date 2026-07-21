import { NextRequest, NextResponse } from "next/server";
import { MeetingService } from "@/services/meetingService";
import { UserRepository } from "@meeting-bot/shared/repositories/UserRepository";
import { isKnownMeetingProvider, normalizeMeetingUrl, resolveMeetingProvider } from "@meeting-bot/shared/meetingProvider";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  const secret = process.env.API_ROUTE_SECRET;

  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { duration = 60, botName = "Squaads Assistant" } = body;
    const provider = typeof body.provider === "string" ? body.provider : undefined;

    if (provider && !isKnownMeetingProvider(provider)) {
      return NextResponse.json({ error: "provider must be one of: google-meet, microsoft-teams, zoom" }, { status: 400 });
    }

    // No session exists on this machine-to-machine route — the caller must
    // supply an explicit resolvable identity to satisfy meetings.ownerId's
    // NOT NULL constraint (see spec/features/009-meeting-ownership-sharing/plan.md).
    const ownerEmail = typeof body.ownerEmail === "string" ? body.ownerEmail.trim() : "";
    if (!ownerEmail) {
      return NextResponse.json({ error: "ownerEmail is required" }, { status: 400 });
    }
    const owner = await UserRepository.findByEmail(ownerEmail);
    if (!owner) {
      return NextResponse.json({ error: "ownerEmail does not match a registered user" }, { status: 400 });
    }

    // Support single URL or multiple URLs (comma-separated string or array)
    let urls: string[] = [];
    if (body.meetingUrl) {
      urls = body.meetingUrl.split(/[,\n]+/).map((u: string) => u.trim()).filter(Boolean);
    } else if (Array.isArray(body.meetingUrls)) {
      urls = body.meetingUrls.map((u: string) => u.trim()).filter(Boolean);
    }

    if (urls.length === 0) {
      return NextResponse.json({ error: "meetingUrl or meetingUrls is required" }, { status: 400 });
    }

    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const normalizedUrl = normalizeMeetingUrl(url, provider);
          const resolvedProvider = resolveMeetingProvider(normalizedUrl, provider);
          const { id } = await MeetingService.enqueueMeeting({
            meetingUrl: normalizedUrl,
            botName,
            duration,
            provider,
            ownerId: owner.id,
          });
          return { url: normalizedUrl, provider: resolvedProvider, meetingId: id, queued: true };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          return { url, queued: false, error: message };
        }
      })
    );

    return NextResponse.json({
      message: `${results.filter(r => r.queued).length}/${results.length} meetings queued.`,
      results,
    }, { status: 202 });

  } catch {
    return NextResponse.json({ error: "Failed to parse request" }, { status: 500 });
  }
}
