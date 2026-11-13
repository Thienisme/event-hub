import { formatPrice } from './format';

export interface Offer {
  code: string;
  discountType: 'PERCENT' | 'FIXED';
  discountValue: string;
  endsAt: string | null;
  remainingUses: number | null;
}

export function offerLabel(offer: Offer): string {
  const value = Number(offer.discountValue);
  return `Giảm ${offer.discountType === 'PERCENT' ? `${value}%` : value >= 1000 && value % 1000 === 0 ? `${value / 1000}K` : formatPrice(value)}`;
}

export function offerMeta(offer: Offer): string {
  const parts: string[] = [];
  if (offer.endsAt) {
    const end = new Date(offer.endsAt);
    if (!Number.isNaN(end.getTime())) {
      const date = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
      parts.push(date.format(end) === date.format(new Date()) ? 'Hết hạn hôm nay' : `HSD ${date.format(end).slice(0, 5)}`);
    }
  }
  if (offer.remainingUses !== null && offer.remainingUses <= 20) parts.push(`Còn ${offer.remainingUses} lượt`);
  return parts.join(' · ');
}

export function bestOfferText(offers: Offer[]): string {
  const percent = offers.filter(offer => offer.discountType === 'PERCENT');
  const best = (percent.length ? percent : offers).reduce<Offer | undefined>((best, offer) =>
    !best || Number(offer.discountValue) > Number(best.discountValue) ? offer : best, undefined);
  return best ? `Giảm đến ${offerLabel(best).replace(/^Giảm /, '')}` : '';
}
