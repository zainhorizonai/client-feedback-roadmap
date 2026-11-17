import type { ReactNode } from 'react'

/** The frame shared by every signed-out screen: a rounded frame holding the dithered picture and a dark glass card. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen p-3 md:p-6">
      <div className="pane relative flex min-h-[calc(100vh-1.5rem)] items-center justify-center overflow-hidden rounded-[2rem] border-2 border-black px-4 py-10 md:min-h-[calc(100vh-3rem)]">
        <div className="w-full max-w-sm">
          <div className="on-dark overflow-hidden rounded-card border border-line bg-[rgba(18,20,21,.82)] shadow-2xl backdrop-blur-xl">
            <div className="px-6 pt-8 text-center">
              <img src="/brand/seam-mark-reverse.svg" alt="SEAM" className="mx-auto h-14 w-14 rounded-2xl bg-black p-2" />
              <p className="mt-3 text-sm text-muted">From client feedback to what ships.</p>
            </div>
            <div className="p-6">{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
