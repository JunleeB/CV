import { useState } from 'react'

interface Format {
  id: string
  label: string
  desc: string
}

const FORMATS: Format[] = [
  {
    id: 'yolo_seg',
    label: 'YOLO Segmentation 1.0',
    desc: 'Ultralytics YOLO — 폴리곤 세그먼테이션 (class x1 y1 x2 y2 ...)',
  },
  {
    id: 'yolo_det',
    label: 'YOLO Detection 1.0',
    desc: 'Ultralytics YOLO — 바운딩박스 (class cx cy w h)',
  },
  {
    id: 'coco',
    label: 'COCO 1.0',
    desc: 'MS COCO JSON — segmentation + bbox + categories',
  },
  {
    id: 'voc',
    label: 'Pascal VOC 1.1',
    desc: 'Pascal VOC XML — 이미지별 bndbox XML',
  },
  {
    id: 'csv',
    label: 'CSV 1.0',
    desc: '단순 CSV — filename, label, polygon, confidence',
  },
]

interface Props {
  projectId: number
  projectName: string
  onClose: () => void
}

export default function ExportModal({ projectId, projectName, onClose }: Props) {
  const [selected, setSelected] = useState('yolo_seg')
  const [includeImages, setIncludeImages] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleExport() {
    setLoading(true)
    try {
      const token = localStorage.getItem('access_token') ?? ''
      const res = await fetch(
        `/api/projects/${projectId}/export?format=${selected}&include_images=${includeImages}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) throw new Error('Export 실패')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const imgSuffix = includeImages ? '_with_images' : ''
      a.download = `${projectName}_${selected}${imgSuffix}.zip`
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch {
      alert('Export 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl w-[500px] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="font-semibold text-gray-900 text-base">Export dataset</h2>
            <p className="text-xs text-gray-400 mt-0.5">{projectName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Format selector */}
          <div>
            <label className="block text-xs font-semibold text-red-500 mb-2">* Export format</label>
            <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelected(f.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    selected === f.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm ${selected === f.id ? 'text-blue-700 font-semibold' : 'text-gray-800'}`}>
                      {f.label}
                    </span>
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">{f.desc}</p>
                  </div>
                  {selected === f.id && (
                    <svg className="w-4 h-4 text-blue-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Save images toggle */}
          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium text-gray-800">이미지 포함</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {includeImages
                  ? '이미지 파일 포함 — 다른 머신/서버에서도 바로 사용 가능'
                  : '라벨만 포함 (이미지 미포함) — 동일 서버에서 바로 학습 가능'}
              </p>
            </div>
            <button
              onClick={() => setIncludeImages((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                includeImages ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition duration-200 ${
                  includeImages ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 transition-colors">
            취소
          </button>
          <button
            onClick={handleExport}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors flex items-center gap-2"
          >
            {loading ? (
              <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />내보내는 중...</>
            ) : (
              <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>Export</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
