import { useState, type FormEvent, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/client'
import { useAuthStore } from '../store/useAuthStore'

/* ── Image Slideshow Preview ── */
function ImageSlideshow() {
  const [slides, setSlides] = useState<{ id: number; filename: string }[]>([])
  const [current, setCurrent] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/public/preview')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data) && data.length > 0) setSlides(data) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (slides.length === 0) return
    const t = setInterval(() => {
      setLoaded(false)
      setTimeout(() => setCurrent((c) => (c + 1) % slides.length), 200)
    }, 3000)
    return () => clearInterval(t)
  }, [slides.length])

  if (slides.length === 0) {
    return (
      <div className="w-full h-full bg-cvat-bg flex items-center justify-center rounded-xl">
        <div className="text-cvat-muted text-xs">이미지 없음</div>
      </div>
    )
  }

  const slide = slides[current]

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden bg-black">
      {/* Image */}
      <img
        key={slide.id}
        src={`/api/public/image/${slide.id}`}
        alt={slide.filename}
        onLoad={() => setLoaded(true)}
        className="w-full h-full object-cover transition-opacity duration-500"
        style={{ opacity: loaded ? 1 : 0 }}
      />

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none" />
    </div>
  )
}

/* ── Main Login Page ── */
export default function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.login(username, password)
      login(res.access_token, res.user)
      navigate('/projects')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen bg-cvat-bg flex overflow-hidden">

      {/* ── Left 70% ── */}
      <div className="w-[70%] flex flex-col justify-center px-16 py-5 relative overflow-hidden border-r border-cvat-border">
        <div className="absolute inset-0 bg-gradient-to-br from-cvat-gold/6 via-transparent to-transparent pointer-events-none" />

        <div className="relative z-10">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 bg-cvat-gold rounded-xl flex items-center justify-center text-black font-black text-base shadow-lg shadow-cvat-gold/20">EV</div>
            <div>
              <div className="text-lg font-bold text-cvat-text tracking-tight">EV Annotator</div>
              <div className="text-cvat-muted text-xs">YOLO + SAM2 자동 어노테이션 플랫폼</div>
            </div>
          </div>

          {/* Headline — 한 줄 */}
          <h1 className="text-5xl font-bold text-white leading-none mb-6 whitespace-nowrap">
            Elevator <span className="text-cvat-gold">Auto</span> Labeling
          </h1>

          {/* Pipeline flow */}
          <div className="flex items-center gap-2 mb-5">
            {[
              { icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>, label: '이미지\n업로드' },
              { icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" strokeWidth={1.5}/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01"/></svg>, label: 'YOLO\n탐지' },
              { icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" strokeWidth={1.5}/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.343 6.343a8 8 0 000 11.314M17.657 6.343a8 8 0 010 11.314"/></svg>, label: 'SAM2\n분할' },
              { icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>, label: '라벨\n추출' },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-20 h-20 bg-cvat-panel border border-cvat-border rounded-xl flex flex-col items-center justify-center gap-1.5 text-cvat-gold hover:border-cvat-gold/50 transition-colors">
                  {step.icon}
                  <span className="text-[10px] text-cvat-text font-medium text-center leading-tight whitespace-pre-line">{step.label}</span>
                </div>
                {i < 3 && <svg className="w-4 h-4 text-cvat-gold/40 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>}
              </div>
            ))}
          </div>

          {/* Feature grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {/* Slideshow — spans 2 rows */}
            <div className="row-span-3" style={{ minHeight: 200 }}>
              <ImageSlideshow />
            </div>

            {/* Feature cards */}
            {[
              {
                icon: <svg className="w-4 h-4 text-cvat-gold shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>,
                title: '다중 클래스 지원',
                desc: '사람, 강아지 등 커스텀 클래스',
              },
              {
                icon: <svg className="w-4 h-4 text-cvat-gold shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>,
                title: '수동 보정 편집기',
                desc: 'AI 결과를 직접 드래그해 수정',
              },
              {
                icon: <svg className="w-4 h-4 text-cvat-gold shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>,
                title: 'COCO / YOLO 내보내기',
                desc: '학습 바로 사용 가능한 포맷',
              },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="bg-cvat-panel border border-cvat-border rounded-xl px-4 py-3 flex items-start gap-3">
                <div className="mt-0.5">{icon}</div>
                <div>
                  <div className="text-xs font-semibold text-cvat-text mb-0.5">{title}</div>
                  <div className="text-[10px] text-cvat-muted leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div className="flex gap-3">
            {[
              { value: 'YOLO11m', sub: '파인튜닝 모델' },
              { value: '5가지',   sub: '출력 포맷' },
              { value: 'SAM2',    sub: '인터랙티브 분할' },
            ].map(({ value, sub }) => (
              <div key={sub} className="flex-1 bg-cvat-panel border border-cvat-border rounded-xl px-4 py-3">
                <div className="text-xl font-bold text-cvat-gold">{value}</div>
                <div className="text-[10px] text-cvat-muted mt-0.5">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right 30% ── */}
      <div className="w-[30%] flex items-center justify-center bg-cvat-surface px-10">
        <div className="w-full">
          <h2 className="text-2xl font-bold text-cvat-text mb-1">로그인</h2>
          <p className="text-cvat-muted text-sm mb-8">계정에 로그인하여 어노테이션을 시작하세요</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs text-cvat-muted mb-1.5 font-medium">사용자명</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                required
                autoFocus
                className="w-full bg-cvat-bg border border-cvat-border rounded-lg px-4 py-3 text-sm text-cvat-text
                           placeholder-cvat-muted/40 focus:outline-none focus:border-cvat-gold focus:ring-1 focus:ring-cvat-gold/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-cvat-muted mb-1.5 font-medium">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-cvat-bg border border-cvat-border rounded-lg px-4 py-3 text-sm text-cvat-text
                           placeholder-cvat-muted/40 focus:outline-none focus:border-cvat-gold focus:ring-1 focus:ring-cvat-gold/30 transition-colors"
              />
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-2.5 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-cvat-gold hover:bg-cvat-gold-h disabled:opacity-50 text-black font-bold
                         rounded-lg py-3 text-sm transition-colors flex items-center justify-center gap-2"
            >
              {loading
                ? <><span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />로그인 중...</>
                : '로그인'}
            </button>
          </form>
        </div>
      </div>

    </div>
  )
}
