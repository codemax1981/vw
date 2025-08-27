// mesher.js
import { BlockTypes, getBlockColor, CHUNK_SIZE, CHUNK_HEIGHT } from './utils.js';

const FACES = [
    { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, // Front
    { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }, // Back
    { dir: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] }, // Top
    { dir: [0, -1, 0], corners: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] }, // Bottom
    { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] }, // Right
    { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] }  // Left
];

export class ChunkMesher {
    constructor(world) {
        this.world = world;
        this.opaqueMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
        this.transparentMaterial = new THREE.MeshLambertMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
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
        
        // --- FIX STARTS HERE ---
        // If the current block is water, its face is visible if the neighbor is NOT water.
        // This ensures water has a surface against air, dirt, sand, etc.
        if (currentBlock === BlockTypes.WATER) {
            return neighborBlock !== BlockTypes.WATER;
        }
        
        // For all other (opaque) blocks, the face is visible if the neighbor is transparent (air or water).
        return neighborBlock === BlockTypes.AIR || neighborBlock === BlockTypes.WATER;
        // --- FIX ENDS HERE ---
    }

    meshChunk(chunk) {
        if (!chunk.generated) return null;

        const opaqueData = this.generateGeometryData(chunk, false);
        const transparentData = this.generateGeometryData(chunk, true);
        const group = new THREE.Group();

        if (opaqueData.vertices.length > 0) {
            const geometry = this.createBufferGeometry(opaqueData);
            group.add(new THREE.Mesh(geometry, this.opaqueMaterial));
        }

        if (transparentData.vertices.length > 0) {
            const geometry = this.createBufferGeometry(transparentData);
            group.add(new THREE.Mesh(geometry, this.transparentMaterial));
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

                    const color = new THREE.Color(getBlockColor(blockType));
                    for (let i = 0; i < FACES.length; i++) {
                        if (this.isFaceVisible(chunk, x, y, z, i)) {
                            const face = FACES[i];
                            for (const corner of face.corners) {
                                vertices.push(x + corner[0], y + corner[1], z + corner[2]);
                                let faceColor = color.clone();
                                if (i < 2) faceColor.multiplyScalar(0.8);      // Front/Back
                                else if (i < 4) faceColor.multiplyScalar(0.6); // Top/Bottom
                                else faceColor.multiplyScalar(0.9);            // Left/Right
                                colors.push(faceColor.r, faceColor.g, faceColor.b);
                            }
                            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
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