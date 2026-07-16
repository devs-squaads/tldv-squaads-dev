import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, type AuthorizedAccountsDependencies as Dependencies } from "@/auth";

export const dynamic = "force-dynamic";

async function get({ getServerSession, AuthorizedAccountRepository }: Dependencies) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const accounts = await AuthorizedAccountRepository.findAll();
  return NextResponse.json({ accounts });
}

async function post(request: Request, { getServerSession, AuthorizedAccountRepository }: Dependencies) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, role } = (await request.json()) as { email?: string; role?: string };
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const account = await AuthorizedAccountRepository.upsert({
    email: email.trim().toLowerCase(),
    role: role === "admin" ? "admin" : "member",
    isActive: true,
    invitedBy: session.user.email,
  });

  return NextResponse.json({ account });
}

const productionDependencies: Dependencies = { getServerSession, AuthorizedAccountRepository: { findAll: async () => (await import("@meeting-bot/shared/repositories/AuthorizedAccountRepository")).AuthorizedAccountRepository.findAll(), upsert: async (input) => (await import("@meeting-bot/shared/repositories/AuthorizedAccountRepository")).AuthorizedAccountRepository.upsert(input) } };

export const GET = () => get((globalThis as typeof globalThis & { __squaadsAdminRouteDependencies?: { authorizedAccounts?: Dependencies } }).__squaadsAdminRouteDependencies?.authorizedAccounts ?? productionDependencies);
export const POST = (request: Request) => post(request, (globalThis as typeof globalThis & { __squaadsAdminRouteDependencies?: { authorizedAccounts?: Dependencies } }).__squaadsAdminRouteDependencies?.authorizedAccounts ?? productionDependencies);
