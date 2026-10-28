import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Proofmark AI", description: "Evidence-backed brand review with human approval." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
