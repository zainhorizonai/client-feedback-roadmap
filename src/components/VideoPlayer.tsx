import { VideoOff } from 'lucide-react'

export function VideoPlayer({ reportId, hasVideo }: { reportId: string; hasVideo: boolean }) {
  if (hasVideo) {
    // Same-origin request: the session cookie authorizes it and the server supports seeking.
    return <video key={reportId} src={`/api/reports/${reportId}/video`} controls preload="metadata" className="aspect-video w-full rounded-lg bg-black" />
  }
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg bg-slate-900 text-slate-400">
      <VideoOff className="h-8 w-8" />
      <p className="text-sm">No video stored for this item</p>
    </div>
  )
}
