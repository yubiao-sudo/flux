import type { Turn } from './types';

export const clock = (offsetMinutes = 0) => {
  const date = new Date(Date.now() + offsetMinutes * 60_000);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
};

export const seedTurns = (): Turn[] => [
  {
    id: 'seed-1',
    role: 'agent',
    text: '晚上好。雨正在穿过城市，我把灯光调低了一点。',
    at: Date.now() - 1000 * 60 * 7,
  },
  {
    id: 'seed-2',
    role: 'user',
    text: '今晚适合出门吗？',
    at: Date.now() - 1000 * 60 * 6,
  },
  {
    id: 'seed-3',
    role: 'agent',
    text: '九点四十前可以。之后有一阵急雨，我建议把目的地换到室内。',
    at: Date.now() - 1000 * 60 * 5,
  },
  {
    id: 'seed-4',
    role: 'agent',
    text: '明天九点，「北屿」的会面还没有确认。需要我替你起草一封简短的确认信吗？',
    at: Date.now() - 1000 * 60 * 4,
  },
  {
    id: 'seed-5',
    role: 'user',
    text: '先不用回信。把会面推迟十分钟吧。',
    at: Date.now() - 1000 * 60 * 3,
  },
  {
    id: 'seed-6',
    role: 'agent',
    text: '好。九点十分。我在日历里留了四十分钟的缓冲。',
    at: Date.now() - 1000 * 60 * 2,
  },
];

export const demoScript = {
  requestA: '帮我看看今晚的天气，再把明天的日程调出来。',
  replyA: '会有一阵急雨。21:40 开始，持续约四十分钟。',
  replyB: '明天九点，「北屿」的会面；十一点，材料评审。两个都还没有最终确认。',
  requestB: '再帮我打开那篇关于磁流体的长文。',
  replyC: '找到了。《The Shape of Thought》，六分钟阅读。',
  closing: '我把它们收回来了。需要时，叫我的名字。',
};

