// world-worker.js

// World generation constants
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 256; // MODIFIED: Increased build height
const WATER_LEVEL = 62;   // MODIFIED: Raised sea level

// --- MINECRAFT BETA STYLE PARAMETERS ---
const BASE_HEIGHT = 70;         // MODIFIED: Raised base ground level
const HEIGHT_VARIATION = 30;    // MODIFIED: More dramatic hills
const TERRAIN_SCALE = 0.02;
const TERRAIN_SCALE_2 = 0.04;
const DETAIL_SCALE = 0.08;
const DETAIL_AMPLITUDE = 5;     // MODIFIED: Slightly more surface detail

// --- MOUNTAIN PARAMETERS ---
const MOUNTAIN_SCALE = 0.003; 
const MOUNTAIN_THRESHOLD = 0.5;
const MOUNTAIN_PEAK_SCALE = 0.015; 
const MOUNTAIN_MAX_HEIGHT = 120; // MODIFIED: Much taller mountains
const SNOW_LINE = 120;           // MODIFIED: Raised snow level for mountain peaks

// Tree generation parameters
const TREE_DENSITY = 0.02;
const TREE_NOISE_SCALE = 0.1;
const TREE_THRESHOLD = 0.4;

const BIOME_SCALE = 0.008;
const TEMPERATURE_SCALE = 0.005;
const MOISTURE_SCALE = 0.007;

const BiomeTypes = {
    PLAINS: 0,
    FOREST: 1,
    DESERT: 2,
    TUNDRA: 3,
    TAIGA: 4,
    SWAMP: 5
};

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
  BEDROCK: 10,
  SNOW: 11,
  ICE: 12,
  CACTUS: 13,
  DEAD_BUSH: 14,
  RED_SAND: 15,
  CLAY: 16,
  PODZOL: 17,
  SPRUCE_LOG: 18,
  SPRUCE_LEAVES: 19
};

