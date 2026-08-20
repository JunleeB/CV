import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi, modelApi, type User, type ModelVersion } from '../api/client'
import { useAuthStore } from '../store/useAuthStore'

export default function AdminPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const [users, setUsers] = useState<User[]>([])
  const [models, setModels] = useState<ModelVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    if (user?.role !== 'admin') { navigate('/projects'); return }
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [u, m] = await Promise.all([authApi.listUsers(), modelApi.list()])
      setUsers(u)
      setModels(m)
    } finally { setLoading(false) }
  }

  async function handleDeleteModel(m: ModelVersion) {
    if (!confirm(`"${m.name}" 모델을 삭제하시겠습니까?\n가중치 파일도 함께 삭제됩니다.`)) return
    setDeletingId(m.id)
    try {
      await modelApi.delete(m.id)
      setModels(prev => prev.filter(x => x.id !== m.id))
      showMsg(`${m.name} 삭제됨`)
    } catch (err: any) {
      showMsg(err.message || '삭제 실패', false)
    } finally { setDeletingId(null) }
  }

  function showMsg(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col overflow-y-auto">
      {/* Navbar */}
      <nav className="h-12 bg-white border-b border-gray-200 flex items-center px-6 gap-4 shrink-0 shadow-sm">
        <button onClick={() => navigate('/')} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 bg-cvat-gold rounded flex items-center justify-center text-black font-bold text-xs">EV</div>
          <span className="text-gray-800 font-bold text-sm">EV Annotator</span>
        </button>
        <span className="text-gray-300">|</span>
        <button onClick={() => navigate('/projects')} className="text-gray-500 hover:text-gray-800 text-sm transition-colors">Projects</button>
        <span className="text-gray-900 font-semibold text-sm border-b-2 border-blue-600 pb-0.5">사용자 관리</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-gray-500 text-sm">{user?.display_name}</span>
          <span className="bg-cvat-gold/20 text-cvat-gold border border-cvat-gold/30 text-xs px-2 py-0.5 rounded font-medium">Admin</span>
          <button onClick={() => { logout(); navigate('/') }} className="text-gray-500 hover:text-gray-800 text-sm">로그아웃</button>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">사용자 관리</h1>
            <p className="text-gray-500 text-sm mt-0.5">{users.length}명 등록됨</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
            사용자 추가
          </button>
        </div>

        {/* User table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3 text-gray-500 font-medium">사용자명</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">표시 이름</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">역할</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={3} className="text-center py-8 text-gray-400">불러오는 중...</td></tr>
              ) : users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5 font-mono text-gray-800">{u.username}</td>
                  <td className="px-5 py-3.5 text-gray-700">{u.display_name}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      u.role === 'admin'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      {u.role === 'admin' ? 'Admin' : 'Annotator'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Model management */}
        <div className="mt-10">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">모델 관리</h1>
              <p className="text-gray-500 text-sm mt-0.5">{models.length}개 등록됨</p>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-5 py-3 text-gray-500 font-medium">ID</th>
                  <th className="text-left px-5 py-3 text-gray-500 font-medium">모델명</th>
                  <th className="text-left px-5 py-3 text-gray-500 font-medium">태스크</th>
                  <th className="text-left px-5 py-3 text-gray-500 font-medium">가중치 경로</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-8 text-gray-400">불러오는 중...</td></tr>
                ) : models.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5 text-gray-400 text-xs font-mono">{m.id}</td>
                    <td className="px-5 py-3.5 text-gray-800 font-medium">
                      {m.name}
                      {m.is_base && <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">기본</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">{m.task}</span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-400 text-xs font-mono truncate max-w-[260px]" title={m.weights_path}>
                      {m.weights_path}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {!m.is_base && (
                        <button
                          onClick={() => handleDeleteModel(m)}
                          disabled={deletingId === m.id}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 disabled:opacity-40 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 hover:border-red-300 transition-colors"
                        >
                          {deletingId === m.id ? '삭제 중...' : '삭제'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreate={async (body) => {
            try {
              await authApi.createUser(body)
              showMsg(`${body.display_name} 계정이 생성됐습니다.`)
              setShowCreate(false)
              load()
            } catch (err: any) {
              showMsg(err.message, false)
            }
          }}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl border ${
          toast.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function CreateUserModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (body: { username: string; password: string; display_name: string; role: string }) => Promise<void>
}) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('annotator')
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (!username.trim() || !password.trim() || !displayName.trim()) return
    setLoading(true)
    try {
      await onCreate({ username: username.trim(), password, display_name: displayName.trim(), role })
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl w-[420px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">새 사용자 추가</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">사용자명 (로그인 ID) *</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="예: user01" autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 font-mono focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">표시 이름 *</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="예: 홍길동"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">비밀번호 *</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8자 이상"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">역할</label>
            <div className="flex gap-3">
              {[
                { value: 'annotator', label: 'Annotator', desc: '프로젝트 작업' },
                { value: 'admin', label: 'Admin', desc: '전체 관리' },
              ].map((r) => (
                <button
                  key={r.value}
                  onClick={() => setRole(r.value)}
                  className={`flex-1 border rounded-lg px-3 py-2.5 text-left transition-colors ${
                    role === r.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`text-sm font-medium ${role === r.value ? 'text-blue-700' : 'text-gray-800'}`}>{r.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{r.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200">
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-sm px-4 py-2">취소</button>
          <button onClick={submit} disabled={loading || !username.trim() || !password.trim() || !displayName.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm px-5 py-2 rounded-lg transition-colors">
            {loading ? '생성 중...' : '계정 생성'}
          </button>
        </div>
      </div>
    </div>
  )
}
