import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "English Typing Game",
  description: "A simple English vocabulary typing game.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
