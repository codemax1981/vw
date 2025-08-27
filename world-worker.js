// world-worker.js

// World generation constants (duplicated for worker)
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;
const WATER_LEVEL = 28;

// --- NEW: World Generation Parameters for easy tweaking ---
const BASE_HEIGHT = 32; // The average ground level

// Hill/Mountain settings
const TERRAIN_BASE_SCALE = 0.01; // Main terrain noise
const TERRAIN_DETAIL_SCALE = 0.05; // Finer details on the terrain
const HILL_SCALE = 0.005; // Very low frequency for large hills/mountains
const TERRAIN_BASE_AMPLITUDE = 20;
const TERRAIN_DETAIL_AMPLITUDE = 5;
const HILL_AMPLITUDE = 30; // Hills can be up to 30 blocks high

// River settings
const RIVER_SCALE = 0.004; // Frequency of the river noise
const RIVER_THRESHOLD = 0.025; // How wide the rivers are. Smaller = thinner rivers.
const RIVER_DEPTH = 6; // How deep the rivers carve into the terrain

const BlockTypes = {
  AIR: 0,
  DIRT: 1,
  GRASS: 2,
  SAND: 3,
  LOG: 4,
  LEAVES: 5,
  WATER: 6
};

// ... (The Noise class remains exactly the same) ...
class Noise {
  constructor(seed = Math.random()) {
    this.seed = seed;
    this.p = new Uint8Array(512);
    this.perm = this.generatePermutation();
    for (let i = 0; i < 512; i++) {
      this.p[i] = this.perm[i & 255];
    }
  }

