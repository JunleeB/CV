import { useAnnotationStore, type Tool } from '../../store/useAnnotationStore'

const TOOLS: { id: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  {
    id: 'select', key: 'V', label: '선택',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" /></svg>,
  },
  {
    id: 'rect', key: 'R', label: '직사각형',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1.5" strokeWidth={1.5} /></svg>,
  },
  {
    id: 'polygon', key: 'P', label: '폴리곤',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3l8 5v8l-8 5-8-5V8l8-5z" /></svg>,
  },
  {
    id: 'sam_point', key: 'S', label: 'SAM 포인트',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" strokeWidth={1.5} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 2v3m0 14v3M2 12h3m14 0h3" />
    </svg>,
  },
  {
    id: 'sam_box', key: 'B', label: 'SAM 박스',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={1.5} /><path strokeLinecap="round" strokeWidth={1.5} d="M9 12h6M12 9v6" /></svg>,
  },
]

interface Props { samMode?: 'point' | 'box'; onToggleSamMode?: () => void }

export default function ToolBar({ samMode, onToggleSamMode }: Props) {
  const { tool, setTool } = useAnnotationStore()

  return (
    <div className="flex flex-col items-center gap-1 py-3 px-1.5 bg-cvat-panel border-r border-cvat-border w-12 shrink-0">
      {TOOLS.map((t) => (
        <div key={t.id} className="relative group">
          <button
            onClick={() => setTool(t.id)}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
              tool === t.id
                ? 'bg-cvat-gold/20 text-cvat-gold'
                : 'text-cvat-muted hover:bg-cvat-hover hover:text-cvat-text'
            }`}
            title={`${t.label} (${t.key})`}
          >
            {t.icon}
          </button>
          {/* Tooltip */}
          <div className="absolute left-10 top-1/2 -translate-y-1/2 z-50 hidden group-hover:flex items-center gap-2 bg-cvat-surface border border-cvat-border rounded-lg px-2.5 py-1.5 whitespace-nowrap pointer-events-none">
            <span className="text-xs text-cvat-text">{t.label}</span>
            <kbd className="text-[9px] bg-cvat-panel border border-cvat-border rounded px-1 font-mono text-cvat-muted">{t.key}</kbd>
          </div>
        </div>
      ))}

      <div className="w-6 h-px bg-cvat-border my-1" />

      {/* SAM sub-mode when SAM tool active */}
      {(tool === 'sam_point' || tool === 'sam_box') && onToggleSamMode && (
        <button
          onClick={onToggleSamMode}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-cvat-muted hover:text-cvat-text hover:bg-cvat-hover transition-colors"
          title={samMode === 'point' ? '박스 모드로 전환' : '포인트 모드로 전환'}
        >
          {samMode === 'point' ? (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" strokeWidth={2} /></svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" strokeWidth={2} /></svg>
          )}
        </button>
      )}
    </div>
  )
}
