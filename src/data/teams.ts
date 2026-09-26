import type { TeamDef } from '../engine/types';

/** Names and primary colours only — no logos. */
export const IPL_TEAMS: TeamDef[] = [
  { code: 'CSK', name: 'Chennai Super Kings', color: '#F9CD05' },
  { code: 'MI', name: 'Mumbai Indians', color: '#004BA0' },
  { code: 'RCB', name: 'Royal Challengers Bengaluru', color: '#C8102E' },
  { code: 'KKR', name: 'Kolkata Knight Riders', color: '#3A225D' },
  { code: 'DC', name: 'Delhi Capitals', color: '#17479E' },
  { code: 'PBKS', name: 'Punjab Kings', color: '#ED1B24' },
  { code: 'RR', name: 'Rajasthan Royals', color: '#EA1A85' },
  { code: 'SRH', name: 'Sunrisers Hyderabad', color: '#F26522' },
  { code: 'GT', name: 'Gujarat Titans', color: '#1B2133' },
  { code: 'LSG', name: 'Lucknow Super Giants', color: '#2ABFE9' },
];

/** Black or white text, whichever reads better on the given background. */
export function inkFor(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1d1b17' : '#ffffff';
}
