import { Server } from 'socket.io';
import {
  Room,
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@blast-arena/shared';
import { GameRoom } from './GameRoom';
import { GameConfig } from './GameState';
import { logger } from '../utils/logger';

type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export class RoomManager {
  private rooms: Map<string, GameRoom> = new Map();
  private io: TypedServer;

  constructor(io: TypedServer) {
    this.io = io;
  }

  async createGame(room: Room, customMap?: GameConfig['customMap']): Promise<GameRoom> {
    const gameRoom = new GameRoom(this.io, room, customMap);
    this.rooms.set(room.code, gameRoom);
    await gameRoom.start();
    logger.info({ code: room.code, players: room.players.length }, 'Game room created and started');
    return gameRoom;
  }

  getRoom(code: string): GameRoom | undefined {
    return this.rooms.get(code);
  }

  removeRoom(code: string): void {
    const room = this.rooms.get(code);
    if (room) {
      room.stop();
      this.rooms.delete(code);
      logger.info({ code }, 'Game room removed');
    }
  }

  getActiveRoomCount(): number {
    return this.rooms.size;
  }

  getAllRooms(): GameRoom[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Reap rooms whose loop has stopped.
   *
   * This used to just drop them from the Map. A game that ends naturally stops its own loop, so
   * rooms whose clients never triggered room:restart/room:close were collected here — without
   * ever calling stop(), which is what releases the isolated custom bot AIs and closes the game
   * log stream. Every such room leaked its isolates and an open file descriptor for the lifetime
   * of the process. stop() is idempotent, so calling it on an already-stopped loop is safe.
   * (audit ROOM-REAP-1)
   */
  cleanup(): void {
    for (const [code, room] of this.rooms) {
      if (!room.isRunning()) {
        room.stop();
        this.rooms.delete(code);
      }
    }
  }
}
