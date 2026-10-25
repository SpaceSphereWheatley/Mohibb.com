import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "uplot/dist/uPlot.min.css";
import "./globals.css";

const ui = Inter({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

const tabular = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-tabular",
  display: "swap",
});

const DESCRIPTION =
  "A browser-based post-race engineering dashboard for Formula 1: distance-synchronised telemetry, " +
  "fuel-corrected stint degradation, cumulative race traces, corner decomposition and pit-stop audits. " +
  "Everything runs client-side.";

export const metadata: Metadata = {
  metadataBase: new URL("https://mohibb.com"),
  title: "Atlas · F1 post-race engineering dashboard",
  description: DESCRIPTION,
  alternates: { canonical: "https://mohibb.com/atlas/" },
  openGraph: {
    type: "website",
    url: "https://mohibb.com/atlas/",
    siteName: "mohibb.com",
    title: "Atlas · F1 post-race engineering dashboard",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Atlas · F1 post-race engineering dashboard",
    description: DESCRIPTION,
  },
  icons: { icon: "/favicon.svg" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#090A0F",
  width: "device-width",
  initialScale: 1,
};

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Atlas",
  url: "https://mohibb.com/atlas/",
  applicationCategory: "AnalyticsApplication",
  operatingSystem: "Any modern browser",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  description: DESCRIPTION,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${tabular.variable}`}>
      <body className="bg-surface text-ink antialiased">
        <script
          type="application/ld+json"
          // Static, authored above — not user input.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
        {children}
      </body>
    </html>
  );
}
