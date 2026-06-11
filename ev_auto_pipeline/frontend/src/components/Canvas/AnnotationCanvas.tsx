import { useEffect, useRef, useState, useCallback } from 'react'
import Konva from 'konva'
import { Stage, Layer, Image as KImage, Line, Circle, Rect, Group } from 'react-konva'
import useImage from 'use-image'
import { useAnnotationStore } from '../../store/useAnnotationStore'
import { annotationApi } from '../../api/client'
import type { Label } from '../../api/client'

interface Props {
  imageId: number | null
  imageUrl: string | null
  labels: Label[]
  onSamError?: (msg: string) => void
}

const MIN_SCALE = 0.1
const MAX_SCALE = 8

function denorm(points: number[], w: number, h: number): number[] {
  const out: number[] = []
  for (let i = 0; i < points.length; i += 2) out.push(points[i] * w, points[i + 1] * h)
  return out
}

export default function AnnotationCanvas({ imageId, imageUrl, labels, onSamError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [imgSrc] = useImage(imageUrl ?? '', 'anonymous')
  const [imgNatural, setImgNatural] = useState({ w: 1, h: 1 })
  // imgReady: 새 이미지가 완전히 로드되고 치수가 확정됐을 때만 true
  // → false 동안 어노테이션 렌더 중단 (위치 이상 방지)
  const [imgReady, setImgReady] = useState(false)

  // Polygon drawing state
  const [drawPts, setDrawPts] = useState<number[]>([])
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)

  // SAM box state
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null)
  const [boxEnd, setBoxEnd] = useState<{ x: number; y: number } | null>(null)
  const [samLoading, setSamLoading] = useState(false)

  const store = useAnnotationStore()
  const { annotations, selectedId, tool, labels: storeLabels, activeLabelId, samPoints, pendingPolygon } = store
  const labelMap = Object.fromEntries(labels.map((l) => [l.id, l]))

  // Resize observer
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // URL 바뀌면 ready 해제 — 단, 브라우저 캐시에 이미 있으면 스킵
  useEffect(() => {
    if (!imageUrl) { setImgReady(false); return }
    const probe = new window.Image()
    probe.onload = () => {
      // 캐시 히트: 즉시 표시 가능하므로 ready 유지(또는 바로 true)
      // use-image도 캐시에서 즉시 가져오므로 setImgReady(false)는 불필요
    }
    probe.onerror = () => setImgReady(false)
    // complete = 이미 캐시에 있음 → ready 해제 안 함
    probe.src = imageUrl
    if (!probe.complete) setImgReady(false)
  }, [imageUrl])

  // 이미지 로드 완료 → 치수 확정 → ready
  useEffect(() => {
    if (!imgSrc) return
    const { naturalWidth: nw, naturalHeight: nh } = imgSrc as HTMLImageElement
    setImgNatural({ w: nw || 1, h: nh || 1 })
    const scaleX = size.w / nw
    const scaleY = size.h / nh
    const s = Math.min(scaleX, scaleY) * 0.95
    setScale(s)
    setOffset({ x: (size.w - nw * s) / 2, y: (size.h - nh * s) / 2 })
    setImgReady(true)
  }, [imgSrc, size.w, size.h])

  // Stage coordinate helpers
  const toNorm = useCallback((cx: number, cy: number) => ({
    x: (cx - offset.x) / scale / imgNatural.w,
    y: (cy - offset.y) / scale / imgNatural.h,
  }), [imgNatural, scale, offset])

  // Wheel zoom
  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const pointer = stage.getPointerPosition()!
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (e.evt.deltaY < 0 ? 1.1 : 1 / 1.1)))
    setOffset({
      x: pointer.x - (pointer.x - offset.x) * (newScale / scale),
      y: pointer.y - (pointer.y - offset.y) * (newScale / scale),
    })
    setScale(newScale)
  }

  // Panning
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 })
  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    const pos = stageRef.current!.getPointerPosition()!
    if (e.evt.button === 1 || (e.evt.button === 0 && tool === 'select' && !e.target.name())) {
      isPanning.current = true
      panStart.current = { x: pos.x, y: pos.y, ox: offset.x, oy: offset.y }
      return
    }

    const { x, y } = toNorm(pos.x, pos.y)

    if (tool === 'polygon') {
      // Double-click closes polygon
      setDrawPts((pts) => [...pts, x, y])
    } else if (tool === 'rect' || tool === 'sam_box') {
      setBoxStart({ x, y })
      setBoxEnd(null)
    } else if (tool === 'sam_point') {
      const label = e.evt.button === 2 ? 0 : 1
      store.addSamPoint(x, y, label)
      triggerSamPoints([...samPoints, { x, y, label }])
    }
  }

  function handleMouseMove(_e: Konva.KonvaEventObject<MouseEvent>) {
    const pos = stageRef.current!.getPointerPosition()!
    if (isPanning.current) {
      setOffset({ x: panStart.current.ox + pos.x - panStart.current.x, y: panStart.current.oy + pos.y - panStart.current.y })
      return
    }
    const n = toNorm(pos.x, pos.y)
    setMousePos({ x: n.x, y: n.y })
    if ((tool === 'sam_box' || tool === 'rect') && boxStart) setBoxEnd(n)
  }

  function handleMouseUp(_e: Konva.KonvaEventObject<MouseEvent>) {
    if (isPanning.current) { isPanning.current = false; return }
    if (boxStart && boxEnd) {
      const x1 = Math.min(boxStart.x, boxEnd.x)
      const y1 = Math.min(boxStart.y, boxEnd.y)
      const x2 = Math.max(boxStart.x, boxEnd.x)
      const y2 = Math.max(boxStart.y, boxEnd.y)
      if (tool === 'rect' && x2 - x1 > 0.005 && y2 - y1 > 0.005) {
        // 직사각형을 4점 폴리곤으로 직접 저장
        store.addAnnotation({
          label_id: activeLabelId ?? storeLabels[0]?.id ?? 1,
          polygon: [x1, y1, x2, y1, x2, y2, x1, y2],
          is_auto: false,
          needs_review: false,
        })
      } else if (tool === 'sam_box') {
        triggerSamBbox([x1, y1, x2, y2])
      }
      setBoxStart(null); setBoxEnd(null)
    }
  }

  function handleDblClick(_e?: Konva.KonvaEventObject<MouseEvent>) {
    if (tool === 'polygon' && drawPts.length >= 6) {
      store.addAnnotation({
        label_id: activeLabelId ?? storeLabels[0]?.id ?? 1,
        polygon: drawPts,
        is_auto: false,
        needs_review: false,
      })
      setDrawPts([])
    }
  }

  async function triggerSamPoints(pts: typeof samPoints) {
    if (!imageId || samLoading) return
    setSamLoading(true)
    try {
      const res = await annotationApi.samPoints(imageId, pts.map((p) => [p.x, p.y]), pts.map((p) => p.label))
      store.setPendingPolygon(res.polygon)
    } catch (err: any) {
      onSamError?.(err.message)
    } finally {
      setSamLoading(false)
    }
  }

  async function triggerSamBbox(bbox: number[]) {
    if (!imageId || samLoading) return
    setSamLoading(true)
    try {
      const res = await annotationApi.samBbox(imageId, bbox)
      store.setPendingPolygon(res.polygon)
    } catch (err: any) {
      onSamError?.(err.message)
    } finally {
      setSamLoading(false)
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      switch (e.key.toLowerCase()) {
        case 'v': store.setTool('select'); break
        case 'r': store.setTool('rect'); break
        case 'p': store.setTool('polygon'); break
        case 's': store.setTool('sam_point'); break
        case 'b': store.setTool('sam_box'); break
        case 'escape':
          setDrawPts([]); setBoxStart(null); setBoxEnd(null)
          store.clearSamPoints(); store.setPendingPolygon(null)
          break
        case 'enter':
          if (tool === 'polygon' && drawPts.length >= 6) {
            store.addAnnotation({ label_id: activeLabelId ?? storeLabels[0]?.id ?? 1, polygon: drawPts, is_auto: false, needs_review: false })
            setDrawPts([])
          } else if (pendingPolygon) {
            store.acceptPending()
          }
          break
        case 'delete':
        case 'backspace':
          if (selectedId) store.removeAnnotation(selectedId)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool, drawPts, selectedId, pendingPolygon, activeLabelId, storeLabels, samPoints])

  const nw = imgNatural.w, nh = imgNatural.h

  return (
    <div ref={containerRef} className="relative flex-1 bg-[#1a1a1a] overflow-hidden select-none" onContextMenu={(e) => e.preventDefault()}>
      {/* 이미지 로딩 스피너 */}
      {imageUrl && !imgReady && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="w-8 h-8 border-2 border-cvat-border border-t-cvat-gold rounded-full animate-spin" />
        </div>
      )}
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDblClick={handleDblClick}
        style={{ cursor: (tool === 'polygon' || tool === 'rect' || tool.startsWith('sam')) ? 'crosshair' : 'default' }}
      >
        <Layer>
          {/* Image — ready 됐을 때만 렌더 (페이드인) */}
          {imgSrc && imgReady && (
            <KImage
              image={imgSrc}
              x={offset.x} y={offset.y}
              width={nw * scale} height={nh * scale}
              opacity={1}
            />
          )}

          {/* Existing annotations — 이미지 치수 확정 후에만 렌더 */}
          {imgReady && annotations.map((a) => {
            const label = labelMap[a.label_id]
            const color = label?.color ?? '#888888'
            const pts = denorm(a.polygon, nw, nh).map((v, i) => i % 2 === 0 ? v * scale + offset.x : v * scale + offset.y)
            const isSelected = a._key === selectedId
            return (
              <Group key={a._key} onClick={() => store.setSelected(a._key === selectedId ? null : a._key)}>
                <Line
                  points={pts}
                  closed
                  fill={color + '33'}
                  stroke={isSelected ? '#ffffff' : color}
                  strokeWidth={isSelected ? 2 : 1.5}
                  dash={isSelected ? [5, 3] : undefined}
                  listening
                />
                {isSelected && (() => {
                  const isRect = a.polygon.length === 8
                  if (isRect) {
                    // 직사각형: bbox 방식으로 코너 4개를 독립 조절
                    const xs = a.polygon.filter((_, i) => i % 2 === 0)
                    const ys = a.polygon.filter((_, i) => i % 2 === 1)
                    let rx1 = Math.min(...xs), ry1 = Math.min(...ys)
                    let rx2 = Math.max(...xs), ry2 = Math.max(...ys)
                    const corners = [
                      { cx: rx1, cy: ry1 }, { cx: rx2, cy: ry1 },
                      { cx: rx2, cy: ry2 }, { cx: rx1, cy: ry2 },
                    ]
                    return corners.map((c, idx) => (
                      <Circle
                        key={idx}
                        x={c.cx * nw * scale + offset.x}
                        y={c.cy * nh * scale + offset.y}
                        radius={5}
                        fill="white"
                        stroke={color}
                        strokeWidth={1.5}
                        draggable
                        onDragMove={(e) => {
                          const nx = (e.target.x() - offset.x) / scale / nw
                          const ny = (e.target.y() - offset.y) / scale / nh
                          // 드래그한 코너에 따라 x1/x2, y1/y2 결정
                          let nx1 = rx1, ny1 = ry1, nx2 = rx2, ny2 = ry2
                          if (idx === 0) { nx1 = nx; ny1 = ny }
                          else if (idx === 1) { nx2 = nx; ny1 = ny }
                          else if (idx === 2) { nx2 = nx; ny2 = ny }
                          else { nx1 = nx; ny2 = ny }
                          const x1 = Math.min(nx1, nx2), x2 = Math.max(nx1, nx2)
                          const y1 = Math.min(ny1, ny2), y2 = Math.max(ny1, ny2)
                          store.updateAnnotation(a._key, [x1, y1, x2, y1, x2, y2, x1, y2])
                        }}
                      />
                    ))
                  }
                  // 폴리곤: 꼭짓점 개별 드래그 (기존 방식)
                  return pts.filter((_, i) => i % 2 === 0).map((_, idx) => (
                    <Circle
                      key={idx}
                      x={pts[idx * 2]}
                      y={pts[idx * 2 + 1]}
                      radius={4}
                      fill="white"
                      stroke={color}
                      strokeWidth={1.5}
                      draggable
                      onDragMove={(e) => {
                        const newPts = [...a.polygon]
                        newPts[idx * 2] = (e.target.x() - offset.x) / scale / nw
                        newPts[idx * 2 + 1] = (e.target.y() - offset.y) / scale / nh
                        store.updateAnnotation(a._key, newPts)
                      }}
                    />
                  ))
                })()}
              </Group>
            )
          })}

          {/* 이하 요소들도 이미지 로드 완료 후에만 렌더 */}
          {/* Pending polygon being drawn */}
          {imgReady && drawPts.length >= 2 && (() => {
            const pts = denorm(drawPts, nw, nh).map((v, i) => i % 2 === 0 ? v * scale + offset.x : v * scale + offset.y)
            const withMouse = mousePos ? [...pts, mousePos.x * nw * scale + offset.x, mousePos.y * nh * scale + offset.y] : pts
            return (
              <>
                <Line points={withMouse} stroke="#c8a84b" strokeWidth={1.5} dash={[4, 2]} />
                {pts.filter((_, i) => i % 2 === 0).map((_, idx) => (
                  <Circle key={idx} x={pts[idx * 2]} y={pts[idx * 2 + 1]} radius={3} fill="#c8a84b" />
                ))}
              </>
            )
          })()}

          {/* SAM2 pending mask preview */}
          {imgReady && pendingPolygon && (() => {
            const pts = denorm(pendingPolygon, nw, nh).map((v, i) => i % 2 === 0 ? v * scale + offset.x : v * scale + offset.y)
            const label = labelMap[activeLabelId ?? storeLabels[0]?.id ?? 0]
            const color = label?.color ?? '#c8a84b'
            return (
              <Line points={pts} closed fill={color + '55'} stroke={color} strokeWidth={2} dash={[6, 3]} />
            )
          })()}

          {/* SAM point markers */}
          {imgReady && samPoints.map((p, i) => (
            <Circle
              key={i}
              x={p.x * nw * scale + offset.x}
              y={p.y * nh * scale + offset.y}
              radius={6}
              fill={p.label === 1 ? '#22c55e' : '#ef4444'}
              stroke="white"
              strokeWidth={1.5}
            />
          ))}

          {/* SAM box preview */}
          {boxStart && boxEnd && (() => {
            const x1 = Math.min(boxStart.x, boxEnd.x) * nw * scale + offset.x
            const y1 = Math.min(boxStart.y, boxEnd.y) * nh * scale + offset.y
            const x2 = Math.max(boxStart.x, boxEnd.x) * nw * scale + offset.x
            const y2 = Math.max(boxStart.y, boxEnd.y) * nh * scale + offset.y
            return <Rect x={x1} y={y1} width={x2-x1} height={y2-y1} stroke="#c8a84b" strokeWidth={1.5} dash={[5, 3]} fill="#c8a84b22" />
          })()}
        </Layer>
      </Stage>

      {/* SAM loading indicator */}
      {samLoading && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-cvat-surface/90 border border-cvat-border rounded-full px-3 py-1.5 flex items-center gap-2 text-xs text-cvat-text">
          <span className="w-3 h-3 border-2 border-cvat-gold/30 border-t-cvat-gold rounded-full animate-spin" />
          SAM2 처리 중...
        </div>
      )}

      {/* SAM hint */}
      {(tool === 'sam_point' || tool === 'sam_box') && !samLoading && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-cvat-surface/90 border border-cvat-border rounded-full px-3 py-1.5 text-xs text-cvat-muted">
          {tool === 'sam_point' ? '좌클릭: 포함 | 우클릭: 제외 | Enter: 확정 | Esc: 취소' : '드래그로 박스 그리기 | Enter: 확정 | Esc: 취소'}
        </div>
      )}
      {tool === 'rect' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-cvat-surface/90 border border-cvat-border rounded-full px-3 py-1.5 text-xs text-cvat-muted">
          드래그로 직사각형 그리기 | Esc: 취소
        </div>
      )}
      {tool === 'polygon' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-cvat-surface/90 border border-cvat-border rounded-full px-3 py-1.5 text-xs text-cvat-muted">
          클릭으로 점 추가 | 더블클릭 또는 Enter로 완성 | Esc: 취소
        </div>
      )}

      {/* Zoom level */}
      <div className="absolute bottom-4 right-4 bg-cvat-surface/80 border border-cvat-border rounded px-2 py-1 text-[10px] text-cvat-muted font-mono">
        {Math.round(scale * 100)}%
      </div>
    </div>
  )
}
