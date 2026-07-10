import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { AuthorizedAccountRepository } from "@meeting-bot/shared/repositories/AuthorizedAccountRepository";

export const dynamic = "force-dynamic";

export async function GET() {
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

export async function POST(request: Request) {
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
