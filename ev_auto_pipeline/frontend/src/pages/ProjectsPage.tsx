import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { projectApi, imageApi, type Project } from '../api/client'
import { useAuthStore } from '../store/useAuthStore'
import ExportModal from '../components/shared/ExportModal'


const PRESET_COLORS = ['#c8a84b','#22c55e','#3b82f6','#ef4444','#a855f7','#f97316','#06b6d4','#ec4899']

export default function ProjectsPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [exportTarget, setExportTarget] = useState<Project | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try { setProjects(await projectApi.list()) } finally { setLoading(false) }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`"${name}" 프로젝트를 삭제하시겠습니까?`)) return
    await projectApi.delete(id)
    setProjects((p) => p.filter((x) => x.id !== id))
  }

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  const filtered = search
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice(page * pageSize, (page + 1) * pageSize)

  // 검색/페이지사이즈 바뀌면 1페이지로
  useEffect(() => { setPage(0) }, [search, pageSize])

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Navbar */}
      <nav className="h-12 bg-white border-b border-gray-200 flex items-center px-6 gap-6 shrink-0 shadow-sm">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div className="w-7 h-7 bg-cvat-gold rounded flex items-center justify-center text-black font-bold text-xs">EV</div>
          <span className="text-gray-800 font-bold text-sm tracking-wide">EV Annotator</span>
        </button>

        <div className="flex items-center gap-1 text-sm">
          <button className="px-3 py-1.5 rounded text-gray-900 font-semibold">Projects</button>
          <button
            onClick={() => navigate('/training')}
            className="px-3 py-1.5 rounded text-gray-500 hover:text-gray-800 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
            Training
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-gray-500 text-sm">{user?.display_name}</span>
          {user?.role === 'admin' && (
            <>
              <span className="bg-cvat-gold/20 text-cvat-gold border border-cvat-gold/30 text-xs px-2 py-0.5 rounded font-medium">Admin</span>
              <button
                onClick={() => navigate('/admin')}
                className="text-gray-500 hover:text-gray-800 text-sm transition-colors flex items-center gap-1"
                title="사용자 관리"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>
                </svg>
                사용자 관리
              </button>
            </>
          )}
          <button
            onClick={() => { logout(); navigate('/') }}
            className="text-gray-500 hover:text-gray-800 text-sm transition-colors"
          >
            로그아웃
          </button>
        </div>
      </nav>

      {/* Main content — 스크롤 영역 */}
      <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto w-full px-6 py-6">
        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-gray-500">{filtered.length}개 프로젝트</span>
            <button
              onClick={() => setShowCreate(true)}
              className="w-8 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center justify-center transition-colors"
              title="새 프로젝트"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-16 text-gray-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <EmptyState onCreate={() => setShowCreate(true)} hasSearch={!!search} />
        ) : (
          <div className="space-y-2">
            {paginated.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                onOpen={() => navigate(`/projects/${p.id}`)}
                onDelete={() => handleDelete(p.id, p.name)}
                onExport={() => setExportTarget(p)}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-8 pb-6">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
            </button>

            {Array.from({ length: totalPages }, (_, i) => i).map((i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`w-8 h-8 text-sm rounded border transition-colors ${
                  i === page
                    ? 'border-blue-500 text-blue-600 font-semibold bg-white'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'
                }`}
              >
                {i + 1}
              </button>
            ))}

            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
            </button>

            {/* Page size selector */}
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm text-gray-600 bg-white focus:outline-none focus:border-blue-500"
            >
              {[5, 10, 20, 50].map((s) => (
                <option key={s} value={s}>{s} / page</option>
              ))}
            </select>
          </div>
        )}
      </div>
      </div>

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreate={async (body, imageFiles, videoOptions, onProgress) => {
            const created = await projectApi.create(body)
            if (imageFiles && imageFiles.length > 0) {
              await projectApi.uploadImages(created.id, imageFiles, onProgress)
            }
            if (videoOptions) {
              await projectApi.uploadVideo(created.id, videoOptions.file, videoOptions.startTime, videoOptions.endTime, videoOptions.fps, onProgress)
              setShowCreate(false)
              load()
              setTimeout(() => load(), 5000)
              setTimeout(() => load(), 12000)
            } else {
              setShowCreate(false)
              load()
            }
          }}
        />
      )}

      {exportTarget && (
        <ExportModal
          projectId={exportTarget.id}
          projectName={exportTarget.name}
          onClose={() => setExportTarget(null)}
        />
      )}

    </div>
  )
}

