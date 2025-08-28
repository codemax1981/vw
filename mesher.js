// mesher.js
import { CHUNK_SIZE } from './utils.js';

export class ChunkMesher {
    constructor() {
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
    
    createMeshFromData(opaqueData, transparentData, chunkX, chunkZ) {
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
        group.position.set(chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE);
        return group;
    }

    createBufferGeometry({ vertices, colors, indices }) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeVertexNormals();
        return geometry;
    }
}