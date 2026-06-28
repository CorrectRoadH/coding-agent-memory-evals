import type { ReactNode } from "react";

export const metadata = {
  title: "next-app",
  description: "fixture app for coding-agent memory evals",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
