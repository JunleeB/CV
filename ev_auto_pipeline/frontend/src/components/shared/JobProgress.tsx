import { useEffect, useState, useRef } from 'react'
import { jobApi, type JobStatus } from '../../api/client'

interface Props {
  jobId: string | null
  onDone?: () => void
  onClose?: () => void
}

export default function JobProgress({ jobId, onDone, onClose }: Props) {
  const [status, setStatus] = useState<JobStatus | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!jobId) return
    // Initial fetch
    jobApi.get(jobId).then(setStatus)

    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/jobs/${jobId}`)
    wsRef.current = ws
    ws.onmessage = (e) => {
      const data: JobStatus = JSON.parse(e.data)
      setStatus(data)
      if (data.status === 'done' || data.status === 'error') {
        ws.close()
        if (data.status === 'done') onDone?.()
      }
    }
    return () => { ws.close(); wsRef.current = null }
  }, [jobId])

  if (!jobId || !status) return null

  const pct = status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0
  const isDone = status.status === 'done'
  const isError = status.status === 'error'

  return (
    <div className="bg-cvat-panel border border-cvat-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status.status === 'running' && (
            <span className="w-2 h-2 bg-cvat-gold rounded-full animate-pulse" />
          )}
          {isDone && <span className="w-2 h-2 bg-green-500 rounded-full" />}
          {isError && <span className="w-2 h-2 bg-red-500 rounded-full" />}
          <span className="text-xs font-medium text-cvat-text">
            {status.status === 'running' ? '자동 어노테이션 실행 중' : isDone ? '완료' : isError ? '오류 발생' : '대기 중'}
          </span>
        </div>
        {(isDone || isError) && onClose && (
          <button onClick={onClose} className="text-cvat-muted hover:text-cvat-text transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-1.5 bg-cvat-surface rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${isError ? 'bg-red-500' : isDone ? 'bg-green-500' : 'bg-cvat-gold'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-cvat-muted">
          <span>{status.progress} / {status.total} 이미지</span>
          <span>{pct}%</span>
        </div>
      </div>

      {/* Stats */}
      {(isDone || status.progress > 0) && (
        <div className="flex gap-3 text-[10px]">
          <span className="bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
            자동 완료: {status.auto_count}
          </span>
          <span className="bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
            검토 필요: {status.review_count}
          </span>
        </div>
      )}

      {isError && status.error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-xs text-red-400">
          {status.error}
        </div>
      )}
    </div>
  )
}