const BlockColors = {
    [BlockTypes.DIRT]: 0x8B4513, [BlockTypes.GRASS]: 0x228B22, [BlockTypes.SAND]: 0xF4A460,
    [BlockTypes.LOG]: 0x654321, [BlockTypes.LEAVES]: 0x32CD32, [BlockTypes.WATER]: 0x4169E1,
    [BlockTypes.STONE]: 0x808080, [BlockTypes.GRAVEL]: 0x999999, [BlockTypes.COAL_ORE]: 0x2F2F2F,
    [BlockTypes.BEDROCK]: 0x1A1A1A,
    [BlockTypes.SNOW]: 0xFFFFFF,
    [BlockTypes.ICE]: 0xB0E0E6,
    [BlockTypes.CACTUS]: 0x228B22,
    [BlockTypes.DEAD_BUSH]: 0x8B4513,
    [BlockTypes.RED_SAND]: 0xCD853F,
    [BlockTypes.CLAY]: 0xA0522D,
    [BlockTypes.PODZOL]: 0x654321,
    [BlockTypes.SPRUCE_LOG]: 0x4A4A4A,
    [BlockTypes.SPRUCE_LEAVES]: 0x2F4F2F
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

function getBiome(worldX, worldZ) {
    const temp = noise.noise2D(worldX * TEMPERATURE_SCALE, worldZ * TEMPERATURE_SCALE);
    const moisture = noise.noise2D(worldX * MOISTURE_SCALE + 1000, worldZ * MOISTURE_SCALE + 1000);
    
    if (temp < -0.3) return BiomeTypes.TUNDRA;
    if (temp < -0.1 && moisture > 0) return BiomeTypes.TAIGA;
    if (temp > 0.4) return BiomeTypes.DESERT;
    if (moisture < -0.3) return BiomeTypes.PLAINS;
    if (moisture > 0.3) return BiomeTypes.SWAMP;
    return BiomeTypes.FOREST;
}

// --- MESHER LOGIC ---
// FIXED: Corrected face definitions - removed duplicate face
const FACES = [
    // Front face (positive Z)
    { dir: [0, 0, 1], corners: [ 
        { pos: [0, 0, 1], uv: [0, 0] }, 
        { pos: [1, 0, 1], uv: [1, 0] }, 
        { pos: [1, 1, 1], uv: [1, 1] }, 
        { pos: [0, 1, 1], uv: [0, 1] } 
    ] },
    // Back face (negative Z)
    { dir: [0, 0, -1], corners: [ 
        { pos: [1, 0, 0], uv: [0, 0] }, 
        { pos: [0, 0, 0], uv: [1, 0] }, 
        { pos: [0, 1, 0], uv: [1, 1] }, 
        { pos: [1, 1, 0], uv: [0, 1] } 
    ] },
    // Top face (positive Y)
    { dir: [0, 1, 0], corners: [ 
        { pos: [0, 1, 0], uv: [0, 1] }, 
        { pos: [0, 1, 1], uv: [0, 0] }, 
        { pos: [1, 1, 1], uv: [1, 0] }, 
        { pos: [1, 1, 0], uv: [1, 1] } 
    ] },
    // Bottom face (negative Y) - FIXED: Was previously overwritten by duplicate
    { dir: [0, -1, 0], corners: [ 
        { pos: [0, 0, 0], uv: [0, 0] }, 
        { pos: [1, 0, 0], uv: [1, 0] }, 
        { pos: [1, 0, 1], uv: [1, 1] }, 
        { pos: [0, 0, 1], uv: [0, 1] } 
    ] },
    // Right face (positive X)
    { dir: [1, 0, 0], corners: [ 
        { pos: [1, 0, 1], uv: [0, 0] }, 
        { pos: [1, 0, 0], uv: [1, 0] }, 
        { pos: [1, 1, 0], uv: [1, 1] }, 
        { pos: [1, 1, 1], uv: [0, 1] } 
    ] },
    // Left face (negative X)
    { dir: [-1, 0, 0], corners: [ 
        { pos: [0, 0, 0], uv: [0, 0] }, 
        { pos: [0, 0, 1], uv: [1, 0] }, 
        { pos: [0, 1, 1], uv: [1, 1] }, 
        { pos: [0, 1, 0], uv: [0, 1] } 
    ] }
];

const AO_SHADING = [0.5, 0.7, 0.85, 1.0];
const WATER_SURFACE_Y_OFFSET = -0.15;

function getBlockFromNeighborData(x, y, z, chunkData, neighborData) {
    if (y < 0 || y >= CHUNK_HEIGHT) return BlockTypes.AIR;

    let data = chunkData;
    let lx = x, lz = z;

    if (x < 0) {
        data = neighborData.west;
        lx = x + CHUNK_SIZE;
    } else if (x >= CHUNK_SIZE) {
        data = neighborData.east;
        lx = x - CHUNK_SIZE;
    } else if (z < 0) {
        data = neighborData.south;
        lz = z + CHUNK_SIZE;
    } else if (z >= CHUNK_SIZE) {
        data = neighborData.north;
        lz = z - CHUNK_SIZE;
    }
    
    if (!data) return BlockTypes.AIR;
    return data[y * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx];
}

function isBlockSolidForAO(x, y, z, chunkData, neighborData) {
    const block = getBlockFromNeighborData(x, y, z, chunkData, neighborData);
    return block !== BlockTypes.AIR && block !== BlockTypes.WATER && block !== BlockTypes.LEAVES;
}

function getAmbientOcclusion(x, y, z, cornerPos, chunkData, neighborData) {
    const neighbors = [];
    for (let i = 0; i < 3; i++) {
        if (cornerPos[i] === 0) {
            const n = [0, 0, 0]; n[i] = -1; neighbors.push(n);
        } else {
            const n = [0, 0, 0]; n[i] = 1; neighbors.push(n);
        }
    }
    
    const side1 = isBlockSolidForAO(x + neighbors[0][0], y + neighbors[0][1], z + neighbors[0][2], chunkData, neighborData);
    const side2 = isBlockSolidForAO(x + neighbors[1][0], y + neighbors[1][1], z + neighbors[1][2], chunkData, neighborData);
    const corner = isBlockSolidForAO(x + neighbors[0][0] + neighbors[1][0], y + neighbors[0][1] + neighbors[1][1], z + neighbors[0][2] + neighbors[1][2], chunkData, neighborData);

    if (side1 && side2) return 3;
    return (side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0);
}

function generateGeometryData(chunkData, neighborData, isTransparentPass) {
    const vertices = [], colors = [], indices = [];
    let vertexIndex = 0;

    for (let y = 0; y < CHUNK_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            for (let x = 0; x < CHUNK_SIZE; x++) {
                const blockType = getBlockFromNeighborData(x, y, z, chunkData, neighborData);
                if (blockType === BlockTypes.AIR) continue;
                
                const isTransparent = (blockType === BlockTypes.WATER);
                if (isTransparent !== isTransparentPass) continue;

                for (let i = 0; i < FACES.length; i++) {
                    const face = FACES[i];
                    const nx = x + face.dir[0];
                    const ny = y + face.dir[1];
                    const nz = z + face.dir[2];
                    const neighborBlock = getBlockFromNeighborData(nx, ny, nz, chunkData, neighborData);
                    
                    let isVisible = false;
                    if (blockType === BlockTypes.WATER) {
                        isVisible = neighborBlock === BlockTypes.AIR;
                    } else {
                        isVisible = neighborBlock === BlockTypes.AIR || neighborBlock === BlockTypes.WATER;
                    }

                    if (isVisible) {
                        const faceAOs = [];
                        let yOffset = 0;
                        if (blockType === BlockTypes.WATER) {
                            const blockAbove = getBlockFromNeighborData(x, y + 1, z, chunkData, neighborData);
                            if (blockAbove === BlockTypes.AIR && i === 2) { // Top face
                                yOffset = WATER_SURFACE_Y_OFFSET;
                            }
                        }
                        
                        for (const corner of face.corners) {
                            vertices.push(x + corner.pos[0], y + corner.pos[1] + yOffset, z + corner.pos[2]);
                            
                            const ao = getAmbientOcclusion(x, y, z, corner.pos, chunkData, neighborData);
                            faceAOs.push(ao);

                            const baseColorHex = BlockColors[blockType] || 0xFFFFFF;
                            let r = ((baseColorHex >> 16) & 255) / 255;
                            let g = ((baseColorHex >> 8) & 255) / 255;
                            let b = (baseColorHex & 255) / 255;

                            let shade = 1.0;
                            if (i === 2) shade = 1.0; // Top
                            else if (i === 3) shade = 0.6; // Bottom
                            else shade = 0.8; // Sides
                            
                            shade *= AO_SHADING[3 - ao];
                            
                            colors.push(r * shade, g * shade, b * shade);
                        }
                        
                        if (faceAOs[0] + faceAOs[2] > faceAOs[1] + faceAOs[3]) {
                            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 3, vertexIndex + 1, vertexIndex + 2, vertexIndex + 3);
                        } else {
                            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
                        }
                        vertexIndex += 4;
                    }
                }
            }
        }
    }
    return { 
        vertices: new Float32Array(vertices), 
        colors: new Float32Array(colors), 
        indices: new Uint32Array(indices) 
    };
}

