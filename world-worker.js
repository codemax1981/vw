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

const BlockColors = {
    [BlockTypes.DIRT]: 0x8B4513, [BlockTypes.GRASS]: 0x228B22, [BlockTypes.SAND]: 0xF4A460,
    [BlockTypes.LOG]: 0x654321, [BlockTypes.LEAVES]: 0x32CD32, [BlockTypes.WATER]: 0x4169E1,
    [BlockTypes.STONE]: 0x808080, [BlockTypes.GRAVEL]: 0x999999, [BlockTypes.COAL_ORE]: 0x2F2F2F,
    [BlockTypes.BEDROCK]: 0x1A1A1A
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

// --- MESHER LOGIC ---
const FACES = [
    { dir: [0, 0, 1], corners: [ { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] }, { pos: [1, 1, 1], uv: [1, 1] }, { pos: [0, 1, 1], uv: [0, 1] } ] },
    { dir: [0, 0, -1], corners: [ { pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] }, { pos: [0, 1, 0], uv: [1, 1] }, { pos: [1, 1, 0], uv: [0, 1] } ] },
    { dir: [0, 1, 0], corners: [ { pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 1, 1], uv: [0, 0] }, { pos: [1, 1, 1], uv: [1, 0] }, { pos: [1, 1, 0], uv: [1, 1] } ] },
    { dir: [-1, 0, 0], corners: [ { pos: [0, 0, 1], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] }, { pos: [1, 0, 0], uv: [1, 0] }, { pos: [1, 0, 1], uv: [1, 1] } ] },
    { dir: [1, 0, 0], corners: [ { pos: [1, 0, 1], uv: [0, 0] }, { pos: [1, 0, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] } ] },
    { dir: [-1, 0, 0], corners: [ { pos: [0, 0, 0], uv: [0, 0] }, { pos: [0, 0, 1], uv: [1, 0] }, { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 1, 0], uv: [0, 1] } ] }
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
            
            const heightNoise1 = noise.noise2D(wx * TERRAIN_SCALE, wz * TERRAIN_SCALE);
            const heightNoise2 = noise.noise2D(wx * TERRAIN_SCALE_2, wz * TERRAIN_SCALE_2) * 0.5;
            const combinedHeight = (heightNoise1 + heightNoise2) * HEIGHT_VARIATION;
            const detail = noise.noise2D(wx * DETAIL_SCALE, wz * DETAIL_SCALE) * DETAIL_AMPLITUDE;
            let surfaceHeight = Math.floor(BASE_HEIGHT + combinedHeight + detail);
            surfaceHeight = Math.max(5, Math.min(CHUNK_HEIGHT - 5, surfaceHeight));
            
            generateColumn(blocks, x, z, surfaceHeight, wx, wz);
        }
    }
}

function generateColumn(blocks, x, z, surfaceHeight, worldX, worldZ) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
        const idx = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
        
        if (y === 0) {
            blocks[idx] = BlockTypes.BEDROCK;
        } else if (y < surfaceHeight - 4) {
            blocks[idx] = BlockTypes.STONE;
            if (y > surfaceHeight - 12 && y < surfaceHeight - 2) {
                const coalNoise = noise.noise2D(worldX * 0.1 + y * 0.2, worldZ * 0.1 + y * 0.2);
                if (coalNoise > 0.6) {
                    blocks[idx] = BlockTypes.COAL_ORE;
                }
            }
        } else if (y < surfaceHeight) {
            blocks[idx] = BlockTypes.DIRT;
        } else if (y === surfaceHeight) {
            if (surfaceHeight > WATER_LEVEL) {
                if (surfaceHeight <= WATER_LEVEL + 3) {
                    const beachNoise = noise.noise2D(worldX * 0.15, worldZ * 0.15);
                    blocks[idx] = beachNoise > 0.0 ? BlockTypes.SAND : BlockTypes.GRAVEL;
                } else {
                    blocks[idx] = BlockTypes.GRASS;
                }
            } else {
                if (surfaceHeight < WATER_LEVEL - 2) {
                    blocks[idx] = BlockTypes.SAND;
                } else {
                    const beachNoise = noise.noise2D(worldX * 0.2, worldZ * 0.2);
                    blocks[idx] = beachNoise > 0.2 ? BlockTypes.SAND : BlockTypes.GRAVEL;
                }
            }
        } else if (y <= WATER_LEVEL) {
            blocks[idx] = BlockTypes.WATER;
        } else {
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
    const treeHeight = 4 + Math.floor(Math.random() * 3);
    for (let y = 1; y <= treeHeight; y++) {
        setBlock(blocks, x, groundY + y, z, BlockTypes.LOG);
    }
    
    const canopyCenterY = groundY + treeHeight;
    const canopyRadius = 2 + Math.random() * 0.5;
    
    for (let ly = -2; ly <= 2; ly++) {
        for (let lx = -2; lx <= 2; lx++) {
            for (let lz = -2; lz <= 2; lz++) {
                const dist = Math.sqrt(lx * lx + ly * ly + lz * lz);
                if (lx === 0 && lz === 0 && ly >= 0) continue;
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
    const treeAttempts = 8;
    
    for (let i = 0; i < treeAttempts; i++) {
        const x = 2 + Math.floor(Math.random() * 12);
        const z = 2 + Math.floor(Math.random() * 12);
        const wx = worldX + x;
        const wz = worldZ + z;
        const treeNoise = noise.noise2D(wx * TREE_NOISE_SCALE, wz * TREE_NOISE_SCALE);
        
        if (treeNoise > TREE_THRESHOLD) {
            const groundY = findGroundLevel(blocks, x, z);
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