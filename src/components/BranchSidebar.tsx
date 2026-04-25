'use client'

type Props = {
  sessionId: string
}

export default function BranchSidebar({ sessionId: _sessionId }: Props) {
  return (
    <div className="flex flex-col h-full p-4">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
        Workspaces
      </h2>
      {/* TODO: Person B — workspace list + checkpoint save/restore */}
      <div className="text-sm text-zinc-600">No workspaces yet</div>
    </div>
  )
}