/* ── Project Row (CVAT-style) ── */
function ProjectRow({
  project, onOpen, onDelete, onExport
}: {
  project: Project
  onOpen: () => void
  onDelete: () => void
  onExport: () => void
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    imageApi.list(project.id, { page: 0, page_size: 1 }).then((res) => {
      if (res.items.length > 0) setThumbUrl(imageApi.url(res.items[0].id))
    }).catch(() => {})
  }, [project.id])

  const total = project.image_count ?? 0
  const annotated = project.annotated_count ?? 0
  const review = project.review_count ?? 0
  const pct = total > 0 ? Math.round((annotated / total) * 100) : 0

  return (
    <div className="bg-white border border-gray-200 rounded-lg flex items-center gap-4 pr-4 hover:border-blue-300 hover:shadow-sm transition-all group">
      {/* Thumbnail */}
      <div
        className="w-28 h-20 bg-gray-100 rounded-l-lg overflow-hidden shrink-0 cursor-pointer"
        onClick={onOpen}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={project.name}
            className="w-full h-full object-cover"
            onError={() => setThumbUrl(null)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 font-bold text-2xl select-none">
            {project.name.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 py-3 cursor-pointer" onClick={onOpen}>
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-gray-400 text-xs font-mono">#{project.id}</span>
          <span className="text-gray-900 font-semibold text-sm truncate">{project.name}</span>
        </div>
        <div className="text-gray-400 text-xs mb-2 flex items-center gap-2">
          <span>Created {new Date(project.created_at).toLocaleDateString('ko-KR')}</span>
          {project.owner && (
            <span className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-[10px]">
              👤 {project.owner}
            </span>
          )}
          {project.source_path && <span className="text-gray-300">· {project.source_path.split('/').pop()}</span>}
        </div>
        {/* Labels */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {project.labels.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
          <span className="text-xs text-gray-400 ml-1">conf: {project.conf_threshold}</span>
        </div>
      </div>

      {/* Stats & progress */}
      <div className="w-52 shrink-0 cursor-pointer" onClick={onOpen}>
        <div className="text-xs text-gray-500 mb-1.5 flex justify-between">
          <span>
            <span className="font-medium text-blue-600">{annotated} annotating</span>
            <span className="text-gray-400"> · {total} total</span>
          </span>
          <span className="text-gray-400">{pct}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {review > 0 && (
          <div className="text-[10px] text-yellow-600 mt-1">{review}개 검토 필요</div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onOpen}
          className="border border-gray-300 hover:border-blue-500 hover:text-blue-600 text-gray-700 text-sm px-4 py-1.5 rounded transition-colors font-medium"
        >
          Open
        </button>
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o) }}
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-8 z-40 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-36 text-sm">
                <button onClick={() => { setMenuOpen(false); onOpen() }}
                  className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors">
                  열기
                </button>
<button onClick={() => { setMenuOpen(false); onExport() }}
                  className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors">
                  레이블 내보내기
                </button>
                <div className="border-t border-gray-100 my-1" />
                <button onClick={() => { setMenuOpen(false); onDelete() }}
                  className="w-full text-left px-4 py-2 text-red-600 hover:bg-red-50 transition-colors">
                  삭제
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onCreate, hasSearch }: { onCreate: () => void; hasSearch: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 bg-gray-100 border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
      </div>
      {hasSearch ? (
        <p className="text-gray-500 text-sm">검색 결과가 없습니다</p>
      ) : (
        <>
          <p className="text-gray-700 font-medium mb-1">프로젝트가 없습니다</p>
          <p className="text-gray-400 text-sm mb-6">새 프로젝트를 생성하여 어노테이션을 시작하세요</p>
          <button onClick={onCreate} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 rounded transition-colors">
            첫 프로젝트 만들기
          </button>
        </>
      )}
    </div>
  )
}

/* ── Create Modal ── */
interface CreateBody { name: string; labels: { name: string; color: string; class_index: number }[]; source_path?: string; conf_threshold: number }
interface VideoOptions { file: File; startTime: string; endTime: string; fps: number }

function CreateProjectModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (body: CreateBody, imageFiles?: File[], videoOptions?: VideoOptions, onProgress?: (pct: number) => void) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [conf, setConf] = useState(0.7)
  const [labels, setLabels] = useState([
    { name: 'person', color: '#c8a84b', class_index: 0 },
    { name: 'dog', color: '#22c55e', class_index: 1 },
  ])
  const [loading, setLoading] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [tab, setTab] = useState<'path' | 'images' | 'video'>('path')
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)

  // video tab state
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoDragging, setVideoDragging] = useState(false)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [fps, setFps] = useState(2.0)

  const addLabel = () => setLabels((l) => [...l, { name: '', color: PRESET_COLORS[l.length % PRESET_COLORS.length], class_index: l.length }])
  const removeLabel = (i: number) => setLabels((l) => l.filter((_, idx) => idx !== i).map((x, idx) => ({ ...x, class_index: idx })))

  function addFiles(incoming: FileList | null) {
    if (!incoming) return
    const valid = Array.from(incoming).filter((f) => /\.(jpe?g|png)$/i.test(f.name))
    setImageFiles((prev) => {
      const names = new Set(prev.map((f) => f.name))
      return [...prev, ...valid.filter((f) => !names.has(f.name))]
    })
  }

  function handleVideoFile(files: FileList | null) {
    if (!files) return
    const f = Array.from(files).find((f) => /\.(mp4|avi|mov|mkv|webm|ts)$/i.test(f.name))
    if (f) setVideoFile(f)
  }

  async function submit() {
    if (!name.trim()) return
    setLoading(true)
    setUploadPct(null)
    try {
      await onCreate(
        { name: name.trim(), labels, source_path: sourcePath || undefined, conf_threshold: conf },
        tab === 'images' && imageFiles.length > 0 ? imageFiles : undefined,
        tab === 'video' && videoFile ? { file: videoFile, startTime, endTime, fps } : undefined,
        setUploadPct,
      )
    } finally { setLoading(false); setUploadPct(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl w-[520px] max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">새 프로젝트</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">프로젝트 이름 *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: EV_센터_카메라_202505" autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">신뢰도 임계값</label>
            <div className="flex items-center gap-3">
              <input type="range" min={0.1} max={1} step={0.05} value={conf} onChange={(e) => setConf(Number(e.target.value))}
                className="flex-1 accent-blue-600" />
              <span className="text-gray-900 text-sm font-mono w-10">{conf.toFixed(2)}</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 font-medium">레이블</label>
              <button onClick={addLabel} className="text-blue-600 hover:text-blue-700 text-xs transition-colors">+ 추가</button>
            </div>
            <div className="space-y-2">
              {labels.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="color" value={l.color} onChange={(e) => setLabels((prev) => prev.map((x, idx) => idx === i ? { ...x, color: e.target.value } : x))}
                    className="w-8 h-8 rounded cursor-pointer border border-gray-200" />
                  <input value={l.name} onChange={(e) => setLabels((prev) => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                    placeholder={`레이블 ${i}`} className="flex-1 border border-gray-300 rounded px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                  <span className="text-gray-400 text-xs w-6 text-center">{i}</span>
                  {labels.length > 1 && (
                    <button onClick={() => removeLabel(i)} className="text-gray-400 hover:text-red-500 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex gap-3 mb-3 border-b border-gray-200">
              {(['path', 'images', 'video'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`text-xs px-3 py-2 transition-colors border-b-2 -mb-px ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                  {t === 'path' ? 'NAS 경로' : t === 'images' ? '이미지 업로드' : '동영상 업로드'}
                </button>
              ))}
            </div>

            {tab === 'path' && (
              <input value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} placeholder="/nas03/1_EV_LABELING/center"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 font-mono" />
            )}

            {tab === 'images' && (
              <div>
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                  }`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
                >
                  <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" multiple className="hidden"
                    onChange={(e) => addFiles(e.target.files)} />
                  <svg className="w-8 h-8 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <p className="text-gray-600 text-sm font-medium">클릭하거나 파일을 드래그하세요</p>
                  <p className="text-gray-400 text-xs mt-1">JPG, PNG 여러 장 선택 가능</p>
                </div>
                {imageFiles.length > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-gray-500 font-medium">{imageFiles.length}개 파일 선택됨</span>
                      <button onClick={() => setImageFiles([])} className="text-xs text-red-500 hover:text-red-700 transition-colors">전체 삭제</button>
                    </div>
                    <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {imageFiles.map((f, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                          <span className="text-gray-700 truncate flex-1 mr-2">{f.name}</span>
                          <span className="text-gray-400 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                          <button onClick={() => setImageFiles((prev) => prev.filter((_, idx) => idx !== i))}
                            className="ml-2 text-gray-300 hover:text-red-500 transition-colors shrink-0">✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'video' && (
              <div className="space-y-3">
                {/* Video drop zone */}
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    videoDragging ? 'border-blue-500 bg-blue-50' : videoFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                  }`}
                  onClick={() => videoRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setVideoDragging(true) }}
                  onDragLeave={() => setVideoDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setVideoDragging(false); handleVideoFile(e.dataTransfer.files) }}
                >
                  <input ref={videoRef} type="file" accept=".mp4,.avi,.mov,.mkv,.webm,.ts,video/*" className="hidden"
                    onChange={(e) => handleVideoFile(e.target.files)} />
                  {videoFile ? (
                    <>
                      <svg className="w-8 h-8 text-green-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                      </svg>
                      <p className="text-green-700 text-sm font-medium truncate px-4">{videoFile.name}</p>
                      <p className="text-gray-400 text-xs mt-1">{(videoFile.size / 1024 / 1024).toFixed(1)} MB</p>
                    </>
                  ) : (
                    <>
                      <svg className="w-8 h-8 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                      </svg>
                      <p className="text-gray-600 text-sm font-medium">클릭하거나 동영상을 드래그하세요</p>
                      <p className="text-gray-400 text-xs mt-1">MP4, AVI, MOV, MKV, WebM, TS 지원</p>
                    </>
                  )}
                </div>

                {/* Clip options */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1 font-medium">시작 시간 (선택)</label>
                    <input value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="00:00:10"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1 font-medium">종료 시간 (선택)</label>
                    <input value={endTime} onChange={(e) => setEndTime(e.target.value)} placeholder="00:01:30"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 font-mono" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 font-medium">추출 FPS (초당 프레임)</label>
                  <div className="flex items-center gap-3">
                    <input type="range" min={0.5} max={10} step={0.5} value={fps} onChange={(e) => setFps(Number(e.target.value))}
                      className="flex-1 accent-blue-600" />
                    <span className="text-gray-900 text-sm font-mono w-10">{fps.toFixed(1)}</span>
                  </div>
                  <p className="text-gray-400 text-xs mt-1">낮을수록 프레임 수 적음 (권장: 1~2 fps)</p>
                </div>
                <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
                  <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-blue-700">프레임 추출은 백그라운드에서 처리됩니다. 프로젝트 생성 후 수초~수십 초 내에 이미지가 나타납니다.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Upload progress bar */}
        {uploadPct !== null && (
          <div className="px-5 pb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">
                {uploadPct < 100 ? '업로드 중...' : tab === 'video' ? '서버 처리 중...' : '완료'}
              </span>
              <span className="text-xs font-mono text-gray-700">{uploadPct}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-200 ${uploadPct < 100 ? 'bg-blue-500' : 'bg-green-500 animate-pulse'}`}
                style={{ width: `${uploadPct}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200">
          <button onClick={onClose} disabled={loading} className="text-gray-500 hover:text-gray-800 disabled:opacity-40 text-sm px-4 py-2 transition-colors">취소</button>
          <button onClick={submit} disabled={loading || !name.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm px-5 py-2 rounded-lg transition-colors">
            {loading ? (uploadPct !== null && uploadPct < 100 ? `${uploadPct}% 업로드 중...` : '처리 중...') : '프로젝트 생성'}
          </button>
        </div>
      </div>
    </div>
  )
}
