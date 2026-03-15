import { Server } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@blast-arena/shared';
import { RoomManager } from './RoomManager';

type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

let roomManager: RoomManager | null = null;
let io: TypedServer | null = null;

export function setRegistry(rm: RoomManager, ioServer: TypedServer): void {
  roomManager = rm;
  io = ioServer;
}

export function getRoomManager(): RoomManager {
  if (!roomManager) throw new Error('RoomManager not initialized');
  return roomManager;
}

export function getIO(): TypedServer {
  if (!io) throw new Error('Socket.io server not initialized');
  return io;
}
