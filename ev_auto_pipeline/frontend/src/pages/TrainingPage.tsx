import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { datasetApi, modelApi, type DatasetSnapshot, type ModelVersion } from '../api/client'
import { useAuthStore } from '../store/useAuthStore'

function UploadZipButton({ onUploaded }: { onUploaded: (ds: DatasetSnapshot) => void }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const result = await datasetApi.upload(file)
      onUploaded({
        id: result.id,
        project_name: file.name.replace('.zip', ''),
        label_names: result.label_names,
        image_count: result.image_count,
        created_at: new Date().toISOString(),
      })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="relative">
      <input ref={inputRef} type="file" accept=".zip" className="hidden" onChange={handleFile} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title="YOLO 형식 ZIP 업로드 (Roboflow 등)"
        className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 border border-blue-200 hover:border-blue-400 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
      >
        {uploading ? (
          <><span className="w-3 h-3 border-2 border-blue-300 border-t-blue-500 rounded-full animate-spin" />업로드 중...</>
        ) : (
          <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>ZIP 업로드</>
        )}
      </button>
      {error && (
        <div className="absolute top-full mt-1 right-0 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600 whitespace-nowrap z-10">
          {error}
        </div>
      )}
    </div>
  )
}

export default function TrainingPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const [datasets, setDatasets] = useState<DatasetSnapshot[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [models, setModels] = useState<ModelVersion[]>([])
  const [loading, setLoading] = useState(true)

  // 학습 설정
  const [modelName, setModelName] = useState('')
  const [baseModelId, setBaseModelId] = useState<number | ''>('')
  const [epochs, setEpochs] = useState(50)
  const [task, setTask] = useState<'detect' | 'segment'>('detect')

  // 진행 중인 학습
  const [_jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<{ status: string; progress: number; total: number; error?: string } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    load()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [ds, ms] = await Promise.all([datasetApi.list(), modelApi.list()])
      setDatasets(ds)
      setModels(ms)
    } finally {
      setLoading(false)
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(prev => prev.size === datasets.length ? new Set() : new Set(datasets.map(d => d.id)))
  }

  async function handleDelete(id: string) {
    if (!confirm('이 데이터셋 스냅샷을 삭제하시겠습니까?')) return
    await datasetApi.delete(id)
    setDatasets(prev => prev.filter(d => d.id !== id))
    setSelected(prev => { const next = new Set(prev); next.delete(id); return next })
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return
    if (!confirm(`선택한 ${selected.size}개의 데이터셋을 삭제하시겠습니까?`)) return
    await Promise.all(Array.from(selected).map(id => datasetApi.delete(id)))
    setDatasets(prev => prev.filter(d => !selected.has(d.id)))
    setSelected(new Set())
  }

  async function handleTrain() {
    if (selected.size === 0) { alert('데이터셋을 하나 이상 선택하세요.'); return }
    if (!modelName.trim()) { alert('모델 이름을 입력하세요.'); return }
    try {
      const res = await datasetApi.finetuneFromDatasets({
        dataset_ids: Array.from(selected),
        model_name: modelName.trim(),
        base_model_id: baseModelId === '' ? undefined : baseModelId,
        epochs,
        task,
      })
      setJobId(res.job_id)
      setJobStatus({ status: 'running', progress: 0, total: epochs })
      startPolling(res.job_id)
    } catch (err: any) {
      alert(err.message)
    }
  }

  function startPolling(jid: string) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const s = await modelApi.getFinetuneJob(jid)
        setJobStatus(s)
        if (s.status === 'done' || s.status === 'error') {
          clearInterval(pollRef.current!)
          if (s.status === 'done') modelApi.list().then(setModels)
        }
      } catch {}
    }, 1500)
  }

  const totalImages = datasets.filter(d => selected.has(d.id)).reduce((s, d) => s + d.image_count, 0)
  const isRunning = jobStatus?.status === 'running'
  const pct = jobStatus ? Math.round((jobStatus.progress / Math.max(jobStatus.total, 1)) * 100) : 0

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Navbar */}
      <nav className="h-12 bg-white border-b border-gray-200 flex items-center px-6 gap-6 shrink-0 shadow-sm">
        <button onClick={() => navigate('/')} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 bg-cvat-gold rounded flex items-center justify-center text-black font-bold text-xs">EV</div>
          <span className="text-gray-800 font-bold text-sm tracking-wide">EV Annotator</span>
        </button>

        <div className="flex items-center gap-1 text-sm">
          <button onClick={() => navigate('/projects')} className="px-3 py-1.5 rounded text-gray-500 hover:text-gray-800 transition-colors">
            Projects
          </button>
          <button className="px-3 py-1.5 rounded text-gray-900 font-semibold">
            Training
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-gray-500 text-sm">{user?.display_name}</span>
          {user?.role === 'admin' && (
            <button onClick={() => navigate('/admin')} className="text-gray-500 hover:text-gray-800 text-sm transition-colors">
              Admin
            </button>
          )}
          <button onClick={() => { logout(); navigate('/') }} className="text-gray-500 hover:text-gray-800 text-sm transition-colors">
            로그아웃
          </button>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden gap-0">
        {/* 왼쪽: 데이터셋 목록 */}
        <div className="w-[55%] flex flex-col border-r border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">저장된 데이터셋</h2>
              <p className="text-xs text-gray-500 mt-0.5">Export 자동 저장 또는 외부 ZIP 업로드</p>
            </div>
            <div className="flex items-center gap-2">
              <UploadZipButton onUploaded={ds => setDatasets(prev => [ds, ...prev])} />
              {selected.size > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {selected.size}개 삭제
                </button>
              )}
              <span className="text-xs text-gray-400">{datasets.length}개</span>
            </div>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">로딩 중...</div>
          ) : datasets.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
              <p className="text-sm">저장된 데이터셋이 없습니다</p>
              <p className="text-xs">어노테이터에서 Export 하면 여기에 자동으로 저장됩니다</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {/* 전체 선택 헤더 */}
              <div className="px-6 py-2 border-b border-gray-100 flex items-center gap-3 bg-gray-50">
                <input
                  type="checkbox"
                  checked={selected.size === datasets.length && datasets.length > 0}
                  onChange={toggleAll}
                  className="w-4 h-4 accent-cvat-gold"
                />
                <span className="text-xs text-gray-500">전체 선택</span>
                {selected.size > 0 && (
                  <span className="ml-auto text-xs text-cvat-gold font-medium">
                    {selected.size}개 선택 · {totalImages.toLocaleString()}장
                  </span>
                )}
              </div>

              {datasets.map(ds => (
                <div
                  key={ds.id}
                  className={`flex items-center gap-4 px-6 py-3.5 border-b border-gray-100 cursor-pointer transition-colors ${
                    selected.has(ds.id) ? 'bg-yellow-50' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => toggleSelect(ds.id)}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(ds.id)}
                    onChange={() => toggleSelect(ds.id)}
                    onClick={e => e.stopPropagation()}
                    className="w-4 h-4 accent-cvat-gold shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 truncate">{ds.project_name}</span>
                      <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded px-1.5 py-0.5 shrink-0">
                        {ds.image_count.toLocaleString()}장
                      </span>
                      {ds.source === 'external' && (
                        <span className="text-xs bg-purple-50 text-purple-600 border border-purple-200 rounded px-1.5 py-0.5 shrink-0">
                          외부
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400 font-mono">{ds.id}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-gray-400">
                        {ds.label_names.join(', ')}
                      </span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-gray-400">
                        {new Date(ds.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(ds.id) }}
                    className="p-1.5 text-gray-300 hover:text-red-400 transition-colors shrink-0 rounded"
                    title="삭제"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 오른쪽: 학습 설정 + 진행률 */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          <div className="px-6 py-4 border-b border-gray-100 shrink-0">
            <h2 className="text-sm font-semibold text-gray-800">파인튜닝 설정</h2>
            <p className="text-xs text-gray-500 mt-0.5">선택된 데이터셋으로 YOLO 모델을 학습합니다</p>
          </div>

          <div className="px-6 py-5 space-y-5 flex-1">
            {/* 모델 이름 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">모델 이름 *</label>
              <input
                type="text"
                value={modelName}
                onChange={e => setModelName(e.target.value)}
                placeholder="예: fire_smoke_v4"
                disabled={isRunning}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-cvat-gold disabled:bg-gray-100"
              />
            </div>

            {/* 베이스 모델 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">베이스 모델</label>
              <select
                value={baseModelId}
                onChange={e => setBaseModelId(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={isRunning}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-cvat-gold disabled:bg-gray-100"
              >
                <optgroup label="── EV 파인튜닝 ──">
                  <option value="">기본 모델 (yolo11m_ev)</option>
                </optgroup>
                {models.filter(m => !m.is_base && !m.weights_path.includes('/')).length > 0 && (
                  <optgroup label="── Ultralytics 공식 ──">
                    {models.filter(m => !m.is_base && !m.weights_path.includes('/')).map(m => (
                      <option key={m.id} value={m.id}>{m.weights_path} [{m.task}]</option>
                    ))}
                  </optgroup>
                )}
                {models.filter(m => !m.is_base && m.weights_path.includes('/') && m.task !== 'gdino').length > 0 && (
                  <optgroup label="── 커스텀 파인튜닝 ──">
                    {models.filter(m => !m.is_base && m.weights_path.includes('/') && m.task !== 'gdino').map(m => (
                      <option key={m.id} value={m.id}>{m.name} [{m.task}]</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Task */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">학습 Task</label>
              <div className="flex gap-2">
                {(['detect', 'segment'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => !isRunning && setTask(t)}
                    disabled={isRunning}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      task === t
                        ? 'bg-cvat-gold/10 border-cvat-gold text-yellow-700'
                        : 'border-gray-300 text-gray-500 hover:border-gray-400'
                    } disabled:opacity-50`}
                  >
                    {t === 'detect' ? 'Detect (bbox)' : 'Segment (polygon)'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {task === 'detect' ? '불/연기 등 bbox 탐지 — 빠른 추론' : '폴리곤 세그멘테이션 — 정밀한 경계'}
              </p>
            </div>

            {/* 에폭 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                학습 에폭: <span className="text-cvat-gold font-mono font-semibold">{epochs}</span>
              </label>
              <input
                type="range" min={10} max={150} step={5} value={epochs}
                onChange={e => setEpochs(Number(e.target.value))}
                disabled={isRunning}
                className="w-full accent-cvat-gold disabled:opacity-50"
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                <span>10 (빠름)</span><span>150 (정확)</span>
              </div>
            </div>

            {/* 선택 요약 */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-600 space-y-1">
              <div className="flex justify-between"><span>선택된 데이터셋</span><span className="font-medium">{selected.size}개</span></div>
              <div className="flex justify-between"><span>총 학습 이미지</span><span className="font-medium">{totalImages.toLocaleString()}장</span></div>
              <div className="flex justify-between"><span>예상 소요</span><span className="font-medium">~{Math.round(epochs * 0.12)}분 (GPU 3)</span></div>
            </div>

            {/* 시작 버튼 */}
            <button
              onClick={handleTrain}
              disabled={isRunning || selected.size === 0 || !modelName.trim()}
              className="w-full py-2.5 bg-cvat-gold hover:bg-cvat-gold-h disabled:opacity-40 text-black font-semibold text-sm rounded-lg transition-colors"
            >
              {isRunning ? '학습 중...' : '파인튜닝 시작'}
            </button>

            {/* 진행률 */}
            {jobStatus && (
              <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    {jobStatus.status === 'running' && '학습 중'}
                    {jobStatus.status === 'done' && '✓ 학습 완료'}
                    {jobStatus.status === 'error' && '✕ 오류 발생'}
                  </span>
                  <span className="text-xs font-mono text-gray-500">
                    {jobStatus.progress} / {jobStatus.total} epoch
                  </span>
                </div>

                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      jobStatus.status === 'done' ? 'bg-green-500' :
                      jobStatus.status === 'error' ? 'bg-red-500' :
                      'bg-cvat-gold'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{pct}% 완료</span>
                  {jobStatus.status === 'running' && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-cvat-gold rounded-full animate-pulse" />
                      GPU 3 학습 중
                    </span>
                  )}
                  {jobStatus.status === 'done' && (
                    <span className="text-green-600">모델 목록에 자동 등록되었습니다</span>
                  )}
                </div>

                {jobStatus.status === 'error' && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600">
                    {jobStatus.error}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
