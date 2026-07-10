import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { CALENDAR_OAUTH_STATE_COOKIE } from './constants';

export const dynamic = 'force-dynamic';

const CALENDAR_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
];

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Same base NextAuth already uses for its (Google-registered) login
  // callback — keeps this redirect_uri stable across hosts instead of
  // varying with whatever origin the request happened to arrive on.
  const baseUrl = process.env.NEXTAUTH_URL || new URL(request.url).origin;
  const state = crypto.randomUUID();

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID || '');
  authUrl.searchParams.set(
    'redirect_uri',
    `${baseUrl}/api/settings/calendar-connect/callback`,
  );
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', CALENDAR_SCOPES.join(' '));
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set(CALENDAR_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/settings/calendar-connect',
  });
  return response;
}
