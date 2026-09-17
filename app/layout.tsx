import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grok Studio",
  description: "本地 Grok 聊天 + 画图工作室",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-200 font-sans">
        {children}
      </body>
    </html>
  );
}
