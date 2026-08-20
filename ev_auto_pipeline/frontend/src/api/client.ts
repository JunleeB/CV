const BASE = ''  // proxied by vite to localhost:8000

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('access_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function xhrUpload<T = unknown>(
  url: string,
  formData: FormData,
  onProgress?: (pct: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const token = localStorage.getItem('access_token') ?? ''
    xhr.open('POST', BASE + url)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)) } catch { resolve(xhr.responseText as unknown as T) }
      } else {
        try { reject(new Error(JSON.parse(xhr.responseText).detail || `HTTP ${xhr.status}`)) }
        catch { reject(new Error(`HTTP ${xhr.status}`)) }
      }
    }
    xhr.onerror = () => reject(new Error('네트워크 오류'))
    xhr.send(formData)
  })
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) => {
    const form = new URLSearchParams({ username, password })
    return fetch('/api/auth/token', {
      method: 'POST',
      body: form,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).detail ?? 'Login failed')
      return r.json() as Promise<{ access_token: string; user: User }>
    })
  },
  me: () => req<User>('/api/auth/me'),
  createUser: (body: { username: string; password: string; display_name: string; role: string }) =>
    req('/api/auth/users', { method: 'POST', body: JSON.stringify(body) }),
  listUsers: () => req<User[]>('/api/auth/users'),
}

// ─── Projects ─────────────────────────────────────────────────────────────────
export const projectApi = {
  list: () => req<Project[]>('/api/projects'),
  get: (id: number) => req<Project>(`/api/projects/${id}`),
  create: (body: { name: string; labels: { name: string; color: string; class_index: number }[]; source_path?: string; conf_threshold?: number }) =>
    req<Project>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  delete: (id: number) => req(`/api/projects/${id}`, { method: 'DELETE' }),
  rename: (id: number, name: string) =>
    req(`/api/projects/${id}/name`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  updateRoi: (id: number, roi: number[] | null) =>
    req(`/api/projects/${id}/roi`, { method: 'PATCH', body: JSON.stringify({ roi }) }),
  setModel: (id: number, model_id: number | null) =>
    req(`/api/projects/${id}/model`, { method: 'PATCH', body: JSON.stringify({ model_id }) }),
  export: (id: number) => window.open(`/api/projects/${id}/export`),
  rescan: (id: number) => req(`/api/projects/${id}/rescan`, { method: 'POST' }),
  uploadZip: (id: number, file: File) => {
    const fd = new FormData(); fd.append('file', file)
    return fetch(`/api/projects/${id}/upload`, { method: 'POST', headers: authHeader(), body: fd }).then(r => r.json())
  },
  uploadImages: (id: number, files: File[], onProgress?: (pct: number) => void) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    return xhrUpload<{ uploaded: number }>(`/api/projects/${id}/upload-images`, fd, onProgress)
  },
  uploadVideo: (id: number, file: File, startTime: string, endTime: string, fps: number, onProgress?: (pct: number) => void) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('start_time', startTime)
    fd.append('end_time', endTime)
    fd.append('fps', String(fps))
    return xhrUpload<{ status: string; message: string }>(`/api/projects/${id}/upload-video`, fd, onProgress)
  },
  review: (id: number) => req<ImageItem[]>(`/api/projects/${id}/review`),
}

// ─── Images ───────────────────────────────────────────────────────────────────
export const imageApi = {
  list: (projectId: number, params?: { status?: string; page?: number; page_size?: number }) => {
    const q = new URLSearchParams(params as Record<string, string> ?? {})
    return req<{ items: ImageItem[]; total: number }>(`/api/projects/${projectId}/images?${q}`)
  },
  url: (imageId: number) => `/images/${imageId}/file`,
  thumbUrl: (imageId: number) => `/images/${imageId}/thumb`,
}