// --- HELPER FUNCTIONS ---
function setBlock(blocks, x, y, z, blockType) {
    if (x >= 0 && x < CHUNK_SIZE && y >= 0 && y < CHUNK_HEIGHT && z >= 0 && z < CHUNK_SIZE) {
        const idx = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
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
            
            // --- Base Terrain ---
            const heightNoise1 = noise.noise2D(wx * TERRAIN_SCALE, wz * TERRAIN_SCALE);
            const heightNoise2 = noise.noise2D(wx * TERRAIN_SCALE_2, wz * TERRAIN_SCALE_2) * 0.5;
            const combinedHeight = (heightNoise1 + heightNoise2) * HEIGHT_VARIATION;
            const detail = noise.noise2D(wx * DETAIL_SCALE, wz * DETAIL_SCALE) * DETAIL_AMPLITUDE;
            let surfaceHeight = BASE_HEIGHT + combinedHeight + detail;
            
            // --- Mountain Generation ---
            let mountainInfluence = 0;
            const mountainNoise = noise.noise2D(wx * MOUNTAIN_SCALE, wz * MOUNTAIN_SCALE);
            if (mountainNoise > MOUNTAIN_THRESHOLD) {
                const rawInfluence = (mountainNoise - MOUNTAIN_THRESHOLD) / (1.0 - MOUNTAIN_THRESHOLD);
                mountainInfluence = rawInfluence * rawInfluence * (3.0 - 2.0 * rawInfluence);

                const mountainShape = (noise.noise2D(wx * MOUNTAIN_PEAK_SCALE, wz * MOUNTAIN_PEAK_SCALE) + 1) / 2;
                const additionalHeight = mountainInfluence * MOUNTAIN_MAX_HEIGHT * mountainShape;
                surfaceHeight += additionalHeight;
            }

            surfaceHeight = Math.floor(Math.max(5, Math.min(CHUNK_HEIGHT - 2, surfaceHeight)));
            
            generateColumn(blocks, x, z, surfaceHeight, wx, wz, mountainInfluence);
        }
    }
}

