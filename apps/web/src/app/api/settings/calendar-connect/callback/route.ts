import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { CalendarAccountRepository } from '@meeting-bot/shared/repositories/CalendarAccountRepository';
import { CALENDAR_OAUTH_STATE_COOKIE } from '../constants';

export const dynamic = 'force-dynamic';

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const expectedState = readCookie(request, CALENDAR_OAUTH_STATE_COOKIE);

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${origin}/settings?calendar=error`);
  }

  // Must match byte-for-byte the redirect_uri sent in the authorize request
  // (OAuth spec requirement) — same NEXTAUTH_URL-first base as route.ts.
  const baseUrl = process.env.NEXTAUTH_URL || origin;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${baseUrl}/api/settings/calendar-connect/callback`,
    }),
  });

  const data = await tokenResponse.json();
  if (!data.access_token) {
    return NextResponse.redirect(`${origin}/settings?calendar=error`);
  }

  const user = await CalendarAccountRepository.findByEmail(session.user.email);
  if (!user) {
    return NextResponse.redirect(`${origin}/settings?calendar=error`);
  }

  await CalendarAccountRepository.updateTokens(user.id, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in
      ? Math.floor(Date.now() / 1000) + data.expires_in
      : undefined,
  });
  await CalendarAccountRepository.setCalendarEnabled(user.id, true);

  const response = NextResponse.redirect(
    `${origin}/settings?calendar=connected`,
  );
  response.cookies.delete(CALENDAR_OAUTH_STATE_COOKIE);
  return response;
}