// ─── Annotations ──────────────────────────────────────────────────────────────
export const annotationApi = {
  get: (imageId: number) => req<Annotation[]>(`/api/images/${imageId}/annotations`),
  save: (imageId: number, items: Omit<Annotation, 'id'>[]) =>
    req<{ ok: boolean; status: string }>(`/api/images/${imageId}/annotations`, { method: 'PUT', body: JSON.stringify(items) }),
  setStatus: (imageId: number, status: string) =>
    req(`/api/images/${imageId}/status?status=${status}`, { method: 'PATCH' }),
  deleteAllForProject: (projectId: number) =>
    req(`/api/projects/${projectId}/annotations`, { method: 'DELETE' }),
  samBbox: (imageId: number, bbox: number[]) =>
    req<{ polygon: number[] }>(`/api/images/${imageId}/sam-bbox`, { method: 'POST', body: JSON.stringify({ bbox }) }),
  samPoints: (imageId: number, points: number[][], point_labels: number[]) =>
    req<{ polygon: number[] }>(`/api/images/${imageId}/sam-points`, { method: 'POST', body: JSON.stringify({ points, point_labels }) }),
}

// ─── Models ───────────────────────────────────────────────────────────────────
export const modelApi = {
  list: () => req<ModelVersion[]>('/api/models'),
  delete: (id: number) => req(`/api/models/${id}`, { method: 'DELETE' }),
  finetune: (body: { project_id: number; model_name: string; base_model_id?: number; replay_count?: number; epochs?: number; freeze?: number; task?: string }) =>
    req<{ job_id: string; new_image_count: number }>('/api/models/finetune', { method: 'POST', body: JSON.stringify(body) }),
  getFinetuneJob: (jobId: string) => req<FinetuneStatus>(`/api/models/finetune/${jobId}`),
}

// ─── Datasets ─────────────────────────────────────────────────────────────────
export const datasetApi = {
  list: () => req<DatasetSnapshot[]>('/api/datasets'),
  delete: (id: string) => req(`/api/datasets/${id}`, { method: 'DELETE' }),
  upload: async (file: File): Promise<{ id: string; image_count: number; label_names: string[] }> => {
    const token = localStorage.getItem('access_token') ?? ''
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/datasets/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || '업로드 실패')
    }
    return res.json()
  },
  finetuneFromDatasets: (body: { dataset_ids: string[]; model_name: string; base_model_id?: number; epochs: number; task: string }) =>
    req<{ job_id: string; total_images: number }>('/api/models/finetune-from-datasets', { method: 'POST', body: JSON.stringify(body) }),
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────
export const jobApi = {
  start: (projectId: number, conf_threshold?: number, force = false) =>
    req<{ job_id: string; total: number }>(`/api/projects/${projectId}/jobs`, { method: 'POST', body: JSON.stringify({ conf_threshold, force }) }),
  get: (jobId: string) => req<JobStatus>(`/api/jobs/${jobId}`),
}

// ─── Track ────────────────────────────────────────────────────────────────────
export const trackApi = {
  start: (projectId: number, imageId: number, maskMode = false) =>
    req<{ job_id: string | null; total?: number; message?: string }>(
      `/api/projects/${projectId}/track`,
      { method: 'POST', body: JSON.stringify({ image_id: imageId, mask_mode: maskMode }) }
    ),
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface User { id: number; username: string; display_name: string; role: string }
export interface Label { id: number; name: string; color: string; class_index: number }
export interface Project { id: number; name: string; source_path?: string; conf_threshold: number; roi?: number[] | null; model_id?: number | null; created_at: string; labels: Label[]; image_count?: number; annotated_count?: number; review_count?: number; owner?: string }
export interface ModelVersion { id: number; name: string; weights_path: string; description?: string; is_base: boolean; task: 'segment' | 'detect' | 'gdino'; created_at: string }
export interface FinetuneStatus { status: string; progress: number; total: number; model_id?: number | null; error?: string }
export interface ImageItem { id: number; filename: string; status: 'pending' | 'annotated' | 'review' | 'done'; project_id: number }
export interface Annotation { id: number; label_id: number; polygon: number[]; confidence?: number; is_auto: boolean; needs_review: boolean }
export interface JobStatus { status: string; progress: number; total: number; auto_count: number; review_count: number; error?: string }
export interface DatasetSnapshot { id: string; project_name: string; label_names: string[]; image_count: number; created_at: string; source?: string }