function generateColumn(blocks, x, z, surfaceHeight, worldX, worldZ, mountainInfluence = 0) {
    const biome = getBiome(worldX, worldZ);
    
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
        const idx = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
        
        if (y === 0) {
            blocks[idx] = BlockTypes.BEDROCK;
            continue;
        }

        if (y < surfaceHeight - 4) {
            blocks[idx] = BlockTypes.STONE;
            if (mountainInfluence < 0.2 && y > surfaceHeight - 12) {
                const coalNoise = noise.noise2D(worldX * 0.1 + y * 0.2, worldZ * 0.1 + y * 0.2);
                if (coalNoise > 0.6) {
                    blocks[idx] = BlockTypes.COAL_ORE;
                }
            }
        } else if (y < surfaceHeight) {
            if (mountainInfluence > 0.1) {
                blocks[idx] = BlockTypes.STONE;
            } else {
                switch (biome) {
                    case BiomeTypes.DESERT: blocks[idx] = BlockTypes.RED_SAND; break;
                    default: blocks[idx] = BlockTypes.DIRT;
                }
            }
        } else if (y === surfaceHeight) {
            if (surfaceHeight <= WATER_LEVEL) {
                 blocks[idx] = (biome === BiomeTypes.DESERT) ? BlockTypes.RED_SAND : BlockTypes.SAND;
            } else if (mountainInfluence > 0.1) {
                blocks[idx] = (surfaceHeight > SNOW_LINE) ? BlockTypes.SNOW : BlockTypes.STONE;
            } else {
                switch (biome) {
                    case BiomeTypes.DESERT: blocks[idx] = BlockTypes.RED_SAND; break;
                    case BiomeTypes.TUNDRA: blocks[idx] = BlockTypes.SNOW; break;
                    case BiomeTypes.TAIGA: blocks[idx] = BlockTypes.PODZOL; break;
                    case BiomeTypes.SWAMP: blocks[idx] = BlockTypes.CLAY; break;
                    default: blocks[idx] = BlockTypes.GRASS;
                }
            }
        } else if (y <= WATER_LEVEL) {
            blocks[idx] = (biome === BiomeTypes.TUNDRA && y === WATER_LEVEL) ? BlockTypes.ICE : BlockTypes.WATER;
        } else {
            blocks[idx] = BlockTypes.AIR;
        }
    }
}


// --- TREE GENERATION ---
function findGroundLevel(blocks, x, z) {
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        const blockType = getBlock(blocks, x, y, z);
        if (blockType === BlockTypes.GRASS || blockType === BlockTypes.DIRT || blockType === BlockTypes.PODZOL || blockType === BlockTypes.RED_SAND || blockType === BlockTypes.SNOW || blockType === BlockTypes.STONE) {
            return y;
        }
    }
    return -1;
}

function generateOakTree(blocks, x, z, groundY) {
    const treeHeight = 4 + Math.floor(Math.random() * 3);
    
    for (let y = 1; y <= treeHeight; y++) {
        const trunkY = groundY + y;
        if (trunkY >= 0 && trunkY < CHUNK_HEIGHT) {
            const idx = trunkY * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
            blocks[idx] = BlockTypes.LOG;
        }
    }
    
    const leafStartY = groundY + Math.max(2, treeHeight - 1);
    const leafEndY = groundY + treeHeight + 2;
    
    for (let ly = leafStartY; ly <= leafEndY; ly++) {
        if (ly < 0 || ly >= CHUNK_HEIGHT) continue;
        
        const layerFromTop = Math.abs(ly - (groundY + treeHeight));
        let maxRadius = layerFromTop <= 1 ? 2 : 1;
        
        for (let lx = x - maxRadius; lx <= x + maxRadius; lx++) {
            for (let lz = z - maxRadius; lz <= z + maxRadius; lz++) {
                if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
                
                const dx = Math.abs(lx - x);
                const dz = Math.abs(lz - z);
                const dist = Math.max(dx, dz);
                
                if (dist <= maxRadius && Math.random() > 0.3) {
                    const idx = ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
                    if (blocks[idx] === BlockTypes.AIR) {
                        blocks[idx] = BlockTypes.LEAVES;
                    }
                }
            }
        }
    }
}

