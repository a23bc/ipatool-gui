/**
 * Notification copy shared by the main process (OS notifications) and any
 * future renderer use.
 *
 * Pure on purpose: extracting this from `main/ipc.ts` and `main/queue.ts`
 * (which carried two identical copies) makes the notification body unit
 * testable without mocking Electron.
 */

import type { QueueItem } from './types'

export interface NotificationCopy {
  title: string
  body: string
}

/** Title + body for the OS notification raised when a queue item settles. */
export function notificationCopy(item: QueueItem, locale: string): NotificationCopy {
  const zh = locale.startsWith('zh')
  if (item.state === 'done') {
    return {
      title: zh ? '下载完成' : 'Download complete',
      body: zh ? `${item.name} 已下载完成` : `${item.name} finished downloading`
    }
  }
  const detail = item.error?.message ?? (zh ? '未知错误' : 'unknown error')
  return {
    title: zh ? '下载失败' : 'Download failed',
    body: zh ? `${item.name} 失败：${detail}` : `${item.name} failed: ${detail}`
  }
}

/** Body text for the OS notification raised when a queue item settles. */
export function notificationBody(item: QueueItem): string {
  return notificationCopy(item, 'en').body
}
