import type { InstagramWebhookBody, InstagramMessageEvent } from '@/app/lib/types';
import { messageService } from './messageService';

export const webhookHandler = {
  async handle(body: InstagramWebhookBody): Promise<void> {
    const businessAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

    for (const entry of body.entry) {
      if (!entry.messaging) continue;

      for (const event of entry.messaging) {
        // 자기 자신이 보낸 메시지 무시 (무한 루프 방지)
        if (event.sender.id === businessAccountId) {
          continue;
        }

        // 텍스트 메시지만 처리
        if (event.message) {
          await this.handleMessage(event);
        }
      }
    }
  },

  async handleMessage(event: InstagramMessageEvent): Promise<void> {
    try {
      await messageService.handleMessage(event);
    } catch (error) {
      console.error('[WebhookHandler] Message handling error:', {
        senderId: event.sender.id,
        error,
      });
    }
  },
};
