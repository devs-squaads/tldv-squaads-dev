import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, type AuthorizedAccountEmailDependencies as Dependencies } from "@/auth";

export const dynamic = "force-dynamic";

const SELF_ACTION_ERROR = { error: "No podés modificar tu propio acceso." };
const LAST_ADMIN_ERROR = { error: "Debe quedar al menos un administrador activo." };

async function wouldDropLastAdmin(targetEmail: string, AuthorizedAccountRepository: Dependencies["AuthorizedAccountRepository"]) {
  const accounts = await AuthorizedAccountRepository.findAll();
  const remaining = accounts.filter(
    (a) => a.role === "admin" && a.isActive && a.email !== targetEmail,
  );
  return remaining.length === 0;
}

async function patch(
  request: Request,
  { params }: { params: Promise<{ email: string }> },
  { getServerSession, AuthorizedAccountRepository }: Dependencies,
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail);
  if (email === session.user.email) {
    return NextResponse.json(SELF_ACTION_ERROR, { status: 400 });
  }

  const { isActive, role } = (await request.json()) as {
    isActive?: boolean;
    role?: "admin" | "member";
  };

  const target = await AuthorizedAccountRepository.findByEmail(email);
  const demotesAdmin = target?.role === "admin" && role === "member";
  const deactivatesAdmin = target?.role === "admin" && isActive === false;
  if ((demotesAdmin || deactivatesAdmin) && (await wouldDropLastAdmin(email, AuthorizedAccountRepository))) {
    return NextResponse.json(LAST_ADMIN_ERROR, { status: 400 });
  }

  if (isActive !== undefined) {
    await AuthorizedAccountRepository.setActive(email, isActive);
  }
  if (role !== undefined) {
    await AuthorizedAccountRepository.setRole(email, role);
  }

  return NextResponse.json({ ok: true });
}

async function remove(
  _request: Request,
  { params }: { params: Promise<{ email: string }> },
  { getServerSession, AuthorizedAccountRepository }: Dependencies,
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail);
  if (email === session.user.email) {
    return NextResponse.json(SELF_ACTION_ERROR, { status: 400 });
  }

  const target = await AuthorizedAccountRepository.findByEmail(email);
  if (target?.role === "admin" && target.isActive && (await wouldDropLastAdmin(email, AuthorizedAccountRepository))) {
    return NextResponse.json(LAST_ADMIN_ERROR, { status: 400 });
  }

  await AuthorizedAccountRepository.remove(email);

  return NextResponse.json({ ok: true });
}

const productionDependencies: Dependencies = { getServerSession, AuthorizedAccountRepository: {
  findAll: async () => (await import("@meeting-bot/shared/repositories/AuthorizedAccountRepository")).AuthorizedAccountRepository.findAll(),
  findByEmail: async (email) => (await import("@meeting-bot/shared/repositories/AuthorizedAccountRepository")).AuthorizedAccountRepository.findByEmail(email),
  remove: async (email) => (await import("@meeting-bot/shared/repositories/AuthorizedAccountRepository")).AuthorizedAccountRepository.remove(email),
  setActive: async (email, isActive) => (await import("@meeting-bot/shared/repositories/AuthorizedAccountRepository")).AuthorizedAccountRepository.setActive(email, isActive),
  setRole: async (email, role) => (await import("@meeting-bot/shared/repositories/AuthorizedAccountRepository")).AuthorizedAccountRepository.setRole(email, role),
} };

type Context = { params: Promise<{ email: string }> };
export const PATCH = (request: Request, context: Context) => patch(request, context, (globalThis as typeof globalThis & { __squaadsAdminRouteDependencies?: { authorizedAccountEmail?: Dependencies } }).__squaadsAdminRouteDependencies?.authorizedAccountEmail ?? productionDependencies);
export const DELETE = (request: Request, context: Context) => remove(request, context, (globalThis as typeof globalThis & { __squaadsAdminRouteDependencies?: { authorizedAccountEmail?: Dependencies } }).__squaadsAdminRouteDependencies?.authorizedAccountEmail ?? productionDependencies);
