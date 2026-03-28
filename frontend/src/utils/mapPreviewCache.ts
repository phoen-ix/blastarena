import { ApiClient } from '../network/ApiClient';
import type { TileType, CampaignLevel, CustomMap } from '@blast-arena/shared';

export interface MapTileData {
  tiles: TileType[][];
  mapWidth: number;
  mapHeight: number;
}

const campaignCache = new Map<number, MapTileData>();
const customMapCache = new Map<number, MapTileData>();
const inflight = new Map<string, Promise<MapTileData>>();

export async function getCampaignLevelTiles(levelId: number): Promise<MapTileData> {
  const cached = campaignCache.get(levelId);
  if (cached) return cached;

  const key = `campaign:${levelId}`;
  let pending = inflight.get(key);
  if (!pending) {
    pending = ApiClient.get<{ level: CampaignLevel }>(`/campaign/levels/${levelId}`).then(
      (resp) => {
        const data: MapTileData = {
          tiles: resp.level.tiles,
          mapWidth: resp.level.mapWidth,
          mapHeight: resp.level.mapHeight,
        };
        campaignCache.set(levelId, data);
        inflight.delete(key);
        return data;
      },
      (err) => {
        inflight.delete(key);
        throw err;
      },
    );
    inflight.set(key, pending);
  }
  return pending;
}

export async function getCustomMapTiles(mapId: number): Promise<MapTileData> {
  const cached = customMapCache.get(mapId);
  if (cached) return cached;

  const key = `map:${mapId}`;
  let pending = inflight.get(key);
  if (!pending) {
    pending = ApiClient.get<{ map: CustomMap }>(`/maps/${mapId}`).then(
      (resp) => {
        const data: MapTileData = {
          tiles: resp.map.tiles,
          mapWidth: resp.map.mapWidth,
          mapHeight: resp.map.mapHeight,
        };
        customMapCache.set(mapId, data);
        inflight.delete(key);
        return data;
      },
      (err) => {
        inflight.delete(key);
        throw err;
      },
    );
    inflight.set(key, pending);
  }
  return pending;
}
