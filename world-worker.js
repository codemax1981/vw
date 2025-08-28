// world-worker.js

// World generation constants
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;
const WATER_LEVEL = 28;

// --- MINECRAFT BETA STYLE PARAMETERS ---
const BASE_HEIGHT = 32;
const HEIGHT_VARIATION = 20;
const TERRAIN_SCALE = 0.02;
const TERRAIN_SCALE_2 = 0.04;
const DETAIL_SCALE = 0.08;
const DETAIL_AMPLITUDE = 3;

// Tree generation parameters
const TREE_DENSITY = 0.02;
const TREE_NOISE_SCALE = 0.1;
const TREE_THRESHOLD = 0.4;

const BlockTypes = {
  AIR: 0,
  DIRT: 1,
  GRASS: 2,
  SAND: 3,
  LOG: 4,
  LEAVES: 5,
  WATER: 6,
  STONE: 7,
  GRAVEL: 8,
  COAL_ORE: 9,
  BEDROCK: 10
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

// --- HELPER FUNCTIONS ---
function setBlock(blocks, x, y, z, blockType) {
    if (x >= 0 && x < CHUNK_SIZE && y >= 0 && y < CHUNK_HEIGHT && z >= 0 && z < CHUNK_SIZE) {
        const idx = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
        // Don't overwrite existing solid blocks with leaves
        if (blockType === BlockTypes.LEAVES && blocks[idx] !== BlockTypes.AIR) {
            return;
        }
        blocks[idx] = blockType;
    }
}

function getBlock(blocks, x, y, z) {
    if (x >= 0 && x < CHUNK_SIZE && y >= 0 && y < CHUNK_HEIGHT && z >= 0 && z < CHUNK_SIZE) {
        const idx = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
        return blocks[idx];
    }
    return BlockTypes.AIR;
}

// --- MINECRAFT BETA TERRAIN GENERATION ---
function generateMinecraftBetaTerrain(blocks, chunkX, chunkZ) {
    const worldX = chunkX * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE;
    
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = worldX + x;
            const wz = worldZ + z;
            
            // Primary height map - large scale terrain features
            const heightNoise1 = noise.noise2D(wx * TERRAIN_SCALE, wz * TERRAIN_SCALE);
            
            // Secondary height map - medium scale variation
            const heightNoise2 = noise.noise2D(wx * TERRAIN_SCALE_2, wz * TERRAIN_SCALE_2) * 0.5;
            
            // Combine height maps
            const combinedHeight = (heightNoise1 + heightNoise2) * HEIGHT_VARIATION;
            
            // Add fine details
            const detail = noise.noise2D(wx * DETAIL_SCALE, wz * DETAIL_SCALE) * DETAIL_AMPLITUDE;
            
            // Calculate final surface height
            let surfaceHeight = Math.floor(BASE_HEIGHT + combinedHeight + detail);
            
            // Clamp height to reasonable bounds
            surfaceHeight = Math.max(5, Math.min(CHUNK_HEIGHT - 5, surfaceHeight));
            
            // Generate the column of blocks
            generateColumn(blocks, x, z, surfaceHeight, wx, wz);
        }
    }
}

