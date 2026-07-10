import { ExtensionInstallModalHost } from "@/components/ExtensionInstallModalHost";
import { ChatWidget } from "@/components/chat/ChatWidget";

export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {children}
      <ExtensionInstallModalHost />
      <ChatWidget />
    </>
  );
}
