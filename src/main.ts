import './classic/styles.css';
import { ClassicGame } from './classic/game/ClassicGame';
import { ClassicAudio } from './classic/audio/ClassicAudio';
import type { SimEvent } from './classic/core/types';

const container = document.querySelector<HTMLElement>('#game-root');
if (!container) throw new Error('找不到游戏容器 #game-root');

const audio = new ClassicAudio();

// AudioContext 必须在用户手势内解锁；capture 阶段保证先于游戏键盘处理执行
const unlockAudio = (): void => {
  audio.unlock();
  window.removeEventListener('keydown', unlockAudio, true);
  window.removeEventListener('pointerdown', unlockAudio, true);
};
window.addEventListener('keydown', unlockAudio, true);
window.addEventListener('pointerdown', unlockAudio, true);

const game = new ClassicGame({
  container,
  onEvents: (events: readonly SimEvent[]) => {
    audio.handleEvents(events);
    // stageClear/gameOver 事件本身不发声（音效层约定），在此触发对应 jingle
    for (const event of events) {
      if (event.type === 'stageClear') audio.playJingle('stageClear');
      else if (event.type === 'gameOver') audio.playJingle('gameOver');
    }
  },
  onStageStart: () => audio.playJingle('stageStart'),
});
game.start();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => { document.documentElement.dataset.offlineReady = 'true'; })
    .catch((error: unknown) => {
      document.documentElement.dataset.offlineReady = 'error';
      console.warn('[坦克大作战] 离线缓存不可用:', error);
    });
}
