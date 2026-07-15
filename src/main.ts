import './icons.css';
import './styles.css';
import { Game } from './core/Game';

// `?touch=1` is a deterministic QA/demo mode for desktop device emulation.
if (new URLSearchParams(location.search).get('touch') === '1') document.body.classList.add('force-touch');

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Game canvas was not found');

const game = new Game(canvas);
void game.init();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js'));
}
