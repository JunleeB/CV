import { useAnnotationStore } from '../../store/useAnnotationStore'
import type { Label } from '../../api/client'

interface Props {
  labels: Label[]
  imageStatus?: string
  onSave: () => void
  onStatusChange: (s: string) => void
  saving?: boolean
}

const REVIEW_STATUSES = ['pending', 'annotated', 'review', 'done']
const STATUS_LABELS: Record<string, string> = { pending: '대기', annotated: '완료', review: '검토', done: '승인' }

export default function AnnotationPanel({ labels, imageStatus, onSave, onStatusChange, saving }: Props) {
  const { annotations, selectedId, activeLabelId, setSelected, removeAnnotation, setActiveLabel } = useAnnotationStore()

  const labelMap = Object.fromEntries(labels.map((l) => [l.id, l]))

  return (
    <div className="flex flex-col h-full">
      {/* Save & Status */}
      <div className="p-3 border-b border-cvat-border space-y-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="w-full bg-cvat-gold hover:bg-cvat-gold-h disabled:opacity-50 text-black text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {saving ? (
            <><span className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />저장 중...</>
          ) : (
            <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>저장 (Ctrl+S)</>
          )}
        </button>

        <select
          value={imageStatus ?? 'pending'}
          onChange={(e) => onStatusChange(e.target.value)}
          className="w-full bg-cvat-surface border border-cvat-border rounded-lg px-2.5 py-1.5 text-xs text-cvat-text focus:outline-none focus:border-cvat-gold appearance-none cursor-pointer"
        >
          {REVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {/* Label selector */}
      <div className="p-3 border-b border-cvat-border">
        <div className="text-[10px] text-cvat-muted font-medium mb-2 uppercase tracking-wider">레이블</div>
        <div className="space-y-1">
          {labels.map((l) => (
            <button
              key={l.id}
              onClick={() => setActiveLabel(l.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                activeLabelId === l.id ? 'bg-cvat-gold/15 text-cvat-text' : 'hover:bg-cvat-hover text-cvat-muted'
              }`}
            >
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: l.color }} />
              <span className="flex-1 text-left">{l.name}</span>
              <span className="text-cvat-muted/60 text-[10px]">
                {annotations.filter((a) => a.label_id === l.id).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Annotation list */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] text-cvat-muted font-medium uppercase tracking-wider">
            어노테이션 ({annotations.length})
          </div>
        </div>

        {annotations.length === 0 ? (
          <div className="text-center py-6 text-cvat-muted text-xs">어노테이션 없음</div>
        ) : (
          <div className="space-y-1">
            {annotations.map((a, idx) => {
              const label = labelMap[a.label_id]
              return (
                <div
                  key={a._key}
                  onClick={() => setSelected(a._key === selectedId ? null : a._key)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors group ${
                    a._key === selectedId ? 'bg-cvat-gold/15' : 'hover:bg-cvat-hover'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: label?.color ?? '#888' }} />
                  <span className="flex-1 text-xs text-cvat-text truncate">
                    {label?.name ?? `label_${a.label_id}`} #{idx + 1}
                  </span>
                  {a.is_auto && (
                    <span className="text-[9px] bg-cvat-gold/20 text-cvat-gold px-1 rounded">자동</span>
                  )}
                  {a.needs_review && (
                    <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1 rounded">검토</span>
                  )}
                  {a.confidence != null && (
                    <span className="text-[10px] text-cvat-muted">{(a.confidence * 100).toFixed(0)}%</span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeAnnotation(a._key) }}
                    className="opacity-0 group-hover:opacity-100 text-cvat-muted hover:text-red-400 transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Keyboard shortcuts */}
      <div className="p-3 border-t border-cvat-border text-[10px] text-cvat-muted space-y-1">
        <div className="font-medium text-cvat-muted/80 uppercase tracking-wider mb-1.5">단축키</div>
        {[['V', '선택'], ['P', '폴리곤'], ['S', 'SAM2'], ['D / ←', '이전'], ['F / →', '다음'], ['Ctrl+S', '저장/SAM확정'], ['Ctrl+1~9', '레이블 변경'], ['Del', '삭제'], ['Enter', 'SAM 확정'], ['Esc', '취소']].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <kbd className="bg-cvat-surface border border-cvat-border px-1.5 py-0.5 rounded text-[9px] font-mono">{k}</kbd>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
