// Validação de CPF (RF06) — compartilhada entre API e Web.

/** Remove tudo que não é dígito. CPF é sempre armazenado/comparado só com dígitos. */
export function normalizeCpf(raw: string): string {
  return (raw ?? '').replace(/\D/g, '')
}

/**
 * Valida um CPF pelo algoritmo dos dígitos verificadores.
 * Aceita CPF com ou sem máscara. Rejeita sequências repetidas (ex: 111.111.111-11).
 */
export function isValidCpf(raw: string): boolean {
  const cpf = normalizeCpf(raw)
  if (cpf.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false // todos os dígitos iguais

  const digits = cpf.split('').map(Number)

  const checkDigit = (length: number): number => {
    let sum = 0
    for (let i = 0; i < length; i++) {
      sum += digits[i] * (length + 1 - i)
    }
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }

  return checkDigit(9) === digits[9] && checkDigit(10) === digits[10]
}
