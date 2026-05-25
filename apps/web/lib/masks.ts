export const maskPhone = (value: string): string => {
  if (!value) return ''
  let v = value.replace(/\D/g, '')
  
  // Se for um ID interno longo, não formata
  if (v.length >= 15) return v

  // Se começar com 55, mascara como DDI Brasil: +55 (11) 99999-9999
  if (v.startsWith('55') && v.length > 2) {
    if (v.length <= 4) return `+55 (${v.slice(2)}`
    if (v.length <= 8) return `+55 (${v.slice(2, 4)}) ${v.slice(4)}`
    if (v.length <= 12) return `+55 (${v.slice(2, 4)}) ${v.slice(4, 8)}-${v.slice(8)}`
    return `+55 (${v.slice(2, 4)}) ${v.slice(4, 9)}-${v.slice(9, 13)}`
  }

  // Se não começa com 55, assume celular/fixo normal (sem DDI)
  if (v.length <= 2) return v
  if (v.length <= 6) return `(${v.slice(0, 2)}) ${v.slice(2)}`
  if (v.length <= 10) return `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`
  return `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7, 11)}`
}

export const maskCNPJ = (value: string): string => {
  if (!value) return ''
  let v = value.replace(/\D/g, '')
  if (v.length > 14) v = v.slice(0, 14)
  
  if (v.length <= 2) return v
  if (v.length <= 5) return `${v.slice(0, 2)}.${v.slice(2)}`
  if (v.length <= 8) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5)}`
  if (v.length <= 12) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8)}`
  return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`
}

export const maskCPF = (value: string): string => {
  if (!value) return ''
  let v = value.replace(/\D/g, '')
  if (v.length > 11) v = v.slice(0, 11)
  
  if (v.length <= 3) return v
  if (v.length <= 6) return `${v.slice(0, 3)}.${v.slice(3)}`
  if (v.length <= 9) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6)}`
  return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`
}

export const maskCPFCNPJ = (value: string): string => {
  if (!value) return ''
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 11) return maskCPF(digits)
  return maskCNPJ(digits)
}