function generateColumn(blocks, x, z, surfaceHeight, worldX, worldZ) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
        const idx = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
        
        if (y === 0) {
            // Bedrock bottom layer
            blocks[idx] = BlockTypes.BEDROCK;
        } else if (y < surfaceHeight - 4) {
            // Deep stone layer with occasional coal
            blocks[idx] = BlockTypes.STONE;
            
            // Surface coal deposits - more likely higher up
            if (y > surfaceHeight - 12 && y < surfaceHeight - 2) {
                const coalNoise = noise.noise2D(worldX * 0.1 + y * 0.2, worldZ * 0.1 + y * 0.2);
                if (coalNoise > 0.6) {
                    blocks[idx] = BlockTypes.COAL_ORE;
                }
            }
        } else if (y < surfaceHeight - 1) {
            // Dirt layer (typically 2-3 blocks thick)
            blocks[idx] = BlockTypes.DIRT;
        } else if (y === surfaceHeight) {
            // Surface block determination - only place solid blocks above water level
            if (surfaceHeight > WATER_LEVEL) {
                if (surfaceHeight <= WATER_LEVEL + 3) {
                    // Beach area - primarily sand with some gravel
                    const beachNoise = noise.noise2D(worldX * 0.15, worldZ * 0.15);
                    blocks[idx] = beachNoise > 0.0 ? BlockTypes.SAND : BlockTypes.GRAVEL;
                } else {
                    // Normal grass surface
                    blocks[idx] = BlockTypes.GRASS;
                }
            } else {
                // Underground surface - place appropriate block
                if (surfaceHeight < WATER_LEVEL - 2) {
                    blocks[idx] = BlockTypes.SAND; // Deep underwater
                } else {
                    const beachNoise = noise.noise2D(worldX * 0.2, worldZ * 0.2);
                    blocks[idx] = beachNoise > 0.2 ? BlockTypes.SAND : BlockTypes.GRAVEL;
                }
            }
        } else if (y <= WATER_LEVEL) {
            // Fill with water up to water level (only if no solid block placed)
            blocks[idx] = BlockTypes.WATER;
        } else {
            // Above surface and water level - air
            blocks[idx] = BlockTypes.AIR;
        }
    }
}

// --- TREE GENERATION ---
function findGroundLevel(blocks, x, z) {
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        const blockType = getBlock(blocks, x, y, z);
        if (blockType === BlockTypes.GRASS || blockType === BlockTypes.DIRT) {
            return y;
        }
    }
    return -1;
}

function generateOakTree(blocks, x, z, groundY) {
    const treeHeight = 4 + Math.floor(Math.random() * 3); // 4-6 blocks tall
    
    // Generate trunk
    for (let y = 1; y <= treeHeight; y++) {
        setBlock(blocks, x, groundY + y, z, BlockTypes.LOG);
    }
    
    // Generate canopy
    const canopyCenterY = groundY + treeHeight;
    const canopyRadius = 2 + Math.random() * 0.5;
    
    for (let ly = -2; ly <= 2; ly++) {
        for (let lx = -2; lx <= 2; lx++) {
            for (let lz = -2; lz <= 2; lz++) {
                const dist = Math.sqrt(lx * lx + ly * ly + lz * lz);
                
                // Skip the trunk center for upper layers
                if (lx === 0 && lz === 0 && ly >= 0) continue;
                
                // Generate leaves with some randomness for natural look
                if (dist <= canopyRadius && Math.random() > 0.15) {
                    setBlock(blocks, x + lx, canopyCenterY + ly, z + lz, BlockTypes.LEAVES);
                }
            }
        }
    }
}

function generateTrees(blocks, chunkX, chunkZ) {
    const worldX = chunkX * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE;
    
    // Try to place several trees per chunk
    const treeAttempts = 8;
    
    for (let i = 0; i < treeAttempts; i++) {
        // Random position within chunk (avoid edges for full trees)
        const x = 2 + Math.floor(Math.random() * 12);
        const z = 2 + Math.floor(Math.random() * 12);
        
        const wx = worldX + x;
        const wz = worldZ + z;
        
        // Use noise to determine if tree should spawn here
        const treeNoise = noise.noise2D(wx * TREE_NOISE_SCALE, wz * TREE_NOISE_SCALE);
        
        if (treeNoise > TREE_THRESHOLD) {
            const groundY = findGroundLevel(blocks, x, z);
            
            // Only place trees on grass blocks above water level
            if (groundY > WATER_LEVEL && getBlock(blocks, x, groundY, z) === BlockTypes.GRASS) {
                generateOakTree(blocks, x, z, groundY);
            }
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
    
    // Initialize chunk with all air blocks
    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    blocks.fill(BlockTypes.AIR);
    
    // Generate basic terrain
    generateMinecraftBetaTerrain(blocks, chunkX, chunkZ);
    
    // Add trees
    generateTrees(blocks, chunkX, chunkZ);
    
    // Send the completed chunk back to main thread
    postMessage({ 
      cmd: 'chunk', 
      chunkX, 
      chunkZ, 
      blocks 
    }, [blocks.buffer]);
  }
};