  generatePermutation() {
    const p = Array.from({ length: 256 }, (_, i) => i);
    let rng = this.seed;
    for (let i = 255; i > 0; i--) {
      rng = (rng * 9301 + 49297) % 233280;
      const j = Math.floor((rng / 233280) * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    return [...p, ...p];
  }

  fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  lerp(a, b, t) { return a + t * (b - a); }
  grad(hash, x, y) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise2D(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = this.fade(x);
    const v = this.fade(y);
    const A = this.p[X] + Y;
    const B = this.p[X + 1] + Y;
    return this.lerp(
      this.lerp(this.grad(this.p[A], x, y), this.grad(this.p[B], x - 1, y), u),
      this.lerp(this.grad(this.p[A + 1], x, y - 1), this.grad(this.p[B + 1], x - 1, y - 1), u),
      v
    );
  }
}


let noise;

// --- TREE GENERATION LOGIC (Unchanged) ---

function setBlock(blocks, x, y, z, blockType) {
    if (x >= 0 && x < CHUNK_SIZE && y >= 0 && y < CHUNK_HEIGHT && z >= 0 && z < CHUNK_SIZE) {
        const idx = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
        if (blockType === BlockTypes.LEAVES && blocks[idx] !== BlockTypes.AIR) {
            return;
        }
        blocks[idx] = blockType;
    }
}

function findGroundLevel(blocks, x, z) {
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        const idx = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
        if (blocks[idx] === BlockTypes.GRASS) {
            return y;
        }
    }
    return -1;
}

function generateOakTree(blocks, x, z, groundY) {
    const treeHeight = 5 + Math.floor(Math.random() * 3);
    for (let y = 1; y <= treeHeight; y++) {
        setBlock(blocks, x, groundY + y, z, BlockTypes.LOG);
    }
    const canopyCenterY = groundY + treeHeight;
    const canopyRadius = 2.5 + Math.random() * 0.5;
    for (let ly = -3; ly <= 3; ly++) {
        for (let lx = -3; lx <= 3; lx++) {
            for (let lz = -3; lz <= 3; lz++) {
                const dist = Math.sqrt(lx * lx + ly * ly + lz * lz);
                if (dist < canopyRadius && Math.random() > 0.1) {
                    if (lx === 0 && lz === 0 && ly >= 0) continue;
                    setBlock(blocks, x + lx, canopyCenterY + ly, z + lz, BlockTypes.LEAVES);
                }
            }
        }
    }
}

function generateTrees(blocks, chunkX, chunkZ) {
    const worldX = chunkX * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE;
    for (let i = 0; i < 8; i++) {
        const x = Math.floor(Math.random() * 14) + 1;
        const z = Math.floor(Math.random() * 14) + 1;
        const wx = worldX + x;
        const wz = worldZ + z;
        const treeNoise = noise.noise2D(wx * 0.1, wz * 0.1);
        if (treeNoise > 0.4) {
            const groundY = findGroundLevel(blocks, x, z);
            if (groundY === -1) continue;
            generateOakTree(blocks, x, z, groundY);
        }
    }
}


onmessage = function(e) {
  const { cmd, data } = e.data;
  
  if (cmd === 'init') {
    noise = new Noise(data.seed);
    postMessage({ cmd: 'ready' });
  } else if (cmd === 'generateChunk') {
    const { chunkX, chunkZ } = data;
    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    
    const worldX = chunkX * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE;
    
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = worldX + x;
        const wz = worldZ + z;

        // --- TERRAIN HEIGHT CALCULATION (REWORKED) ---

        // 1. Base terrain and detail noise
        const baseNoise = noise.noise2D(wx * TERRAIN_BASE_SCALE, wz * TERRAIN_BASE_SCALE) * TERRAIN_BASE_AMPLITUDE;
        const detailNoise = noise.noise2D(wx * TERRAIN_DETAIL_SCALE, wz * TERRAIN_DETAIL_SCALE) * TERRAIN_DETAIL_AMPLITUDE;
        
        // 2. Large scale hill/mountain noise
        const hillNoise = noise.noise2D(wx * HILL_SCALE, wz * HILL_SCALE) * HILL_AMPLITUDE;
        
        let height = BASE_HEIGHT + baseNoise + detailNoise + hillNoise;

        // 3. River generation
        let isRiver = false;
        // Get a noise value and use its absolute value. The valleys where the value is close to 0 will be our rivers.
        const riverValue = Math.abs(noise.noise2D(wx * RIVER_SCALE, wz * RIVER_SCALE));
        
        if (riverValue < RIVER_THRESHOLD) {
          isRiver = true;
          // The closer to the center of the river (riverValue closer to 0), the deeper it is.
          const riverInfluence = (RIVER_THRESHOLD - riverValue) / RIVER_THRESHOLD;
          height -= riverInfluence * RIVER_DEPTH;
          // Make the river valley a bit wider and smoother
          height -= Math.pow(riverInfluence, 2) * 5;
        }

        height = Math.floor(height);
        
        // --- BLOCK PLACEMENT LOGIC (UPDATED) ---
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const idx = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
          
          if (y < height - 3) {
            blocks[idx] = BlockTypes.DIRT; // Deep underground is dirt
          } else if (y < height) {
            // Near the surface, could be sand or dirt
            if (isRiver && height <= WATER_LEVEL + 2) {
                blocks[idx] = BlockTypes.SAND; // Sandy riverbeds
            } else {
                blocks[idx] = BlockTypes.DIRT;
            }
          } else if (y === height) {
            // This is the surface block
            if (y > WATER_LEVEL) {
              if (y <= WATER_LEVEL + 2 || (isRiver && y <= WATER_LEVEL + 4)) {
                blocks[idx] = BlockTypes.SAND; // Beaches and riverbanks
              } else {
                blocks[idx] = BlockTypes.GRASS; // Default grass
              }
            } else {
              blocks[idx] = BlockTypes.SAND; // Ground below water level is sand
            }
          } else if (y <= WATER_LEVEL) {
            blocks[idx] = BlockTypes.WATER; // Fill up to water level
          } else {
            blocks[idx] = BlockTypes.AIR; // Anything above is air
          }
        }
      }
    }
    
    // Generate trees after the main terrain is set
    generateTrees(blocks, chunkX, chunkZ);
    
    postMessage({ cmd: 'chunk', chunkX, chunkZ, blocks }, [blocks.buffer]);
  }
};
