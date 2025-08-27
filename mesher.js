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
    { // Top
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

// --- NEW: AO shading values ---
const AO_SHADING = [0.5, 0.7, 0.85, 1.0]; // 3 neighbors, 2, 1, 0

export class ChunkMesher {
    constructor(world) {
        this.world = world;
        // --- MODIFIED: Use MeshStandardMaterial for better lighting ---
        this.opaqueMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.9, // Matte look
            metalness: 0.0
        });
        this.transparentMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
            roughness: 0.2, // Shinier for water
            metalness: 0.0
        });
    }
    
    // --- NEW: Helper to check if a block is solid for AO calculation ---
    isBlockSolidForAO(x, y, z) {
        const block = this.world.getBlock(x, y, z);
        return block !== BlockTypes.AIR && block !== BlockTypes.WATER; // Water doesn't cast AO shadows
    }

    // --- NEW: Ambient Occlusion Calculation ---
    getAmbientOcclusion(chunk, x, y, z, cornerPos) {
        const worldX = chunk.x * CHUNK_SIZE + x;
        const worldZ = chunk.z * CHUNK_SIZE + z;
        
        // Determine the 3 neighbors to check for AO based on the corner's position
        const neighbors = [];
        for (let i = 0; i < 3; i++) {
            // If the corner is at the edge of the block (e.g., pos[i] is 0 or 1),
            // we check the neighbor in that direction.
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
            occlusion = 3; // Fully occluded corner
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
            return neighborBlock !== BlockTypes.WATER;
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
            // Water doesn't cast shadows but should receive them
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
                            
                            // --- MODIFIED: Calculate AO for each corner of the face ---
                            for (const corner of face.corners) {
                                vertices.push(x + corner.pos[0], y + corner.pos[1], z + corner.pos[2]);
                                
                                const ao = this.getAmbientOcclusion(chunk, x, y, z, corner.pos);
                                faceAOs.push(ao);

                                let faceColor = baseColor.clone();
                                if (i === 2) faceColor.multiplyScalar(1.0);      // Top
                                else if (i === 3) faceColor.multiplyScalar(0.6); // Bottom
                                else faceColor.multiplyScalar(0.8);              // Sides
                                
                                // Apply AO shading
                                faceColor.multiplyScalar(AO_SHADING[3 - ao]);
                                
                                colors.push(faceColor.r, faceColor.g, faceColor.b);
                            }
                            
                            // --- MODIFIED: Split quad based on AO to prevent sharp diagonal lines ---
                            // This creates the "smooth lighting" diamond effect.
                            if (faceAOs[0] + faceAOs[2] > faceAOs[1] + faceAOs[3]) {
                                // Split along the 1-3 diagonal
                                indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 3);
                                indices.push(vertexIndex + 1, vertexIndex + 2, vertexIndex + 3);
                            } else {
                                // Split along the 0-2 diagonal
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
        geometry.computeVertexNormals(); // Normals are crucial for lighting
        return geometry;
    }
}