function generateSpruceTree(blocks, x, z, groundY) {
    const treeHeight = 6 + Math.floor(Math.random() * 4);
    
    for (let y = 1; y <= treeHeight; y++) {
        const trunkY = groundY + y;
        if (trunkY >= 0 && trunkY < CHUNK_HEIGHT) {
            const idx = trunkY * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
            blocks[idx] = BlockTypes.SPRUCE_LOG;
        }
    }
    
    const leafLayers = 4;
    for (let layer = 0; layer < leafLayers; layer++) {
        const ly = groundY + treeHeight - layer;
        if (ly < 0 || ly >= CHUNK_HEIGHT) continue;
        
        const radius = Math.min(2, Math.floor(layer / 2) + 1);
        
        for (let lx = x - radius; lx <= x + radius; lx++) {
            for (let lz = z - radius; lz <= z + radius; lz++) {
                if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
                
                const dx = Math.abs(lx - x);
                const dz = Math.abs(lz - z);
                const manhattanDist = dx + dz;
                
                if (manhattanDist <= radius && Math.random() > 0.2) {
                    const idx = ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
                    if (blocks[idx] === BlockTypes.AIR) {
                        blocks[idx] = BlockTypes.SPRUCE_LEAVES;
                    }
                }
            }
        }
    }
    
    const topY = groundY + treeHeight + 1;
    if (topY >= 0 && topY < CHUNK_HEIGHT) {
        const topIdx = topY * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
        if (blocks[topIdx] === BlockTypes.AIR) {
            blocks[topIdx] = BlockTypes.SPRUCE_LEAVES;
        }
    }
}

function generateCactus(blocks, x, z, groundY) {
    const cactusHeight = 2 + Math.floor(Math.random() * 3);
    for (let y = 1; y <= cactusHeight; y++) {
        setBlock(blocks, x, groundY + y, z, BlockTypes.CACTUS);
    }
}

function generateDeadBush(blocks, x, z, groundY) {
    setBlock(blocks, x, groundY + 1, z, BlockTypes.DEAD_BUSH);
}

function generateTrees(blocks, chunkX, chunkZ) {
    const worldX = chunkX * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE;
    
    for (let x = 2; x < CHUNK_SIZE - 2; x++) {
        for (let z = 2; z < CHUNK_SIZE - 2; z++) {
            const wx = worldX + x;
            const wz = worldZ + z;
            
            const treeNoise = noise.noise2D(wx * TREE_NOISE_SCALE, wz * TREE_NOISE_SCALE);
            
            if (treeNoise > TREE_THRESHOLD) {
                const n_wx = (wx + 1) * TREE_NOISE_SCALE, p_wx = (wx - 1) * TREE_NOISE_SCALE;
                const n_wz = (wz + 1) * TREE_NOISE_SCALE, p_wz = (wz - 1) * TREE_NOISE_SCALE;
                const c_wx = wx * TREE_NOISE_SCALE, c_wz = wz * TREE_NOISE_SCALE;

                const neighborNoise = [
                    noise.noise2D(n_wx, c_wz), noise.noise2D(p_wx, c_wz),
                    noise.noise2D(c_wx, n_wz), noise.noise2D(c_wx, p_wz)
                ];

                if (neighborNoise.every(n => treeNoise > n)) {
                    const groundY = findGroundLevel(blocks, x, z);
                    if (groundY > WATER_LEVEL) {
                        const surfaceBlock = getBlock(blocks, x, groundY, z);
                        
                        if (surfaceBlock === BlockTypes.STONE) continue;

                        const biome = getBiome(wx, wz);
                        switch (biome) {
                            case BiomeTypes.FOREST:
                            case BiomeTypes.PLAINS:
                                if (surfaceBlock === BlockTypes.GRASS) generateOakTree(blocks, x, z, groundY);
                                break;
                            case BiomeTypes.TAIGA:
                                if (surfaceBlock === BlockTypes.PODZOL) generateSpruceTree(blocks, x, z, groundY);
                                break;
                            case BiomeTypes.DESERT:
                                if (surfaceBlock === BlockTypes.RED_SAND && Math.random() > 0.7) {
                                    if (Math.random() > 0.5) generateCactus(blocks, x, z, groundY);
                                    else generateDeadBush(blocks, x, z, groundY);
                                }
                                break;
                        }
                    }
                }
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
    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    blocks.fill(BlockTypes.AIR);
    generateMinecraftBetaTerrain(blocks, chunkX, chunkZ);
    generateTrees(blocks, chunkX, chunkZ);
    postMessage({ 
      cmd: 'chunk', 
      chunkX, 
      chunkZ, 
      blocks 
    }, [blocks.buffer]);
  } else if (cmd === 'meshChunk') {
    const { chunkX, chunkZ, chunkData, neighborData } = data;

    const opaqueData = generateGeometryData(chunkData, neighborData, false);
    const transparentData = generateGeometryData(chunkData, neighborData, true);

    const transferables = [
        opaqueData.vertices.buffer, opaqueData.colors.buffer, opaqueData.indices.buffer,
        transparentData.vertices.buffer, transparentData.colors.buffer, transparentData.indices.buffer
    ];

    postMessage({
        cmd: 'mesh',
        chunkX,
        chunkZ,
        opaqueData,
        transparentData
    }, transferables);
  }
};