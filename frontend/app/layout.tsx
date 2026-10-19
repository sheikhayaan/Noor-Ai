import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import "./globals.css";
import { SmoothScrollProvider } from "@/components/providers/SmoothScrollProvider";
import { CustomCursor } from "@/components/CustomCursor";
import { WebVitalsReporter } from "@/components/perf/WebVitalsReporter";

export const metadata: Metadata = {
  title: "Noor AI | Beyond Intelligence",
  description: "A cinematic, multi-modal AI platform interface with a living 3D intelligence core.",
  applicationName: "Noor AI",
  openGraph: {
    title: "Noor AI | Beyond Intelligence",
    description: "Enter a living AI universe built for research, creation, code, and agents.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#020308",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
        <WebVitalsReporter />
        <SmoothScrollProvider>
          {children}
          <CustomCursor />
        </SmoothScrollProvider>
      </body>
    </html>
  );
}
