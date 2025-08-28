// utils.js

// --- World Constants ---
export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 64;
export const WATER_LEVEL = 28;

// --- Block Types ---
export const BlockTypes = {
    AIR: 0,
    DIRT: 1,
    GRASS: 2,
    SAND: 3,
    LOG: 4,
    LEAVES: 5,
    WATER: 6,
    STONE: 7,        // NEW
    GRAVEL: 8,       // NEW
    COAL_ORE: 9,     // NEW
    BEDROCK: 10      // NEW
};

export const BlockColors = {
    [BlockTypes.DIRT]: 0x8B4513,
    [BlockTypes.GRASS]: 0x228B22,
    [BlockTypes.SAND]: 0xF4A460,
    [BlockTypes.LOG]: 0x654321,
    [BlockTypes.LEAVES]: 0x32CD32,
    [BlockTypes.WATER]: 0x4169E1,
    [BlockTypes.STONE]: 0x808080,      // NEW
    [BlockTypes.GRAVEL]: 0x999999,     // NEW
    [BlockTypes.COAL_ORE]: 0x2F2F2F,   // NEW
    [BlockTypes.BEDROCK]: 0x1A1A1A     // NEW
};

export function getBlockColor(blockType) {
    return BlockColors[blockType] || 0xFFFFFF;
}

// --- Coordinate Helpers ---
export function chunkKey(x, z) {
    return `${x},${z}`;
}

export function worldToChunk(worldX, worldZ) {
    const { x, z } = worldToChunkCoords(worldX, worldZ);
    return { x, z };
}

export function worldToChunkCoords(worldX, worldZ) {
    const x = Math.floor(worldX / CHUNK_SIZE);
    const z = Math.floor(worldZ / CHUNK_SIZE);
    return { x, z };
}

// --- Perlin Noise Generator ---
export class Noise {
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