import { useEffect, useState, useCallback, useRef } from 'react'
import { imageApi, type ImageItem } from '../../api/client'

const STATUS_CONFIG = {
  pending:   { label: '대기',     color: 'bg-gray-500/20 text-gray-400',   dot: 'bg-gray-500' },
  annotated: { label: '완료',     color: 'bg-green-500/20 text-green-400', dot: 'bg-green-500' },
  review:    { label: '검토',     color: 'bg-yellow-500/20 text-yellow-400', dot: 'bg-yellow-500' },
  done:      { label: '승인',     color: 'bg-blue-500/20 text-blue-400',   dot: 'bg-blue-500' },
}

type Status = 'all' | 'pending' | 'annotated' | 'review' | 'done'

interface Props {
  projectId: number
  selectedId: number | null
  onSelect: (img: ImageItem) => void
  onImagesChange?: (items: ImageItem[]) => void
  refreshKey?: number
}

const PAGE_SIZE = 50

export default function ImageList({ projectId, selectedId, onSelect, onImagesChange, refreshKey }: Props) {
  const [images, setImages] = useState<ImageItem[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<Status>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Initial load / filter change — reset list
  const load = useCallback(async () => {
    const params: Record<string, string> = { page: '0', page_size: String(PAGE_SIZE) }
    if (filter !== 'all') params.status = filter
    const res = await imageApi.list(projectId, params)
    setImages(res.items)
    setTotal(res.total)
    setPage(0)
    setHasMore(res.items.length < res.total)
    onImagesChange?.(res.items)
  }, [projectId, filter, refreshKey])

  useEffect(() => { load() }, [load])

  // Load next page and append
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const nextPage = page + 1
      const params: Record<string, string> = { page: String(nextPage), page_size: String(PAGE_SIZE) }
      if (filter !== 'all') params.status = filter
      const res = await imageApi.list(projectId, params)
      setImages((prev) => {
        const merged = [...prev, ...res.items.filter((r) => !prev.some((p) => p.id === r.id))]
        onImagesChange?.(merged)
        return merged
      })
      setPage(nextPage)
      setHasMore((nextPage + 1) * PAGE_SIZE < res.total)
    } finally {
      setLoadingMore(false)
    }
  }, [projectId, filter, page, hasMore, loadingMore])

  // Infinite scroll sentinel
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
        loadMore()
      }
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [loadMore])

  // Auto-scroll selected item into view
  useEffect(() => {
    if (selectedId == null || !scrollRef.current) return
    const el = scrollRef.current.querySelector(`[data-id="${selectedId}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const filtered = search
    ? images.filter((i) => i.filename.toLowerCase().includes(search.toLowerCase()))
    : images

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search */}
      <div className="p-2 border-b border-cvat-border">
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="파일명 검색..."
          className="w-full bg-cvat-surface border border-cvat-border rounded px-2.5 py-1.5 text-xs text-cvat-text placeholder-cvat-muted/50 focus:outline-none focus:border-cvat-gold"
        />
      </div>

      {/* Status filter tabs */}
      <div className="flex border-b border-cvat-border shrink-0 overflow-x-auto">
        {(['all', 'pending', 'annotated', 'review', 'done'] as Status[]).map((s) => (
          <button key={s} onClick={() => { setFilter(s) }}
            className={`px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
              filter === s ? 'border-cvat-gold text-cvat-gold' : 'border-transparent text-cvat-muted hover:text-cvat-text'
            }`}>
            {s === 'all' ? `전체 (${total})` : STATUS_CONFIG[s].label}
          </button>
        ))}
      </div>

      {/* List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-cvat-muted text-xs">이미지 없음</div>
        ) : (
          <>
            {filtered.map((img) => {
              const cfg = STATUS_CONFIG[img.status] ?? STATUS_CONFIG.pending
              const isSelected = img.id === selectedId
              return (
                <div
                  key={img.id}
                  data-id={img.id}
                  onClick={() => onSelect(img)}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors border-l-2 ${
                    isSelected ? 'bg-cvat-gold/10 border-cvat-gold' : 'border-transparent hover:bg-cvat-hover'
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                  <span className="flex-1 text-xs text-cvat-text truncate" title={img.filename}>
                    {img.filename}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${cfg.color}`}>
                    {cfg.label}
                  </span>
                </div>
              )
            })}
            {/* Load more sentinel */}
            {hasMore && (
              <div className="py-3 text-center">
                {loadingMore ? (
                  <span className="text-xs text-cvat-muted">불러오는 중...</span>
                ) : (
                  <button onClick={loadMore} className="text-xs text-cvat-muted hover:text-cvat-text transition-colors">
                    더 보기 ({images.length} / {total})
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
