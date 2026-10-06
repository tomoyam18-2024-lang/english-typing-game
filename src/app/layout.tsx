import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

const description =
  "英単語の意味を確認しながら、制限時間内のタイピングスコアに挑戦できる英語タイピングゲームです。";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "English Typing",
    template: "%s | English Typing",
  },
  description,
  applicationName: "English Typing",
  openGraph: {
    title: "English Typing",
    description,
    siteName: "English Typing",
    locale: "ja_JP",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "English Typing - Type. Learn. Score.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "English Typing",
    description,
    images: ["/opengraph-image"],
  },
  icons: {
    icon: "/icon",
  },
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
