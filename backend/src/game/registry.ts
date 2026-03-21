import { Server } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@blast-arena/shared';
import { RoomManager } from './RoomManager';
import { SimulationManager } from '../simulation/SimulationManager';
import { BotAIRegistry, getBotAIRegistry as _getBotAIRegistry } from '../services/botai-registry';
import {
  EnemyAIRegistry,
  getEnemyAIRegistry as _getEnemyAIRegistry,
} from '../services/enemyai-registry';
import { CampaignGameManager } from './CampaignGameManager';

type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

let roomManager: RoomManager | null = null;
let io: TypedServer | null = null;
let simulationManager: SimulationManager | null = null;
let campaignGameManager: CampaignGameManager | null = null;

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

export function getBotAIRegistry(): BotAIRegistry {
  return _getBotAIRegistry();
}

export function getEnemyAIRegistry(): EnemyAIRegistry {
  return _getEnemyAIRegistry();
}

export function getSimulationManager(): SimulationManager {
  if (!simulationManager) {
    simulationManager = new SimulationManager();
  }
  return simulationManager;
}

export function getCampaignGameManager(): CampaignGameManager {
  if (!campaignGameManager) {
    campaignGameManager = new CampaignGameManager();
  }
  return campaignGameManager;
}
