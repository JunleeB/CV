import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { authApi } from './api/client'
import { useAuthStore } from './store/useAuthStore'
import LoginPage from './pages/LoginPage'
import ProjectsPage from './pages/ProjectsPage'
import AnnotatorPage from './pages/AnnotatorPage'
import AdminPage from './pages/AdminPage'
import TrainingPage from './pages/TrainingPage'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, user, login, logout } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (!token) return
    if (!user) {
      authApi.me().then((u) => login(token, u)).catch(() => { logout(); navigate('/') })
    }
  }, [token])

  if (!token) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/projects" element={<AuthGuard><ProjectsPage /></AuthGuard>} />
        <Route path="/projects/:projectId" element={<AuthGuard><AnnotatorPage /></AuthGuard>} />
        <Route path="/training" element={<AuthGuard><TrainingPage /></AuthGuard>} />
        <Route path="/admin" element={<AuthGuard><AdminPage /></AuthGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
