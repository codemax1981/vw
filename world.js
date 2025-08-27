// world.js

import { Noise, BlockTypes, chunkKey, worldToChunkCoords, CHUNK_SIZE, CHUNK_HEIGHT, WATER_LEVEL } from './utils.js';

class Chunk {
  constructor(x, z, world) {
    this.x = x;
    this.z = z;
    this.world = world;
    this.blocks = null;
    this.mesh = null;
    this.generated = false;
    this.generating = false;
  }

  getBlock(x, y, z) {
    if (!this.blocks || x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_SIZE) {
      return BlockTypes.AIR;
    }
    return this.blocks[y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x];
  }

  setBlock(x, y, z, type) {
    if (!this.blocks || x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_SIZE) {
      return;
    }
    this.blocks[y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x] = type;
  }

  setBlocks(blockData) {
    this.blocks = new Uint8Array(blockData);
    this.generated = true;
    this.generating = false;
  }

  // Keep the old generate method for fallback/initial load
  generate() {
    if (this.generated || !this.world.noise) return;
    
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    const worldX = this.x * CHUNK_SIZE;
    const worldZ = this.z * CHUNK_SIZE;
    
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = worldX + x;
        const wz = worldZ + z;
        const height1 = this.world.noise.noise2D(wx * 0.01, wz * 0.01) * 20;
        const height2 = this.world.noise.noise2D(wx * 0.05, wz * 0.05) * 5;
        const height = Math.floor(35 + height1 + height2);
        
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          if (y < height - 3) {
            this.setBlock(x, y, z, BlockTypes.DIRT);
          } else if (y < height) {
            if (height <= WATER_LEVEL + 2) this.setBlock(x, y, z, BlockTypes.SAND);
            else this.setBlock(x, y, z, BlockTypes.DIRT);
          } else if (y === height) {
            if (y > WATER_LEVEL) {
              if (y <= WATER_LEVEL + 2) this.setBlock(x, y, z, BlockTypes.SAND);
              else this.setBlock(x, y, z, BlockTypes.GRASS);
            } else {
              this.setBlock(x, y, z, BlockTypes.SAND);
            }
          } else if (y <= WATER_LEVEL) {
            this.setBlock(x, y, z, BlockTypes.WATER);
          }
        }
      }
    }
    this.generateTrees();
    this.generated = true;
  }

  generateTrees() {
    const worldX = this.x * CHUNK_SIZE;
    const worldZ = this.z * CHUNK_SIZE;
    for (let i = 0; i < 2; i++) {
      const x = Math.floor(Math.random() * 12) + 2;
      const z = Math.floor(Math.random() * 12) + 2;
      const wx = worldX + x;
      const wz = worldZ + z;
      const treeNoise = this.world.noise.noise2D(wx * 0.1, wz * 0.1);
      if (treeNoise > 0.3) this.generateTree(x, z);
    }
  }

  generateTree(x, z) {
    let groundY = -1;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      if (this.getBlock(x, y, z) === BlockTypes.GRASS) {
        groundY = y;
        break;
      }
    }
    if (groundY === -1) return;

    const treeHeight = 4 + Math.floor(Math.random() * 3);
    for (let y = 1; y <= treeHeight; y++) this.setBlock(x, groundY + y, z, BlockTypes.LOG);

    const leafTop = groundY + treeHeight;
    for (let ly = leafTop; ly <= leafTop + 2; ly++) {
      for (let lx = x - 2; lx <= x + 2; lx++) {
        for (let lz = z - 2; lz <= z + 2; lz++) {
          const dist = Math.abs(lx - x) + Math.abs(lz - z);
          if (dist <= 2 && !(lx === x && lz === z && ly > leafTop)) {
            if (this.getBlock(lx, ly, lz) === BlockTypes.AIR) {
              this.setBlock(lx, ly, lz, BlockTypes.LEAVES);
            }
          }
        }
      }
    }
  }
}

