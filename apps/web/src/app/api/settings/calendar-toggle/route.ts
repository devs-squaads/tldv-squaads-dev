import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { CalendarAccountRepository } from "@meeting-bot/shared/repositories/CalendarAccountRepository";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await CalendarAccountRepository.findByEmail(session.user.email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    calendarEnabled: user.calendarEnabled,
    email: user.email,
    hasRefreshToken: !!user.googleRefreshToken,
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await CalendarAccountRepository.findByEmail(session.user.email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { enabled } = await request.json();
  await CalendarAccountRepository.setCalendarEnabled(user.id, !!enabled);

  return NextResponse.json({ calendarEnabled: !!enabled });
}
