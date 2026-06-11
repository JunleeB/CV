import { create } from 'zustand'
import type { Annotation, Label } from '../api/client'

export type Tool = 'select' | 'rect' | 'polygon' | 'sam_point' | 'sam_box'

interface AnnotationState {
  annotations: (Annotation & { _key: string })[]
  selectedId: string | null
  tool: Tool
  labels: Label[]
  activeLabelId: number | null
  samPoints: { x: number; y: number; label: number }[]
  pendingPolygon: number[] | null  // normalized polygon from SAM preview

  setAnnotations: (items: Annotation[]) => void
  addAnnotation: (a: Omit<Annotation, 'id'>) => void
  updateAnnotation: (key: string, polygon: number[]) => void
  changeAnnotationLabel: (key: string, labelId: number) => void
  removeAnnotation: (key: string) => void
  setSelected: (key: string | null) => void
  setTool: (t: Tool) => void
  setLabels: (l: Label[]) => void
  setActiveLabel: (id: number | null) => void
  addSamPoint: (x: number, y: number, label: number) => void
  clearSamPoints: () => void
  setPendingPolygon: (p: number[] | null) => void
  acceptPending: () => void
  toSaveItems: () => Omit<Annotation, 'id'>[]
}

let _keyCounter = 0
const nextKey = () => `ann_${++_keyCounter}`

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  annotations: [],
  selectedId: null,
  tool: 'select',
  labels: [],
  activeLabelId: null,
  samPoints: [],
  pendingPolygon: null,

  setAnnotations: (items) =>
    set({ annotations: items.map((a) => ({ ...a, _key: nextKey() })), selectedId: null }),

  addAnnotation: (a) =>
    set((s) => ({ annotations: [...s.annotations, { ...a, id: 0, _key: nextKey() }] })),

  updateAnnotation: (key, polygon) =>
    set((s) => ({
      annotations: s.annotations.map((a) => (a._key === key ? { ...a, polygon } : a)),
    })),

  changeAnnotationLabel: (key, labelId) =>
    set((s) => ({
      annotations: s.annotations.map((a) => (a._key === key ? { ...a, label_id: labelId } : a)),
    })),

  removeAnnotation: (key) =>
    set((s) => ({ annotations: s.annotations.filter((a) => a._key !== key), selectedId: null })),

  setSelected: (key) => set({ selectedId: key }),
  setTool: (t) => set({ tool: t, samPoints: [], pendingPolygon: null }),
  setLabels: (l) => set({ labels: l }),
  setActiveLabel: (id) => set({ activeLabelId: id }),
  addSamPoint: (x, y, label) => set((s) => ({ samPoints: [...s.samPoints, { x, y, label }] })),
  clearSamPoints: () => set({ samPoints: [], pendingPolygon: null }),
  setPendingPolygon: (p) => set({ pendingPolygon: p }),

  acceptPending: () => {
    const { pendingPolygon, activeLabelId, labels } = get()
    if (!pendingPolygon) return
    const labelId = activeLabelId ?? labels[0]?.id ?? 1
    set((s) => ({
      annotations: [...s.annotations, { id: 0, _key: nextKey(), label_id: labelId, polygon: pendingPolygon, is_auto: false, needs_review: false }],
      pendingPolygon: null,
      samPoints: [],
    }))
  },

  toSaveItems: () =>
    get().annotations.map(({ _key: _, ...a }) => ({
      label_id: a.label_id,
      polygon: a.polygon,
      confidence: a.confidence,
      is_auto: a.is_auto,
      needs_review: a.needs_review,
    })),
}))