export class World {
  constructor(worker = null) {
    this.chunks = new Map();
    this.noise = new Noise(Math.random()); // Keep for fallback
    this.renderDistance = 6;
    this.worker = worker;
    this.pendingChunks = new Set();
  }

  setRenderDistance(distance) {
    this.renderDistance = Math.max(2, distance); // Enforce a minimum
  }
  onWorkerMessage(msg) {
    if (msg.cmd === 'chunk') {
      const key = chunkKey(msg.chunkX, msg.chunkZ);
      const chunk = this.chunks.get(key);
      if (chunk) {
        chunk.setBlocks(msg.blocks);
        this.pendingChunks.delete(key);
      }
    }
  }

  getChunk(x, z) {
    const key = chunkKey(x, z);
    if (!this.chunks.has(key)) {
      this.chunks.set(key, new Chunk(x, z, this));
    }
    
    const chunk = this.chunks.get(key);
    
    // Request generation from worker if available and not already generating
    if (this.worker && !chunk.generated && !chunk.generating && !this.pendingChunks.has(key)) {
      chunk.generating = true;
      this.pendingChunks.add(key);
      this.worker.postMessage({
        cmd: 'generateChunk',
        data: { chunkX: x, chunkZ: z }
      });
    }
    
    return chunk;
  }

  getBlock(worldX, worldY, worldZ) {
    if (worldY < 0 || worldY >= CHUNK_HEIGHT) return BlockTypes.AIR;
    
    const { x: chunkX, z: chunkZ } = worldToChunkCoords(worldX, worldZ);
    const chunk = this.getChunk(chunkX, chunkZ);
    
    // Fallback to synchronous generation if no worker or chunk not ready
    if (!chunk.generated && !this.worker) {
      chunk.generate();
    }
    
    const localX = Math.floor(worldX) - chunkX * CHUNK_SIZE;
    const localZ = Math.floor(worldZ) - chunkZ * CHUNK_SIZE;
    return chunk.getBlock(localX, worldY, localZ);
  }

  // Add this method to your World class in world.js
setBlock(worldX, worldY, worldZ, blockType) {
    if (worldY < 0 || worldY >= CHUNK_HEIGHT) return;
    
    const { x: chunkX, z: chunkZ } = worldToChunkCoords(worldX, worldZ);
    const chunk = this.getChunk(chunkX, chunkZ);
    
    if (!chunk.generated) return;
    
    const localX = Math.floor(worldX) - chunkX * CHUNK_SIZE;
    const localZ = Math.floor(worldZ) - chunkZ * CHUNK_SIZE;
    chunk.setBlock(localX, worldY, localZ, blockType);
  }
  

  updateLoadedChunks(playerX, playerZ) {
    const { x: playerChunkX, z: playerChunkZ } = worldToChunkCoords(playerX, playerZ);
    const loadedChunks = new Set();
    
    for (let x = playerChunkX - this.renderDistance; x <= playerChunkX + this.renderDistance; x++) {
      for (let z = playerChunkZ - this.renderDistance; z <= playerChunkZ + this.renderDistance; z++) {
        const key = chunkKey(x, z);
        loadedChunks.add(key);
        const chunk = this.getChunk(x, z);
        
        // Fallback generation for initial load without worker
        if (!chunk.generated && !this.worker) {
          chunk.generate();
        }
      }
    }

    // Cleanup chunks outside render distance
    for (const [key, chunk] of this.chunks) {
      if (!loadedChunks.has(key)) {
        if (chunk.mesh) {
          chunk.mesh.parent?.remove(chunk.mesh);
          chunk.mesh.children.forEach(child => {
            child.geometry?.dispose();
            child.material?.dispose();
          });
        }
        this.chunks.delete(key);
        this.pendingChunks.delete(key);
      }
    }

    return loadedChunks.size;
  }

  getLoadedChunks() {
    return Array.from(this.chunks.values()).filter(chunk => chunk.generated);
  }
}