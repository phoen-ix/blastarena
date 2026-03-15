import { Server } from 'socket.io';
import {
  Room,
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@blast-arena/shared';
import { GameRoom } from './GameRoom';
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

  async createGame(room: Room): Promise<GameRoom> {
    const gameRoom = new GameRoom(this.io, room);
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

  cleanup(): void {
    for (const [code, room] of this.rooms) {
      if (!room.isRunning()) {
        this.rooms.delete(code);
      }
    }
  }
}
