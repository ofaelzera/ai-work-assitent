'use client'

import { toast } from 'sonner'
import { isDesktop, saveBlobNative } from '@/lib/desktop'

/**
 * Salva um blob como arquivo para o usuário.
 * - Navegador: âncora com atributo `download` (comportamento padrão).
 * - App desktop (Tauri): envia ao shell nativo, que grava em ~/Downloads e
 *   revela no Finder/Explorer — o WKWebView não suporta `<a download>` com blob.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  if (isDesktop()) {
    const path = await saveBlobNative(blob, filename)
    if (path) {
      toast.success(`Arquivo salvo em Downloads`)
      return
    }
    toast.error('Não foi possível salvar o arquivo')
    return
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
