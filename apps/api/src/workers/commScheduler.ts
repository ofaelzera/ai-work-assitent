import { logger } from '../lib/logger.js'
import { sweepScheduledMessages } from '../modules/communication/communication.service.js'
import { sweepScheduledCampaigns, campaignDispatchQueue } from '../modules/communication/campaigns.service.js'

const SWEEP_INTERVAL_MS = 30_000 // 30s

/**
 * Scheduler da Central de Comunicação. Em vez de jobs BullMQ com `delay` (que
 * ficam presos no horário antigo quando uma campanha/mensagem é reagendada e não
 * sobrevivem bem a quedas), uma varredura periódica lê `scheduledAt` do banco e
 * dispara o que já venceu. Itens atrasados (servidor estava fora) disparam na
 * primeira varredura após o restart.
 */
export function startCommScheduler() {
  // Remove SÓ os jobs de campanha com delay deixados pela implementação antiga
  // (agendamento agora é por varredura). Não toca em jobs 'waiting' nem na fila
  // de mensagens (cujos delays são backoff de retry). Idempotência no worker já
  // evita envio em dobro caso algum job antigo escape.
  campaignDispatchQueue.clean(0, 1000, 'delayed').catch((err) =>
    logger.warn({ err: err?.message }, 'Falha ao limpar jobs de campanha atrasados (ignorado)'),
  )

  async function tick() {
    try {
      const [msgs, camps] = await Promise.all([sweepScheduledMessages(), sweepScheduledCampaigns()])
      if (msgs > 0 || camps > 0) {
        logger.info({ messages: msgs, campaigns: camps }, 'commScheduler: itens agendados disparados')
      }
    } catch (err: any) {
      logger.error({ err: err?.message }, 'commScheduler tick falhou')
    }
  }

  // Varredura inicial (pega atrasados após restart) + intervalo fixo
  void tick()
  const handle = setInterval(tick, SWEEP_INTERVAL_MS)
  logger.info('commScheduler iniciado (varredura a cada 30s)')
  return handle
}
