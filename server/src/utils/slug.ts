import { randomInt } from 'crypto';

export const createEventSlug = (title: string): string => {
  const base = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '') || 'su-kien';
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return `${base}-${Array.from({ length: 6 }, () => alphabet[randomInt(36)]).join('')}`;
};
