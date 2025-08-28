// mesher.js
import { BlockTypes, getBlockColor, CHUNK_SIZE, CHUNK_HEIGHT } from './utils.js';

const FACES = [
    { // Front
        dir: [0, 0, 1],
        corners: [ { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] }, { pos: [1, 1, 1], uv: [1, 1] }, { pos: [0, 1, 1], uv: [0, 1] } ]
    },
    { // Back
        dir: [0, 0, -1],
        corners: [ { pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] }, { pos: [0, 1, 0], uv: [1, 1] }, { pos: [1, 1, 0], uv: [0, 1] } ]
    },
    { // Top (index 2)
        dir: [0, 1, 0],
        corners: [ { pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 1, 1], uv: [0, 0] }, { pos: [1, 1, 1], uv: [1, 0] }, { pos: [1, 1, 0], uv: [1, 1] } ]
    },
    { // Bottom
        dir: [0, -1, 0],
        corners: [ { pos: [0, 0, 1], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] }, { pos: [1, 0, 0], uv: [1, 0] }, { pos: [1, 0, 1], uv: [1, 1] } ]
    },
    { // Right
        dir: [1, 0, 0],
        corners: [ { pos: [1, 0, 1], uv: [0, 0] }, { pos: [1, 0, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] } ]
    },
    { // Left
        dir: [-1, 0, 0],
        corners: [ { pos: [0, 0, 0], uv: [0, 0] }, { pos: [0, 0, 1], uv: [1, 0] }, { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 1, 0], uv: [0, 1] } ]
    }
];

const AO_SHADING = [0.5, 0.7, 0.85, 1.0]; // 3 neighbors, 2, 1, 0

// --- NEW: A more deliberate offset for the water surface ---
const WATER_SURFACE_Y_OFFSET = -0.15;

