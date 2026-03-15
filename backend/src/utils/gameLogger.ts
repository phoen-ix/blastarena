import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = process.env.GAME_LOG_DIR || '/app/gamelogs';

export class GameLogger {
  private stream: fs.WriteStream;
  private roomCode: string;
  private filename: string;

  constructor(roomCode: string, gameMode: string, playerCount: number) {
    this.roomCode = roomCode;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    this.filename = `${ts}_${roomCode}_${gameMode}_${playerCount}p.jsonl`;

    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    this.stream = fs.createWriteStream(path.join(LOG_DIR, this.filename), { flags: 'a' });

    this.log('game_init', { roomCode, gameMode, playerCount });
  }

  log(event: string, data: any): void {
    const entry = { t: Date.now(), event, ...data };
    this.stream.write(JSON.stringify(entry) + '\n');
  }

  logTick(tick: number, players: any[], bombs: any[], explosions: any[]): void {
    this.stream.write(JSON.stringify({
      t: Date.now(),
      event: 'tick',
      tick,
      players: players.map(p => ({
        id: p.id, name: p.username, pos: p.position,
        alive: p.alive, kills: p.kills, selfKills: p.selfKills,
        dir: p.direction, shield: p.hasShield, kick: p.hasKick,
        fireRange: p.fireRange, speed: p.speed, cooldown: p.moveCooldown,
      })),
      bombs: bombs.map(b => ({
        id: b.id.slice(0, 8), pos: b.position, owner: b.ownerId,
        fuse: b.ticksRemaining, slide: b.sliding,
      })),
      explosions: explosions.map(e => ({
        id: e.id.slice(0, 8), owner: e.ownerId, fuse: e.ticksRemaining,
        cells: e.cells.length,
      })),
    }) + '\n');
  }

  logBotDecision(botId: number, botName: string, decision: string, details?: any): void {
    this.stream.write(JSON.stringify({
      t: Date.now(), event: 'bot_decision',
      botId, botName, decision, ...details,
    }) + '\n');
  }

  logKill(killerId: number, killerName: string, victimId: number, victimName: string, selfKill: boolean): void {
    this.stream.write(JSON.stringify({
      t: Date.now(), event: 'kill',
      killerId, killerName, victimId, victimName, selfKill,
    }) + '\n');
  }

  logBomb(event: 'place' | 'detonate', ownerId: number, ownerName: string, pos: any, fireRange?: number): void {
    this.stream.write(JSON.stringify({
      t: Date.now(), event: `bomb_${event}`,
      ownerId, ownerName, pos, fireRange,
    }) + '\n');
  }

  logGameOver(winnerId: number | null, placements: any[]): void {
    this.log('game_over', { winnerId, placements });
    this.stream.end();
  }

  close(): void {
    this.stream.end();
  }
}
