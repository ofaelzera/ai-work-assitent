'use client'

import { useCallback, useEffect, useState } from 'react'
import Cropper, { Area } from 'react-easy-crop'
import { X, ZoomIn, ZoomOut, RotateCcw, Check } from 'lucide-react'

interface ImageCropModalProps {
  /** Imagem original (data URL ou URL) */
  imageSrc: string
  /** Proporção do recorte: largura/altura. Ex: 4 (4:1), 1 (quadrado). */
  aspect: number
  /** Largura final do output (canvas). Altura = output / aspect. */
  outputWidth: number
  /** Título do modal */
  title?: string
  /** Cor de fundo do preview (pra logos transparentes vc ver como ficará no app) */
  previewBg?: 'light' | 'dark'
  onConfirm: (croppedDataUrl: string) => void
  onCancel: () => void
}

/**
 * Modal de recorte com zoom/pan/rotação usando react-easy-crop.
 *
 * Pra logo: aspect=4 (horizontal), outputWidth=600 → 600×150 px.
 * Pra favicon: aspect=1 (quadrado), outputWidth=128 → 128×128 px.
 */
export function ImageCropModal({
  imageSrc,
  aspect,
  outputWidth,
  title = 'Ajustar imagem',
  previewBg = 'dark',
  onConfirm,
  onCancel,
}: ImageCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [processing, setProcessing] = useState(false)

  // Fecha com Esc
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels)
  }, [])

  const handleConfirm = async () => {
    if (!croppedAreaPixels) return
    setProcessing(true)
    try {
      const dataUrl = await renderCrop(imageSrc, croppedAreaPixels, rotation, outputWidth, aspect)
      onConfirm(dataUrl)
    } finally {
      setProcessing(false)
    }
  }

  const reset = () => {
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setRotation(0)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl modal-surface rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Cropper area */}
        <div
          className="relative flex-1 min-h-[400px]"
          style={{ backgroundColor: previewBg === 'dark' ? '#0a0a0f' : '#ffffff' }}
        >
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
            objectFit="contain"
            restrictPosition={false}
            showGrid
          />
        </div>

        {/* Controles */}
        <div className="px-5 py-3 border-t space-y-3">
          <div className="flex items-center gap-3">
            <ZoomOut className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="flex-1 accent-primary"
            />
            <ZoomIn className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
              {Math.round(zoom * 100)}%
            </span>
          </div>

          <div className="flex items-center gap-3">
            <RotateCcw className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={rotation}
              onChange={(e) => setRotation(parseFloat(e.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
              {rotation}°
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={reset}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Resetar ajustes
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border bg-background px-4 py-2 text-sm hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={processing || !croppedAreaPixels}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {processing ? 'Processando...' : 'Aplicar recorte'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── helpers internos ────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * Renderiza o recorte (com rotação) num canvas e retorna data URL PNG.
 * Algoritmo adaptado dos exemplos oficiais do react-easy-crop.
 */
async function renderCrop(
  imageSrc: string,
  pixelCrop: Area,
  rotation: number,
  outputWidth: number,
  aspect: number,
): Promise<string> {
  const img = await loadImage(imageSrc)
  const radians = (rotation * Math.PI) / 180

  // Bounding box da imagem rotacionada
  const rotW = Math.abs(Math.cos(radians) * img.width) + Math.abs(Math.sin(radians) * img.height)
  const rotH = Math.abs(Math.sin(radians) * img.width) + Math.abs(Math.cos(radians) * img.height)

  // Canvas grande pra desenhar a imagem rotacionada inteira
  const offCanvas = document.createElement('canvas')
  offCanvas.width = rotW
  offCanvas.height = rotH
  const offCtx = offCanvas.getContext('2d')
  if (!offCtx) throw new Error('Sem contexto 2D')
  offCtx.translate(rotW / 2, rotH / 2)
  offCtx.rotate(radians)
  offCtx.drawImage(img, -img.width / 2, -img.height / 2)

  // Canvas final no tamanho do output
  const outputHeight = Math.round(outputWidth / aspect)
  const finalCanvas = document.createElement('canvas')
  finalCanvas.width = outputWidth
  finalCanvas.height = outputHeight
  const finalCtx = finalCanvas.getContext('2d')
  if (!finalCtx) throw new Error('Sem contexto 2D')
  finalCtx.imageSmoothingEnabled = true
  finalCtx.imageSmoothingQuality = 'high'
  finalCtx.drawImage(
    offCanvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputWidth,
    outputHeight,
  )

  return finalCanvas.toDataURL('image/png')
}
