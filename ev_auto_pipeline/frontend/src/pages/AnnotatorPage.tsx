import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { projectApi, imageApi, annotationApi, jobApi, trackApi, modelApi, type Project, type ImageItem, type ModelVersion } from '../api/client'
import { useAuthStore } from '../store/useAuthStore'
import { useAnnotationStore } from '../store/useAnnotationStore'
import AnnotationCanvas from '../components/Canvas/AnnotationCanvas'
import ToolBar from '../components/Canvas/ToolBar'
import ImageList from '../components/Sidebar/ImageList'
import AnnotationPanel from '../components/Panel/AnnotationPanel'
import JobProgress from '../components/shared/JobProgress'
import ExportModal from '../components/shared/ExportModal'

/* ── ROI Polygon Setup Modal ── */
type Pt = { x: number; y: number }

function RoiSetupModal({ project, imageId, onClose, onConfirm }: {
  project: Project
  imageId: number | null
  onClose: () => void
  onConfirm: (roi: number[] | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [points, setPoints] = useState<Pt[]>([])
  const [closed, setClosed] = useState(false)
  const mousePosRef = useRef<Pt | null>(null)
  const pointsRef = useRef<Pt[]>([])
  const closedRef = useRef(false)

  const CANVAS_W = 800
  const CANVAS_H = 520

  function getImageBounds() {
    const img = imgRef.current!
    const scale = Math.min(CANVAS_W / img.width, CANVAS_H / img.height)
    const w = img.width * scale
    const h = img.height * scale
    return { x: (CANVAS_W - w) / 2, y: (CANVAS_H - h) / 2, w, h }
  }

  function toCanvas(p: Pt) {
    const { x, y, w, h } = getImageBounds()
    return { cx: x + p.x * w, cy: y + p.y * h }
  }

  function toNorm(clientX: number, clientY: number): Pt {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    const cx = ((clientX - r.left) / r.width) * CANVAS_W
    const cy = ((clientY - r.top) / r.height) * CANVAS_H
    const { x, y, w, h } = getImageBounds()
    return {
      x: Math.max(0, Math.min(1, (cx - x) / w)),
      y: Math.max(0, Math.min(1, (cy - y) / h)),
    }
  }

  function isNearFirst(p: Pt): boolean {
    if (pointsRef.current.length < 2) return false
    const first = pointsRef.current[0]
    const { w, h } = getImageBounds()
    return Math.hypot((p.x - first.x) * w, (p.y - first.y) * h) < 14
  }

  function redraw() {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    const { x, y, w, h } = getImageBounds()
    ctx.drawImage(img, x, y, w, h)

    const pts = pointsRef.current
    const isClosed = closedRef.current
    const mouse = mousePosRef.current
    if (pts.length === 0) return

    const cpts = pts.map(toCanvas)
    const preview = !isClosed && mouse ? toCanvas(mouse) : null

    // Fill
    if ((isClosed && pts.length >= 3) || (!isClosed && preview && pts.length >= 2)) {
      ctx.beginPath()
      ctx.moveTo(cpts[0].cx, cpts[0].cy)
      cpts.forEach(p => ctx.lineTo(p.cx, p.cy))
      if (preview) ctx.lineTo(preview.cx, preview.cy)
      if (isClosed) ctx.closePath()
      ctx.fillStyle = 'rgba(251,191,36,0.12)'
      ctx.fill()
    }

    // Polygon lines
    ctx.beginPath()
    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = 2
    ctx.setLineDash([])
    ctx.moveTo(cpts[0].cx, cpts[0].cy)
    cpts.forEach(p => ctx.lineTo(p.cx, p.cy))
    if (isClosed) ctx.closePath()
    ctx.stroke()

    // Preview dashed line to mouse
    if (!isClosed && preview && cpts.length > 0) {
      const last = cpts[cpts.length - 1]
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(245,158,11,0.5)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 4])
      ctx.moveTo(last.cx, last.cy)
      ctx.lineTo(preview.cx, preview.cy)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Vertices
    cpts.forEach((p, i) => {
      const isFirst = i === 0
      ctx.beginPath()
      ctx.arc(p.cx, p.cy, isFirst ? 7 : 4, 0, Math.PI * 2)
      ctx.fillStyle = isFirst ? '#f59e0b' : '#fff'
      ctx.fill()
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 2
      ctx.stroke()
    })

    // Snap indicator on first point
    if (!isClosed && pts.length >= 2 && mouse && isNearFirst(mouse)) {
      const fp = cpts[0]
      ctx.beginPath()
      ctx.arc(fp.cx, fp.cy, 13, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(245,158,11,0.6)'
      ctx.lineWidth = 2
      ctx.setLineDash([3, 3])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // Load existing ROI
  useEffect(() => {
    if (project.roi && project.roi.length >= 6) {
      const pts: Pt[] = []
      for (let i = 0; i < project.roi.length; i += 2)
        pts.push({ x: project.roi[i], y: project.roi[i + 1] })
      pointsRef.current = pts
      closedRef.current = true
      setPoints(pts)
      setClosed(true)
    }
  }, [])

  // Load image
  useEffect(() => {
    if (!imageId) return
    const img = new Image()
    img.onload = () => { imgRef.current = img; setImgLoaded(true) }
    img.src = imageApi.thumbUrl(imageId)
  }, [imageId])

  useEffect(() => { if (imgLoaded) redraw() }, [imgLoaded])

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!imgLoaded) return
    if (closedRef.current) {
      // 클릭하면 초기화
      pointsRef.current = []
      closedRef.current = false
      setPoints([])
      setClosed(false)
      redraw()
      return
    }
    const p = toNorm(e.clientX, e.clientY)
    if (pointsRef.current.length >= 2 && isNearFirst(p)) {
      closedRef.current = true
      setClosed(true)
      redraw()
      return
    }
    pointsRef.current = [...pointsRef.current, p]
    setPoints([...pointsRef.current])
    redraw()
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (closedRef.current) return
    mousePosRef.current = toNorm(e.clientX, e.clientY)
    redraw()
  }

  function handleMouseLeave() {
    mousePosRef.current = null
    redraw()
  }

  function undoPoint() {
    if (closedRef.current) {
      closedRef.current = false
      setClosed(false)
      redraw()
      return
    }
    pointsRef.current = pointsRef.current.slice(0, -1)
    setPoints([...pointsRef.current])
    redraw()
  }

  function clearAll() {
    pointsRef.current = []
    closedRef.current = false
    mousePosRef.current = null
    setPoints([])
    setClosed(false)
    redraw()
  }

  function handleConfirm() {
    const roi = closed && points.length >= 3
      ? points.flatMap(p => [p.x, p.y])
      : null
    onConfirm(roi)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75" onClick={onClose}>
      <div className="bg-cvat-surface rounded-xl shadow-2xl border border-cvat-border" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-cvat-border">
          <div>
            <h2 className="font-semibold text-cvat-text text-sm">ROI 설정 후 자동 어노테이션</h2>
            <p className="text-[11px] text-cvat-muted mt-0.5">클릭으로 꼭짓점 추가 · 시작점(노란 원) 클릭 시 완성 · 완성 후 클릭하면 초기화</p>
          </div>
          <button onClick={onClose} className="text-cvat-muted hover:text-cvat-text transition-colors ml-6">✕</button>
        </div>

        <div className="p-4">
          {imgLoaded ? (
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              className={`rounded-lg bg-black block select-none ${closed ? 'cursor-default' : 'cursor-crosshair'}`}
              onClick={handleClick}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            />
          ) : (
            <div className="rounded-lg bg-cvat-bg flex items-center justify-center text-cvat-muted text-sm"
              style={{ width: CANVAS_W, height: CANVAS_H }}>
              이미지 로딩 중...
            </div>
          )}

          <div className="mt-2.5 flex items-center gap-4 text-[11px] text-cvat-muted">
            <span>꼭짓점 {points.length}개</span>
            {closed
              ? <span className="text-green-400">영역 완성 ✓ — 클릭하면 재설정</span>
              : points.length >= 2
                ? <span className="text-cvat-gold">시작점(노란 원)을 클릭하면 완성</span>
                : <span>최소 3개 이상 찍어야 합니다</span>}
            {points.length > 0 && (
              <button onClick={undoPoint} className="ml-auto text-cvat-muted hover:text-cvat-text transition-colors">↩ 되돌리기</button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3.5 border-t border-cvat-border">
          <button onClick={clearAll} disabled={points.length === 0}
            className="text-red-400 hover:text-red-300 text-xs disabled:opacity-30 transition-colors">
            초기화
          </button>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="text-cvat-muted hover:text-cvat-text text-xs px-4 py-2 border border-cvat-border rounded-lg transition-colors">
              취소
            </button>
            <button onClick={() => onConfirm(null)}
              className="text-cvat-muted hover:text-cvat-text text-xs px-4 py-2 border border-cvat-border rounded-lg transition-colors">
              ROI 없이 실행
            </button>
            <button onClick={handleConfirm} disabled={!closed || points.length < 3}
              className="bg-cvat-gold hover:bg-cvat-gold-h disabled:opacity-40 text-black font-semibold text-xs px-5 py-2 rounded-lg transition-colors">
              ROI 설정 후 실행
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AnnotatorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const store = useAnnotationStore()

  const [project, setProject] = useState<Project | null>(null)
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null)
  const [imageList, setImageList] = useState<ImageItem[]>([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobRunning, setJobRunning] = useState(false)
  const [trackJobId, setTrackJobId] = useState<string | null>(null)
  const [trackRunning, setTrackRunning] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [panelOpen, _setPanelOpen] = useState(true)
  const uploadRef = useRef<HTMLInputElement>(null)
  const videoUploadRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [showVideoModal, setShowVideoModal] = useState(false)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoStartTime, setVideoStartTime] = useState('')
  const [videoEndTime, setVideoEndTime] = useState('')
  const [videoFps, setVideoFps] = useState(2)
  const [videoUploading, setVideoUploading] = useState(false)
  const [videoUploadPct, setVideoUploadPct] = useState<number | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [showRoiSetup, setShowRoiSetup] = useState(false)
  const pendingForce = useRef(false)
  const [models, setModels] = useState<ModelVersion[]>([])

  const pid = Number(projectId)

  useEffect(() => {
    if (!pid) return
    projectApi.get(pid).then((p) => {
      setProject(p)
      store.setLabels(p.labels)
      store.setActiveLabel(p.labels[0]?.id ?? null)
    })
    modelApi.list().then(setModels).catch(() => {})
  }, [pid])

  // Load annotations when image changes
  useEffect(() => {
    if (!selectedImage) { store.setAnnotations([]); return }
    annotationApi.get(selectedImage.id).then((items) => store.setAnnotations(items))
  }, [selectedImage?.id])

  // 인접 이미지 프리로드 — 앞 3장 + 뒤 15장
  useEffect(() => {
    if (!selectedImage || imageList.length === 0) return
    const idx = imageList.findIndex((i) => i.id === selectedImage.id)
    if (idx === -1) return
    const deltas = Array.from({ length: 19 }, (_, i) => i - 3).filter((d) => d !== 0)
    deltas.forEach((delta) => {
      const adj = imageList[idx + delta]
      if (adj) {
        const img = new window.Image()
        img.src = imageApi.thumbUrl(adj.id)
      }
    })
  }, [selectedImage?.id, imageList])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl+S: SAM 활성 + 미리보기 있으면 확정 후 select 툴로 전환, 아니면 저장
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        const { tool, pendingPolygon, acceptPending, setTool } = useAnnotationStore.getState()
        if ((tool === 'sam_point' || tool === 'sam_box') && pendingPolygon) {
          acceptPending()
          setTool('select')
        } else {
          handleSave()
        }
        return
      }
      // Ctrl+1~9: 선택된 어노테이션 있으면 그 레이블 변경, 없으면 활성 레이블 전환
      if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const num = parseInt(e.key, 10)  // 1 → labels[0], 2 → labels[1]
        const { labels, selectedId, changeAnnotationLabel, setActiveLabel } = useAnnotationStore.getState()
        const target = labels.find((l) => l.class_index === num - 1) ?? labels[num - 1]
        if (!target) return
        if (selectedId) {
          changeAnnotationLabel(selectedId, target.id)  // 선택된 마스크 레이블 변경
        }
        setActiveLabel(target.id)  // 활성 레이블도 함께 전환
        return
      }
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      // D: 이전 이미지, F: 다음 이미지
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'd') navigateImage(-1)
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'f') navigateImage(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedImage, imageList])

  function navigateImage(dir: number) {
    if (!selectedImage || imageList.length === 0) return
    const idx = imageList.findIndex((i) => i.id === selectedImage.id)
    if (idx === -1) return
    const next = imageList[(idx + dir + imageList.length) % imageList.length]
    if (next) setSelectedImage(next)
  }

  async function handleSave() {
    if (!selectedImage) return
    setSaving(true)
    try {
      const res = await annotationApi.save(selectedImage.id, store.toSaveItems())
      setSelectedImage((prev) => prev ? { ...prev, status: res.status as any } : prev)
      showToast('저장 완료', 'success')
      setRefreshKey((k) => k + 1)
      store.setTool('select')
    } catch (err: any) {
      showToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(status: string) {
    if (!selectedImage) return
    await annotationApi.setStatus(selectedImage.id, status)
    setSelectedImage((prev) => prev ? { ...prev, status: status as any } : prev)
    setRefreshKey((k) => k + 1)
  }

  async function handleUploadImages(files: FileList | null) {
    if (!files || files.length === 0 || !project) return
    const imageFiles = Array.from(files).filter((f) => /\.(jpe?g|png)$/i.test(f.name))
    if (imageFiles.length === 0) { showToast('JPG/PNG 파일만 업로드 가능합니다', 'error'); return }
    setUploading(true)
    setUploadPct(0)
    try {
      const res = await projectApi.uploadImages(project.id, imageFiles, setUploadPct)
      showToast(`${res.uploaded}개 이미지 업로드 완료`, 'success')
      setRefreshKey((k) => k + 1)
    } catch (err: any) {
      showToast(err.message, 'error')
    } finally {
      setUploading(false)
      setUploadPct(null)
      if (uploadRef.current) uploadRef.current.value = ''
    }
  }

  async function handleVideoUpload() {
    if (!videoFile || !project) return
    setVideoUploading(true)
    setVideoUploadPct(0)
    try {
      await projectApi.uploadVideo(project.id, videoFile, videoStartTime, videoEndTime, videoFps, setVideoUploadPct)
      showToast('동영상 업로드 완료. 프레임 추출 중...', 'success')
      setShowVideoModal(false)
      setVideoFile(null)
      setVideoStartTime('')
      setVideoEndTime('')
      setVideoFps(2)
      setRefreshKey((k) => k + 1)
      setTimeout(() => setRefreshKey((k) => k + 1), 5000)
      setTimeout(() => setRefreshKey((k) => k + 1), 12000)
    } catch (err: any) {
      showToast(err.message, 'error')
    } finally {
      setVideoUploading(false)
      setVideoUploadPct(null)
      if (videoUploadRef.current) videoUploadRef.current.value = ''
    }
  }

  async function handleRunJob() {
    if (!project || jobRunning) return
    setShowRoiSetup(true)
  }

  async function handleRoiConfirm(roi: number[] | null) {
    setShowRoiSetup(false)
    if (!project) return
    const force = pendingForce.current
    pendingForce.current = false
    try {
      await projectApi.updateRoi(project.id, roi)
      setProject(prev => prev ? { ...prev, roi } : prev)
    } catch {}
    try {
      const res = await jobApi.start(pid, project.conf_threshold, force)
      if (!res.job_id) { showToast('처리할 이미지가 없습니다', 'error'); return }
      setJobId(res.job_id)
      setJobRunning(true)
    } catch (err: any) {
      showToast(err.message, 'error')
    }
  }

  async function handleDeleteAllAnnotations() {
    if (!project) return
    if (!window.confirm('프로젝트의 어노테이션을 전부 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return
    try {
      await annotationApi.deleteAllForProject(project.id)
      showToast('어노테이션 전체 삭제 완료', 'success')
      store.setAnnotations([])
      setRefreshKey((k) => k + 1)
    } catch (err: any) {
      showToast(err.message, 'error')
    }
  }

  async function handleTrackFromHere(maskMode = false) {
    if (!selectedImage || !project || trackRunning || jobRunning) return
    try {
      await annotationApi.save(selectedImage.id, store.toSaveItems())
      setRefreshKey((k) => k + 1)
    } catch {}
    try {
      const res = await trackApi.start(pid, selectedImage.id, maskMode)
      if (!res.job_id) {
        showToast(res.message ?? '추적할 프레임이 없습니다', 'error')
        return
      }
      setTrackJobId(res.job_id)
      setTrackRunning(true)
    } catch (err: any) {
      showToast(err.message, 'error')
    }
  }

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const statusCfg = {
    pending:   { color: 'bg-gray-500/20 text-gray-400',   label: '대기' },
    annotated: { color: 'bg-green-500/20 text-green-400', label: '완료' },
    review:    { color: 'bg-yellow-500/20 text-yellow-400', label: '검토' },
    done:      { color: 'bg-green-500/20 text-green-400',  label: '완료' },
  }

  return (
    <div className="h-screen flex flex-col bg-cvat-bg overflow-hidden">
      {/* Top navbar */}
      <nav className="h-11 bg-cvat-surface border-b border-cvat-border flex items-center px-4 gap-3 shrink-0 z-10">
        {/* Logo */}
        <button onClick={() => navigate('/projects')} className="flex items-center gap-2 hover:opacity-75 transition-opacity">
          <div className="w-6 h-6 bg-cvat-gold rounded text-black font-bold text-[10px] flex items-center justify-center">EV</div>
          <span className="text-cvat-text text-sm font-semibold">EV Annotator</span>
        </button>

        <span className="text-cvat-muted text-xs">/</span>
        <span className="text-cvat-text text-xs font-medium max-w-[200px] truncate">{project?.name ?? '...'}</span>

        {/* Image navigator */}
        {selectedImage && (
          <>
            <span className="text-cvat-muted text-xs">/</span>
            <div className="flex items-center gap-2">
              <button onClick={() => navigateImage(-1)} className="w-6 h-6 flex items-center justify-center text-cvat-muted hover:text-cvat-text transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
              <span className="text-xs text-cvat-text max-w-[180px] truncate font-mono">{selectedImage.filename}</span>
              <button onClick={() => navigateImage(1)} className="w-6 h-6 flex items-center justify-center text-cvat-muted hover:text-cvat-text transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </button>
              {selectedImage.status && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusCfg[selectedImage.status]?.color}`}>
                  {statusCfg[selectedImage.status]?.label}
                </span>
              )}
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Model selector */}
          <div className="flex items-center gap-1.5">
            {(() => {
              const selectedModel = project?.model_id
                ? models.find(m => m.id === project.model_id)
                : models.find(m => m.is_base)
              const task = selectedModel?.task ?? 'segment'
              return (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold shrink-0 ${
                  task === 'detect'
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                    : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                }`}>
                  {task === 'detect' ? 'bbox' : 'seg'}
                </span>
              )
            })()}
            <select
              value={project?.model_id ?? ''}
              onChange={async (e) => {
                const val = e.target.value
                const newId = val === '' ? null : Number(val)
                await projectApi.setModel(pid, newId)
                setProject(prev => prev ? { ...prev, model_id: newId } : prev)
              }}
              className="bg-cvat-bg border border-cvat-border text-cvat-text text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-cvat-gold max-w-[160px] truncate"
              title="자동 어노테이션에 사용할 모델"
            >
              <option value="">기본 모델 (seg)</option>
              {models.filter(m => !m.is_base).map(m => (
                <option key={m.id} value={m.id}>{m.name} [{m.task === 'detect' ? 'bbox' : 'seg'}]</option>
              ))}
            </select>
          </div>

          {/* Auto-annotate button */}
          <button
            onClick={handleRunJob}
            disabled={jobRunning}
            className="flex items-center gap-1.5 bg-cvat-gold/10 hover:bg-cvat-gold/20 border border-cvat-gold/30 text-cvat-gold text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            자동 어노테이션
          </button>

          {/* Delete all annotations button */}
          <button
            onClick={handleDeleteAllAnnotations}
            disabled={jobRunning}
            className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            title="프로젝트 어노테이션 전체 삭제"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            전체 삭제
          </button>

          {/* SAM2 Video Track buttons */}
          {selectedImage && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleTrackFromHere(false)}
                disabled={trackRunning || jobRunning}
                className="flex items-center gap-1.5 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-400 text-xs px-2.5 py-1.5 rounded-l-lg transition-colors disabled:opacity-50"
                title="SAM2 추적 (bbox)"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                추적 (bbox)
              </button>
              <button
                onClick={() => handleTrackFromHere(true)}
                disabled={trackRunning || jobRunning}
                className="flex items-center gap-1.5 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 border-l-0 text-violet-400 text-xs px-2.5 py-1.5 rounded-r-lg transition-colors disabled:opacity-50"
                title="SAM2 추적 (mask)"
              >
                추적 (mask)
              </button>
            </div>
          )}

          {/* Export */}
          <button
            onClick={() => setShowExport(true)}
            className="flex items-center gap-1.5 text-cvat-muted hover:text-cvat-text text-xs transition-colors border border-cvat-border hover:border-cvat-gold/40 px-2.5 py-1.5 rounded-lg"
            title="데이터셋 내보내기"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Export
          </button>

          <span className="text-cvat-muted text-xs">{user?.display_name}</span>
          <button onClick={() => { logout(); navigate('/') }} className="text-cvat-muted hover:text-cvat-text text-xs transition-colors">
            로그아웃
          </button>
        </div>
      </nav>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: image list */}
        <div
          className={`${sidebarOpen ? 'w-56' : 'w-0'} bg-cvat-surface border-r border-cvat-border flex flex-col transition-all overflow-hidden shrink-0`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleUploadImages(e.dataTransfer.files) }}
        >
          <div className="flex items-center gap-1 px-3 py-2 border-b border-cvat-border shrink-0">
            <span className="text-[10px] text-cvat-muted font-medium uppercase tracking-wider flex-1">이미지 목록</span>
            {/* 이미지 업로드 버튼 */}
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={uploading}
              title="이미지 업로드 (JPG/PNG)"
              className="flex items-center gap-0.5 text-[10px] text-cvat-muted hover:text-cvat-gold disabled:opacity-40 transition-colors"
            >
              {uploading
                ? <span className="font-mono text-cvat-gold">{uploadPct ?? 0}%</span>
                : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              }
              이미지
            </button>
            {/* 동영상 업로드 버튼 */}
            <button
              onClick={() => setShowVideoModal(true)}
              title="동영상 업로드 (MP4/AVI/MOV)"
              className="flex items-center gap-0.5 text-[10px] text-cvat-muted hover:text-blue-400 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" /></svg>
              동영상
            </button>
            <input
              ref={uploadRef}
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              multiple
              className="hidden"
              onChange={(e) => handleUploadImages(e.target.files)}
            />
          </div>

          {/* Job / Track progress — shrink-0 으로 고정 높이, ImageList가 나머지 차지 */}
          {jobId && (
            <div className="p-2 border-b border-cvat-border shrink-0">
              <JobProgress
                jobId={jobId}
                onDone={() => { setJobRunning(false); setRefreshKey((k) => k + 1); showToast('자동 어노테이션 완료', 'success') }}
                onClose={() => { setJobId(null); setJobRunning(false) }}
              />
            </div>
          )}
          {trackJobId && (
            <div className="p-2 border-b border-cvat-border shrink-0">
              <JobProgress
                jobId={trackJobId}
                onDone={() => { setTrackRunning(false); setRefreshKey((k) => k + 1); showToast('비디오 추적 완료', 'success') }}
                onClose={() => { setTrackJobId(null); setTrackRunning(false) }}
              />
            </div>
          )}

          <ImageList
            projectId={pid}
            selectedId={selectedImage?.id ?? null}
            refreshKey={refreshKey}
            onSelect={(img) => setSelectedImage(img)}
            onImagesChange={(items) => setImageList(items)}
          />
        </div>

        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-3 h-12 bg-cvat-border hover:bg-cvat-gold/40 transition-colors rounded-r flex items-center justify-center"
          style={{ left: sidebarOpen ? 224 : 0 }}
        >
          <svg className="w-2 h-2 text-cvat-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sidebarOpen ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"} />
          </svg>
        </button>

        {/* Toolbar + Canvas */}
        <div className="flex flex-1 overflow-hidden">
          <ToolBar />
          {selectedImage ? (
            <AnnotationCanvas
              imageId={selectedImage.id}
              imageUrl={imageApi.thumbUrl(selectedImage.id)}
              labels={project?.labels ?? []}
              onSamError={(msg) => showToast(msg, 'error')}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-[#1a1a1a]">
              <div className="text-center">
                <div className="w-16 h-16 bg-cvat-panel border-2 border-dashed border-cvat-border rounded-xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-cvat-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </div>
                <p className="text-cvat-muted text-sm">왼쪽에서 이미지를 선택하세요</p>
                <p className="text-cvat-muted/60 text-xs mt-1">A/D 또는 ←/→ 로 이동 가능</p>
              </div>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className={`${panelOpen ? 'w-60' : 'w-0'} bg-cvat-surface border-l border-cvat-border flex flex-col overflow-hidden shrink-0 transition-all`}>
          {project && (
            <AnnotationPanel
              labels={project.labels}
              imageStatus={selectedImage?.status}
              onSave={handleSave}
              onStatusChange={handleStatusChange}
              saving={saving}
            />
          )}
        </div>
      </div>

      {/* ROI Setup Modal */}
      {showRoiSetup && project && (
        <RoiSetupModal
          project={project}
          imageId={selectedImage?.id ?? null}
          onClose={() => setShowRoiSetup(false)}
          onConfirm={handleRoiConfirm}
        />
      )}

      {/* Export Modal */}
      {showExport && project && (
        <ExportModal
          projectId={project.id}
          projectName={project.name}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* Video Upload Modal */}
      {showVideoModal && project && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-cvat-surface border border-cvat-border rounded-xl shadow-2xl w-[360px] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-cvat-text">동영상 업로드 (프레임 추출)</h3>
              <button onClick={() => { setShowVideoModal(false); setVideoFile(null) }} className="text-cvat-muted hover:text-cvat-text">✕</button>
            </div>

            {/* 파일 선택 */}
            <div
              className="border-2 border-dashed border-cvat-border rounded-lg p-4 text-center cursor-pointer hover:border-blue-500/50 transition-colors mb-4"
              onClick={() => videoUploadRef.current?.click()}
            >
              {videoFile
                ? <p className="text-xs text-cvat-text truncate">{videoFile.name}</p>
                : <p className="text-xs text-cvat-muted">MP4 / AVI / MOV / MKV 클릭하여 선택</p>
              }
            </div>
            <input
              ref={videoUploadRef}
              type="file"
              accept=".mp4,.avi,.mov,.mkv,.webm,.ts,video/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && setVideoFile(e.target.files[0])}
            />

            {/* 시간 범위 */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[10px] text-cvat-muted mb-1 block">시작 시간 (비워두면 처음부터)</label>
                <input
                  type="text"
                  placeholder="00:01:30"
                  value={videoStartTime}
                  onChange={(e) => setVideoStartTime(e.target.value)}
                  className="w-full bg-cvat-bg border border-cvat-border rounded px-2 py-1.5 text-xs text-cvat-text focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-[10px] text-cvat-muted mb-1 block">종료 시간 (비워두면 끝까지)</label>
                <input
                  type="text"
                  placeholder="00:02:00"
                  value={videoEndTime}
                  onChange={(e) => setVideoEndTime(e.target.value)}
                  className="w-full bg-cvat-bg border border-cvat-border rounded px-2 py-1.5 text-xs text-cvat-text focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* FPS */}
            <div className="mb-4">
              <label className="text-[10px] text-cvat-muted mb-1 block">추출 FPS (초당 프레임 수)</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0.5}
                  max={10}
                  step={0.5}
                  value={videoFps}
                  onChange={(e) => setVideoFps(parseFloat(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs text-cvat-text w-10 text-right">{videoFps} fps</span>
              </div>
              <p className="text-[10px] text-cvat-muted mt-1">낮을수록 적은 프레임 (권장: 1~2fps)</p>
            </div>

            {videoUploading && videoUploadPct !== null && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-cvat-muted">
                    {videoUploadPct < 100 ? '업로드 중...' : '서버 처리 중...'}
                  </span>
                  <span className="text-[10px] font-mono text-cvat-text">{videoUploadPct}%</span>
                </div>
                <div className="w-full bg-cvat-border rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${videoUploadPct < 100 ? 'bg-blue-500' : 'bg-green-500 animate-pulse'}`}
                    style={{ width: `${videoUploadPct}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => { setShowVideoModal(false); setVideoFile(null) }}
                disabled={videoUploading}
                className="flex-1 py-2 text-xs text-cvat-muted border border-cvat-border rounded-lg hover:border-cvat-text disabled:opacity-40 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleVideoUpload}
                disabled={!videoFile || videoUploading}
                className="flex-1 py-2 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg transition-colors flex items-center justify-center gap-1"
              >
                {videoUploading
                  ? <><span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />{videoUploadPct !== null && videoUploadPct < 100 ? `${videoUploadPct}%` : '처리 중...'}</>
                  : '프레임 추출'
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl border transition-all ${
          toast.type === 'success'
            ? 'bg-green-900/80 border-green-700/50 text-green-300'
            : 'bg-red-900/80 border-red-700/50 text-red-300'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
