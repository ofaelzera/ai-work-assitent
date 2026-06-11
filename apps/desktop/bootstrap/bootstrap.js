const { invoke } = window.__TAURI__.core

const form = document.getElementById('connect-form')
const input = document.getElementById('server-url')
const button = document.getElementById('connect-btn')
const errorEl = document.getElementById('error')

// Pré-preenche com a última URL salva (ex.: quando o usuário pede "Trocar servidor")
invoke('get_server_url')
  .then((url) => {
    if (url && !input.value) input.value = url
  })
  .catch(() => {})

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  errorEl.hidden = true
  button.disabled = true
  button.textContent = 'Conectando...'

  try {
    await invoke('connect_to_server', { url: input.value.trim() })
    // Sucesso: o backend Rust navega a janela para a URL do servidor.
  } catch (err) {
    errorEl.textContent = typeof err === 'string' ? err : 'Não foi possível conectar ao servidor.'
    errorEl.hidden = false
    button.disabled = false
    button.textContent = 'Conectar'
  }
})
