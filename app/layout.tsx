import type { Metadata } from "next";
import { Boogaloo, Nunito, Quicksand, Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";

const boogaloo = Boogaloo({
  variable: "--font-boogaloo",
  subsets: ["latin"],
  weight: ["400"],
});

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin", "vietnamese"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const quicksand = Quicksand({
  variable: "--font-quicksand",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

const beVietnam = Be_Vietnam_Pro({
  variable: "--font-readable",
  subsets: ["latin", "vietnamese"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "AUTODUCK 🦆 Quack Quack!",
  description: "Duck Racing Club — Ai là con vịt tuần này?",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🦆</text></svg>",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="dark">
      <body
        className={`${boogaloo.variable} ${nunito.variable} ${quicksand.variable} ${beVietnam.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
