// world-worker.js

// World generation constants (duplicated for worker)
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;
const WATER_LEVEL = 28;

// --- ADVANCED WORLD GENERATION PARAMETERS ---

// Biome settings
const BIOME_SCALE = 0.003; // How large biomes are. Smaller number = larger biomes.
const PLAINS_HEIGHT = 29;
const HILLS_HEIGHT = 38;
const MOUNTAIN_HEIGHT = 55;

// Terrain detail settings
const TERRAIN_DETAIL_SCALE = 0.05; // Controls the small bumps and details on the surface.
const TERRAIN_DETAIL_AMPLITUDE = 4;
const MOUNTAIN_RUGGEDNESS_SCALE = 0.02; // Extra noise for mountains to make them jagged.
const MOUNTAIN_RUGGEDNESS_AMPLITUDE = 10;

// Lake settings
const LAKE_SCALE = 0.008; // How large lakes are.
const LAKE_THRESHOLD = 0.6; // 0.0 to 1.0. Higher = fewer, smaller lakes.
const LAKE_DEPTH = 15; // Maximum depth of lakes.

const BlockTypes = {
  AIR: 0,
  DIRT: 1,
  GRASS: 2,
  SAND: 3,
  LOG: 4,
  LEAVES: 5,
  WATER: 6
};

// --- Perlin Noise Generator (2D only) ---
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

// --- HELPER FUNCTION ---
function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

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


// --- WORKER MESSAGE HANDLER ---
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
    
    // --- TERRAIN GENERATION PASS ---
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = worldX + x;
        const wz = worldZ + z;

        // Step 1: Determine biome characteristics
        const biomeNoise = (noise.noise2D(wx * BIOME_SCALE, wz * BIOME_SCALE) + 1) / 2; // 0-1
        
        // Blend between plains and hills
        const plainsToHills = smoothstep(0.3, 0.5, biomeNoise);
        let baseHeight = noise.lerp(PLAINS_HEIGHT, HILLS_HEIGHT, plainsToHills);
        
        // Blend between hills and mountains
        const hillsToMountains = smoothstep(0.6, 0.8, biomeNoise);
        baseHeight = noise.lerp(baseHeight, MOUNTAIN_HEIGHT, hillsToMountains);

        // Step 2: Add terrain details and ruggedness
        let detailNoise = noise.noise2D(wx * TERRAIN_DETAIL_SCALE, wz * TERRAIN_DETAIL_SCALE) * TERRAIN_DETAIL_AMPLITUDE;
        let ruggedness = noise.noise2D(wx * MOUNTAIN_RUGGEDNESS_SCALE, wz * MOUNTAIN_RUGGEDNESS_SCALE) * MOUNTAIN_RUGGEDNESS_AMPLITUDE * hillsToMountains;
        
        let surfaceHeight = baseHeight + detailNoise + ruggedness;

        // Step 3: Carve lakes
        const lakeNoise = (noise.noise2D(wx * LAKE_SCALE, wz * LAKE_SCALE) + 1) / 2; // 0-1
        if (lakeNoise > LAKE_THRESHOLD) {
            const lakeInfluence = (lakeNoise - LAKE_THRESHOLD) / (1.0 - LAKE_THRESHOLD);
            surfaceHeight -= lakeInfluence * LAKE_DEPTH;
        }

        surfaceHeight = Math.floor(surfaceHeight);

        // Step 4: Place initial blocks (dirt, grass, sand, water)
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const idx = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
          
          if (y < surfaceHeight - 3) {
            blocks[idx] = BlockTypes.DIRT;
          } else if (y < surfaceHeight) {
            blocks[idx] = BlockTypes.DIRT;
          } else if (y === surfaceHeight) {
            if (y < WATER_LEVEL) {
              blocks[idx] = BlockTypes.SAND; // Lakebeds
            } else if (y <= WATER_LEVEL + 2) {
              blocks[idx] = BlockTypes.SAND; // Beaches
            } else if (y > MOUNTAIN_HEIGHT - 5) {
              blocks[idx] = BlockTypes.DIRT; // Rocky mountain peaks
            } else {
              blocks[idx] = BlockTypes.GRASS;
            }
          } else if (y <= WATER_LEVEL) {
            blocks[idx] = BlockTypes.WATER;
          } else {
            blocks[idx] = BlockTypes.AIR;
          }
        }
      }
    }
    
    // --- FINAL PASS: TREES ---
    generateTrees(blocks, chunkX, chunkZ);
    
    postMessage({ cmd: 'chunk', chunkX, chunkZ, blocks }, [blocks.buffer]);
  }
};