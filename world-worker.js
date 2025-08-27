// world-worker.js

// World generation constants (duplicated for worker)
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;
const WATER_LEVEL = 28;

const BlockTypes = {
  AIR: 0,
  DIRT: 1,
  GRASS: 2,
  SAND: 3,
  LOG: 4,
  LEAVES: 5,
  WATER: 6
};

// ... (Keep the Noise class exactly as it is) ...
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

// --- TREE GENERATION LOGIC ---

// Helper to set a block in the 1D array, with bounds checking
function setBlock(blocks, x, y, z, blockType) {
    if (x >= 0 && x < CHUNK_SIZE && y >= 0 && y < CHUNK_HEIGHT && z >= 0 && z < CHUNK_SIZE) {
        const idx = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
        // Only place leaves in the air to avoid burying trees
        if (blockType === BlockTypes.LEAVES && blocks[idx] !== BlockTypes.AIR) {
            return;
        }
        blocks[idx] = blockType;
    }
}

// Helper to find the ground level at a specific X, Z
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

    // Generate trunk
    for (let y = 1; y <= treeHeight; y++) {
        setBlock(blocks, x, groundY + y, z, BlockTypes.LOG);
    }

    // Generate a more organic, blob-like canopy
    const canopyCenterY = groundY + treeHeight;
    const canopyRadius = 2.5 + Math.random() * 0.5;

    for (let ly = -3; ly <= 3; ly++) {
        for (let lx = -3; lx <= 3; lx++) {
            for (let lz = -3; lz <= 3; lz++) {
                const dist = Math.sqrt(lx * lx + ly * ly + lz * lz);
                // Create a slightly randomized spherical shape
                if (dist < canopyRadius && Math.random() > 0.1) {
                    // Don't replace the top of the trunk with leaves
                    if (lx === 0 && lz === 0 && ly >= 0) continue;
                    setBlock(blocks, x + lx, canopyCenterY + ly, z + lz, BlockTypes.LEAVES);
                }
            }
        }
    }
}

// --- MODIFIED: PINE TREE FUNCTION REMOVED ---

function generateTrees(blocks, chunkX, chunkZ) {
    const worldX = chunkX * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE;
    
    // Increase attempts per chunk for a better chance of spawning
    for (let i = 0; i < 8; i++) {
        const x = Math.floor(Math.random() * 14) + 1; // Keep a 1-block border
        const z = Math.floor(Math.random() * 14) + 1;
        
        const wx = worldX + x;
        const wz = worldZ + z;
        
        // Use noise to create natural-feeling forest patches
        const treeNoise = noise.noise2D(wx * 0.1, wz * 0.1);
        
        if (treeNoise > 0.4) { // Adjusted threshold
            const groundY = findGroundLevel(blocks, x, z);
            if (groundY === -1) continue;

            // --- MODIFIED: Always generate an Oak tree now ---
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
        const height1 = noise.noise2D(wx * 0.01, wz * 0.01) * 20;
        const height2 = noise.noise2D(wx * 0.05, wz * 0.05) * 5;
        const height = Math.floor(35 + height1 + height2);
        
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const idx = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
          
          if (y < height - 3) {
            blocks[idx] = BlockTypes.DIRT;
          } else if (y < height) {
            if (height <= WATER_LEVEL + 2) {
              blocks[idx] = BlockTypes.SAND;
            } else {
              blocks[idx] = BlockTypes.DIRT;
            }
          } else if (y === height) {
            if (y > WATER_LEVEL) {
              if (y <= WATER_LEVEL + 2) {
                blocks[idx] = BlockTypes.SAND;
              } else {
                blocks[idx] = BlockTypes.GRASS;
              }
            } else {
              blocks[idx] = BlockTypes.SAND;
            }
          } else if (y <= WATER_LEVEL) {
            blocks[idx] = BlockTypes.WATER;
          } else {
            blocks[idx] = BlockTypes.AIR;
          }
        }
      }
    }
    
    // Generate trees using the updated system
    generateTrees(blocks, chunkX, chunkZ);
    
    postMessage({ cmd: 'chunk', chunkX, chunkZ, blocks }, [blocks.buffer]);
  }
};