export class ChunkMesher {
    constructor(world) {
        this.world = world;
        this.opaqueMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.9,
            metalness: 0.0
        });
        this.transparentMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
            roughness: 0.2,
            metalness: 0.0
        });
    }
    
    isBlockSolidForAO(x, y, z) {
        const block = this.world.getBlock(x, y, z);
        return block !== BlockTypes.AIR && 
               block !== BlockTypes.WATER && 
               block !== BlockTypes.LEAVES;
    }

    getAmbientOcclusion(chunk, x, y, z, cornerPos) {
        const worldX = chunk.x * CHUNK_SIZE + x;
        const worldZ = chunk.z * CHUNK_SIZE + z;
        
        const neighbors = [];
        for (let i = 0; i < 3; i++) {
            if (cornerPos[i] === 0) {
                const n = [0, 0, 0]; n[i] = -1; neighbors.push(n);
            } else {
                const n = [0, 0, 0]; n[i] = 1; neighbors.push(n);
            }
        }
        
        let occlusion = 0;
        const side1 = this.isBlockSolidForAO(worldX + neighbors[0][0], y + neighbors[0][1], worldZ + neighbors[0][2]);
        const side2 = this.isBlockSolidForAO(worldX + neighbors[1][0], y + neighbors[1][1], worldZ + neighbors[1][2]);
        const corner = this.isBlockSolidForAO(worldX + neighbors[0][0] + neighbors[1][0], y + neighbors[0][1] + neighbors[1][1], worldZ + neighbors[0][2] + neighbors[1][2]);

        if (side1 && side2) {
            occlusion = 3;
        } else {
            occlusion = (side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0);
        }
        
        return occlusion;
    }

    isFaceVisible(chunk, x, y, z, faceIndex) {
        const face = FACES[faceIndex];
        const nx = x + face.dir[0];
        const ny = y + face.dir[1];
        const nz = z + face.dir[2];
    
        const worldX = chunk.x * CHUNK_SIZE + nx;
        const worldZ = chunk.z * CHUNK_SIZE + nz;
        
        const neighborBlock = this.world.getBlock(worldX, ny, worldZ);
        const currentBlock = chunk.getBlock(x, y, z);
        
        if (currentBlock === BlockTypes.WATER) {
            // Don't render faces between adjacent water blocks to prevent z-fighting
            if (neighborBlock === BlockTypes.WATER) {
                return false;
            }
            // Only render water faces that are exposed to air or solid blocks
            return neighborBlock === BlockTypes.AIR;
        }
        
        return neighborBlock === BlockTypes.AIR || neighborBlock === BlockTypes.WATER;
    }
    meshChunk(chunk) {
        if (!chunk.generated) return null;

        const opaqueData = this.generateGeometryData(chunk, false);
        const transparentData = this.generateGeometryData(chunk, true);
        const group = new THREE.Group();

        if (opaqueData.vertices.length > 0) {
            const geometry = this.createBufferGeometry(opaqueData);
            const mesh = new THREE.Mesh(geometry, this.opaqueMaterial);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
        }

        if (transparentData.vertices.length > 0) {
            const geometry = this.createBufferGeometry(transparentData);
            const mesh = new THREE.Mesh(geometry, this.transparentMaterial);
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            group.add(mesh);
        }

        if (group.children.length === 0) return null;
        group.position.set(chunk.x * CHUNK_SIZE, 0, chunk.z * CHUNK_SIZE);
        return group;
    }

    generateGeometryData(chunk, isTransparentPass) {
        const vertices = [], colors = [], indices = [];
        let vertexIndex = 0;

        for (let y = 0; y < CHUNK_HEIGHT; y++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                for (let x = 0; x < CHUNK_SIZE; x++) {
                    const blockType = chunk.getBlock(x, y, z);
                    if (blockType === BlockTypes.AIR) continue;
                    
                    const isTransparent = (blockType === BlockTypes.WATER);
                    if (isTransparent !== isTransparentPass) continue;

                    const baseColor = new THREE.Color(getBlockColor(blockType));
                    
                    for (let i = 0; i < FACES.length; i++) {
                        if (this.isFaceVisible(chunk, x, y, z, i)) {
                            const face = FACES[i];
                            const faceAOs = [];

                            // --- NEW LOGIC: Check if this is a water surface and apply offset only to the top face ---
                            let yOffset = 0;
                            if (blockType === BlockTypes.WATER) {
                                const worldX = chunk.x * CHUNK_SIZE + x;
                                const worldZ = chunk.z * CHUNK_SIZE + z;
                                const blockAbove = this.world.getBlock(worldX, y + 1, worldZ);
                                
                                // If the block above is AIR and we are drawing the TOP face (i === 2)
                                if (blockAbove === BlockTypes.AIR && i === 2) {
                                    yOffset = WATER_SURFACE_Y_OFFSET;
                                }
                            }
                            // --- END NEW LOGIC ---
                            
                            for (const corner of face.corners) {
                                // Apply the calculated offset (it will be 0 for all non-surface faces)
                                vertices.push(x + corner.pos[0], y + corner.pos[1] + yOffset, z + corner.pos[2]);
                                
                                const ao = this.getAmbientOcclusion(chunk, x, y, z, corner.pos);
                                faceAOs.push(ao);

                                let faceColor = baseColor.clone();
                                if (i === 2) faceColor.multiplyScalar(1.0);
                                else if (i === 3) faceColor.multiplyScalar(0.6);
                                else faceColor.multiplyScalar(0.8);
                                
                                faceColor.multiplyScalar(AO_SHADING[3 - ao]);
                                
                                colors.push(faceColor.r, faceColor.g, faceColor.b);
                            }
                            
                            if (faceAOs[0] + faceAOs[2] > faceAOs[1] + faceAOs[3]) {
                                indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 3);
                                indices.push(vertexIndex + 1, vertexIndex + 2, vertexIndex + 3);
                            } else {
                                indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
                                indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
                            }
                            vertexIndex += 4;
                        }
                    }
                }
            }
        }
        return { vertices, colors, indices };
    }

    createBufferGeometry({ vertices, colors, indices }) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return geometry;
    }
}