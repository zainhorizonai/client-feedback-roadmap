import type { ReactNode } from 'react'
import { SeamDivider } from './ui'

/** The frame shared by every signed-out screen: wordmark, tagline and a card with the stepped seam on top. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/brand/seam-logo.svg" alt="SEAM" className="mx-auto h-12 w-auto" />
          <p className="mt-3 text-muted">From client feedback to what ships.</p>
        </div>
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
          <SeamDivider />
          <div className="p-6">{children}</div>
        </div>
      </div>
    </div>
  )
}
