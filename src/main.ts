import './style.css';
import { Game } from './game';

const canvas = document.getElementById('world') as HTMLCanvasElement;
const game = new Game(canvas);
game.boot().catch((e) => {
  console.error(e);
  game.ui.loadingError(String(e?.message || e));
});
