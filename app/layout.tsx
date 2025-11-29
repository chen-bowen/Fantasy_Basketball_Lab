import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Category Edge - AI-Powered Fantasy Basketball Streaming Assistant',
  description: 'Make optimal streaming decisions with AI-powered recommendations',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

