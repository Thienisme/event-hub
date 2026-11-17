import { defineStore } from 'pinia';
import apiClient from '../api/axios';

export type QueueStatus =
  | { state: 'NONE'; queueEnabled: boolean }
  | { state: 'WAITING'; position: number; ahead: number; total: number; estimatedWaitSeconds: number }
  | { state: 'ACTIVE'; expiresAt: string };

export const useQueueStore = defineStore('queue', () => {
  async function join(eventId: string): Promise<QueueStatus> {
    return (await apiClient.post<QueueStatus>(`/events/${encodeURIComponent(eventId)}/queue`)).data;
  }
  async function status(eventId: string): Promise<QueueStatus> {
    return (await apiClient.get<QueueStatus>(`/events/${encodeURIComponent(eventId)}/queue/me`)).data;
  }
  async function leave(eventId: string): Promise<QueueStatus> {
    return (await apiClient.delete<QueueStatus>(`/events/${encodeURIComponent(eventId)}/queue`)).data;
  }
  return { join, status, leave };
});
