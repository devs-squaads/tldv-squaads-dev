import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { AuthorizedAccountRepository } from "@meeting-bot/shared/repositories/AuthorizedAccountRepository";

export const dynamic = "force-dynamic";

const SELF_ACTION_ERROR = { error: "No podés modificar tu propio acceso." };
const LAST_ADMIN_ERROR = { error: "Debe quedar al menos un administrador activo." };

async function wouldDropLastAdmin(targetEmail: string) {
  const accounts = await AuthorizedAccountRepository.findAll();
  const remaining = accounts.filter(
    (a) => a.role === "admin" && a.isActive && a.email !== targetEmail,
  );
  return remaining.length === 0;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ email: string }> },
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
  if ((demotesAdmin || deactivatesAdmin) && (await wouldDropLastAdmin(email))) {
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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ email: string }> },
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
  if (target?.role === "admin" && target.isActive && (await wouldDropLastAdmin(email))) {
    return NextResponse.json(LAST_ADMIN_ERROR, { status: 400 });
  }

  await AuthorizedAccountRepository.remove(email);

  return NextResponse.json({ ok: true });
}
